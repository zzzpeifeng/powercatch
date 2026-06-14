/**
 * 请求数据状态管理
 * 内存优先策略：录制中仅存内存 Map，不写 DB
 */
import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import type { CaptureRequest, RequestUpdate, CompareResult, LoadingStates, ProxyStatus } from '../services/types'
import { ipc } from '../services/ipc'
import { generateMatchKey, groupByMatchKey } from '../utils/request-matcher'

/** 批量刷新的间隔（ms） */
const FLUSH_INTERVAL = 50

export const useRequestStore = defineStore('request', () => {
  // ===== State =====

  /** 内存中的请求列表（录制中） */
  const requests = ref<CaptureRequest[]>([])

  /** 当前选中的请求（用于详情查看） */
  const selectedRequest = ref<CaptureRequest | null>(null)

  /** 被勾选的请求（用于对比，最多 2 个） */
  const checkedRequests = ref<CaptureRequest[]>([])

  /** 域名过滤器 */
  const domainFilters = ref<string[]>([])

  /** 录制状态 */
  const isRecording = ref<boolean>(false)

  /** 代理状态 */
  const proxyStatus = ref<ProxyStatus>('stopped')

  /** 代理端口 */
  const proxyPort = ref<number>(8888)

  /** 本机 IP */
  const localIp = ref<string>('127.0.0.1')

  /** AI 对比结果 */
  const compareResult = ref<CompareResult | null>(null)

  /** 流式对比文本 */
  const streamingText = ref<string>('')

  /** Loading 状态 */
  const loadingStates = reactive<LoadingStates>({
    comparing: false,
    exporting: false,
    testingConnection: false,
    startingProxy: false,
  })

  /** 设备别名 */
  const deviceAliases = ref<Record<string, string>>({})

  /** 视图模式：list（列表）或 group（分组） */
  const viewMode = ref<'list' | 'group'>('list')

  /** 内存最大条数 */
  const MAX_MEMORY_REQUESTS = 500

  /** 批量缓冲（非响应式，避免频繁 trigger） */
  const pendingRequests: CaptureRequest[] = []

  /** flush 定时器 */
  let flushTimer: ReturnType<typeof setInterval> | null = null

  /** 向内存追加（批量写入，减少响应式触发次数） */
  function flushPending(): void {
    if (pendingRequests.length === 0) return
    const batch = pendingRequests.splice(0, pendingRequests.length)
    console.log(`[Store] flushPending: 写入 ${batch.length} 条，内存总数 ${requests.value.length}`)
    requests.value.unshift(...batch)

    // 超出上限，淘汰最老的未选中请求
    if (requests.value.length > MAX_MEMORY_REQUESTS) {
      const unselected = requests.value.filter((r) => !r.selected && !r.checked)
      if (unselected.length > 0) {
        const excess = requests.value.length - MAX_MEMORY_REQUESTS
        const toRemove = unselected.slice(0, excess)
        if (toRemove.length > 0) {
          const removeIds = new Set(toRemove.map((r) => r.id))
          requests.value = requests.value.filter((r) => !removeIds.has(r.id))
        }
      }
    }
  }

  /** 启动 flush 定时器 */
  function startFlushTimer(): void {
    if (flushTimer) return
    flushTimer = setInterval(() => {
      flushPending()
    }, FLUSH_INTERVAL)
  }

  /** 停止 flush 定时器 */
  function stopFlushTimer(): void {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    // 退出前把剩余缓冲全部写入
    flushPending()
  }

  // ===== 自动订阅新请求事件（store 初始化时执行）=====
  let unsubNewRequests: (() => void) | null = null
  let unsubStream: (() => void) | null = null

  if (typeof window !== 'undefined') {
    // 启动批量刷新定时器
    startFlushTimer()
    console.log('[Store] 初始化完成，flush 定时器已启动')
    // 订阅新请求推送
    unsubNewRequests = subscribeToNewRequests()
    // 订阅 AI 流式对比事件
    unsubStream = subscribeToStreamEvents()
  }

  // ===== Computed =====

  /** 过滤后的请求列表 */
  const filteredRequests = computed<CaptureRequest[]>(() => {
    if (domainFilters.value.length === 0) {
      return requests.value
    }
    return requests.value.filter((req) => {
      return domainFilters.value.some((filter) => {
        // 通配符匹配：支持 * 作为任意字符通配符（glob 风格）
        if (filter.includes('*')) {
          const pattern = filter
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符（保留 *）
            .replace(/\*/g, '.*')                   // * → 匹配任意字符
          return new RegExp(`^${pattern}$`, 'i').test(req.host)
        }
        // 精确匹配
        return req.host === filter
      })
    })
  })

  /** 已捕获总数 */
  const totalCount = computed(() => requests.value.length)

  /** 过滤后数量 */
  const filteredCount = computed(() => filteredRequests.value.length)

  /** 已勾选数量 */
  const checkedCount = computed(() => checkedRequests.value.length)

  /** 是否可以对比（必须勾选 2 个） */
  const canCompare = computed(() => checkedRequests.value.length === 2)

  /** 分组视图数据 */
  const groupedRequests = computed(() => {
    return groupByMatchKey(filteredRequests.value)
  })

  /** 获取设备名称 */
  const getDeviceName = computed(() => {
    return (ip: string) => deviceAliases.value[ip] || ip
  })

  // ===== Actions =====

  /** 添加新请求或更新已有请求（来自代理） */
  function addRequest(request: CaptureRequest): void {
    const id = request.id
    // 检查是否已有相同 ID 的请求（响应已到达的更新）
    // 先在已写入内存的列表中查找
    const idx = requests.value.findIndex(r => r.id === id)
    if (idx >= 0) {
      // 找到：原地更新响应字段（触发 Vue 响应式）
      const target = requests.value[idx]
      if (request.statusCode !== null && request.statusCode !== undefined) {
        target.statusCode = request.statusCode
        target.duration = request.duration
        target.requestHeaders = request.requestHeaders
        target.requestBody = request.requestBody
        target.responseHeaders = request.responseHeaders
        target.responseBody = request.responseBody
      }
      console.log('[Store] 更新请求响应:', id, request.statusCode)
      return
    }
    // 还未 flush 到内存（在 pendingRequests 里）：就地更新缓冲
    const pendingIdx = pendingRequests.findIndex(r => r.id === id)
    if (pendingIdx >= 0) {
      const target = pendingRequests[pendingIdx]
      if (request.statusCode !== null && request.statusCode !== undefined) {
        target.statusCode = request.statusCode
        target.duration = request.duration
        target.requestHeaders = request.requestHeaders
        target.requestBody = request.requestBody
        target.responseHeaders = request.responseHeaders
        target.responseBody = request.responseBody
      }
      console.log('[Store] 更新 pending 中的请求响应:', id)
      return
    }

    // 新请求：清掉内部字段，关联设备别名，放入批量缓冲
    delete (request as any)._isUpdate
    delete (request as any)._arrivedAt
    request.deviceName = deviceAliases.value[request.clientIp] || request.clientIp
    request.selected = false
    request.checked = false
    pendingRequests.push(request)
  }

  /** 更新已有请求的响应数据（来自 onRequestUpdated 事件） */
  function updateRequest(update: RequestUpdate): void {
    const { id, statusCode, duration, requestHeaders, requestBody, responseHeaders, responseBody } = update

    // 在已写入内存的列表中查找
    const idx = requests.value.findIndex(r => r.id === id)
    if (idx >= 0) {
      const target = requests.value[idx]
      if (statusCode !== null && statusCode !== undefined) {
        target.statusCode = statusCode
        target.duration = duration
        target.requestHeaders = requestHeaders
        target.requestBody = requestBody
        target.responseHeaders = responseHeaders
        target.responseBody = responseBody
      }
      console.log('[Store] 更新请求响应:', id, statusCode)
      return
    }

    // 还在 pending 中：就地更新缓冲
    const pendingIdx = pendingRequests.findIndex(r => r.id === id)
    if (pendingIdx >= 0) {
      const target = pendingRequests[pendingIdx]
      if (statusCode !== null && statusCode !== undefined) {
        target.statusCode = statusCode
        target.duration = duration
        target.requestHeaders = requestHeaders
        target.requestBody = requestBody
        target.responseHeaders = responseHeaders
        target.responseBody = responseBody
      }
      console.log('[Store] 更新 pending 中的请求响应:', id)
      return
    }

    console.warn('[Store] updateRequest: 未找到请求 ID', id)
  }

  /** 清空所有请求 */
  function clearRequests(): void {
    pendingRequests.length = 0  // 清空批量缓冲
    requests.value = []
    selectedRequest.value = null
    checkedRequests.value = []
    compareResult.value = null
    streamingText.value = ''
  }

  /** 选中请求查看详情 */
  function selectRequest(request: CaptureRequest | null): void {
    selectedRequest.value = request
  }

  /** 勾选/取消勾选请求（用于对比） */
  function toggleCheck(request: CaptureRequest): void {
    const idx = checkedRequests.value.findIndex((r) => r.id === request.id)
    if (idx >= 0) {
      checkedRequests.value.splice(idx, 1)
      request.checked = false
    } else {
      if (checkedRequests.value.length >= 2) {
        // 最多选 2 个，替换第一个
        const removed = checkedRequests.value.shift()
        if (removed) removed.checked = false
      }
      checkedRequests.value.push(request)
      request.checked = true
    }
  }

  /** 启动录制 */
  async function startRecording(): Promise<boolean> {
    loadingStates.startingProxy = true
    try {
      const result = await ipc.proxy.start(proxyPort.value)
      if (result.success) {
        isRecording.value = true
        proxyStatus.value = 'running'
        return true
      } else {
        return false
      }
    } catch {
      return false
    } finally {
      loadingStates.startingProxy = false
    }
  }

  /** 停止录制 */
  async function stopRecording(): Promise<void> {
    try {
      await ipc.proxy.stop()
      isRecording.value = false
      proxyStatus.value = 'stopped'
    } catch (error) {
      console.error('Failed to stop recording:', error)
    }
  }

  /** 切换录制状态 */
  async function toggleRecording(): Promise<boolean> {
    if (isRecording.value) {
      await stopRecording()
      return false
    } else {
      return await startRecording()
    }
  }

  /** 执行 AI 对比 */
  async function doCompare(): Promise<void> {
    if (checkedRequests.value.length !== 2) {
      console.warn('[Store] doCompare: 勾选请求数量不等于 2，当前:', checkedRequests.value.length)
      return
    }

    loadingStates.comparing = true
    compareResult.value = null
    streamingText.value = ''

    try {
      const [reqA, reqB] = checkedRequests.value
      const result = await ipc.ai.compare(reqA, reqB)

      if (result.success && result.result) {
        compareResult.value = result.result
      } else if (result.error) {
        throw new Error(result.error)
      }
    } catch (error: any) {
      throw error
    } finally {
      loadingStates.comparing = false
    }
  }

  /** 追加流式文本 */
  function appendStreamChunk(chunk: string): void {
    streamingText.value += chunk
  }

  /** 设置对比结果 */
  function setCompareResult(result: CompareResult): void {
    compareResult.value = result
    loadingStates.comparing = false
  }

  /** 导出对比结果 */
  async function doExport(format: 'json' | 'html' | 'txt'): Promise<boolean> {
    if (!compareResult.value || checkedRequests.value.length !== 2) return false

    loadingStates.exporting = true
    try {
      const [reqA, reqB] = checkedRequests.value
      const result = await ipc.export.file(format, compareResult.value, reqA, reqB)
      return result.success
    } catch {
      return false
    } finally {
      loadingStates.exporting = false
    }
  }

  /** 加载代理状态 */
  async function loadProxyStatus(): Promise<void> {
    try {
      const info = await ipc.proxy.status()
      proxyStatus.value = info.status
      proxyPort.value = info.port
      localIp.value = info.localIp
    } catch {
      // 忽略错误
    }
  }

  /** 加载设备别名 */
  async function loadDeviceAliases(): Promise<void> {
    try {
      const aliases = await ipc.device.getAliases()
      deviceAliases.value = aliases
    } catch {
      // 忽略错误
    }
  }

  /** 订阅新请求事件 */
  function subscribeToNewRequests(): () => void {
    console.log('[Store] subscribeToNewRequests: 正在订阅 IPC 事件')
    const unsub = ipc.proxy.onNewRequest((request: CaptureRequest) => {
      console.log('[Store] onNewRequest 回调触发！收到请求:', request.id, request.method, request.path)
      addRequest(request)
    })
    const unsubUpdate = ipc.proxy.onRequestUpdated((update: RequestUpdate) => {
      console.log('[Store] onRequestUpdated 回调触发！更新请求:', update.id, update.statusCode)
      updateRequest(update)
    })
    console.log('[Store] subscribeToNewRequests: 订阅完成')
    return () => {
      unsub()
      unsubUpdate()
    }
  }

  /** 订阅流式对比事件 */
  function subscribeToStreamEvents(): () => void {
    const unsubChunk = ipc.ai.onStreamChunk((chunk: string) => {
      appendStreamChunk(chunk)
    })
    const unsubEnd = ipc.ai.onStreamEnd((result: CompareResult) => {
      setCompareResult(result)
    })
    return () => {
      unsubChunk()
      unsubEnd()
    }
  }

  /** 切换视图模式 */
  function toggleViewMode(): void {
    viewMode.value = viewMode.value === 'list' ? 'group' : 'list'
  }

  return {
    // State
    requests,
    selectedRequest,
    checkedRequests,
    domainFilters,
    isRecording,
    proxyStatus,
    proxyPort,
    localIp,
    compareResult,
    streamingText,
    loadingStates,
    deviceAliases,
    viewMode,
    // Computed
    filteredRequests,
    totalCount,
    filteredCount,
    checkedCount,
    canCompare,
    groupedRequests,
    getDeviceName,
    // Actions
    addRequest,
    clearRequests,
    selectRequest,
    toggleCheck,
    startRecording,
    stopRecording,
    toggleRecording,
    doCompare,
    appendStreamChunk,
    setCompareResult,
    doExport,
    loadProxyStatus,
    loadDeviceAliases,
    subscribeToNewRequests,
    subscribeToStreamEvents,
    toggleViewMode,
    /** 手动刷新缓冲（调试用） */
    flushPending,
    /** 销毁 store（清理定时器） */
    destroy: stopFlushTimer,
  }
})
