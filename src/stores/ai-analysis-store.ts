/**
 * AI 代码分析状态管理（混合模式）
 * 支持两阶段分析：快速扫描 + AI 深度分析
 * 使用 SSE 进行实时通信，支持降级到 IPC 轮询
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  RepoConfig,
  CodeAnalysisRequest,
  CodeAnalysisResult,
  CloneProgress,
  DiskSpaceResult,
  GitAvailabilityResult,
  AnalysisPhase,
  AnalysisLogEntry,
  AIDeepAnalysisResult,
  AnalysisScenario,
} from '../services/types'
import { ipc } from '../services/ipc'
import { createSSEService, SSEService, SSEConnectionState } from '../services/sse'

/** 检测仓库类型 */
function detectRepoType(url: string): 'github' | 'gitlab' | 'gitee' | 'bitbucket' | 'unknown' {
  const lower = url.toLowerCase()
  if (lower.includes('github')) return 'github'
  if (lower.includes('gitlab') || /git\.[a-z]+\./.test(lower)) return 'gitlab'
  if (lower.includes('gitee')) return 'gitee'
  if (lower.includes('bitbucket')) return 'bitbucket'
  return 'unknown'
}

export const useAiAnalysisStore = defineStore('aiAnalysis', () => {
  // ===== State =====

  /** 是否正在分析 */
  const analyzing = ref(false)

  /** 当前分析阶段 */
  const phase = ref<AnalysisPhase>('idle')

  /** 流式输出文本（兼容旧版本） */
  const streamContent = ref('')

  /** 分析结果（兼容旧版本） */
  const result = ref<CodeAnalysisResult | null>(null)

  /** AI 深度分析结果（新版本） */
  const deepAnalysisResult = ref<AIDeepAnalysisResult | null>(null)

  /** 错误信息 */
  const error = ref<string | null>(null)

  /** 仓库配置（持久化） */
  const repoConfig = ref<RepoConfig>({
    repoUrl: '',
    repoType: 'github',
    branch: 'main',
    accessToken: '',
    authMethod: 'http',
    cloneDir: '',
    repoUrlHistory: [],
  })

  /** 清理状态 */
  const cleanupStatus = ref<'idle' | 'cleaning' | 'done'>('idle')

  /** M1: Git 可用性 */
  const gitAvailable = ref<boolean | null>(null)

  /** M1: Git 检测中 */
  const gitChecking = ref(false)

  /** M2: Clone 进度 */
  const cloneProgress = ref<CloneProgress | null>(null)

  /** M2: Clone 进度监听清理函数 */
  let cloneProgressCleanup: (() => void) | null = null

  /** 扫描进度 */
  const scanProgress = ref<{
    scanned: number; total: number; percent: number;
    phase?: string; currentFile?: string; matchCount?: number
  } | null>(null)

  /** 扫描进度监听清理函数 */
  let scanProgressCleanup: (() => void) | null = null

  /** 流式 chunk 监听清理函数 */
  let streamChunkCleanup: (() => void) | null = null

  /** 流式结束监听清理函数 */
  let streamEndCleanup: (() => void) | null = null

  // ===== 新增 State（混合模式）=====

  /** 实时日志（最多保存 1000 条） */
  const logs = ref<AnalysisLogEntry[]>([])

  /** 日志自动滚动 */
  const autoScroll = ref(true)

  /** 分析会话 ID */
  const sessionId = ref<string | null>(null)

  /** 深度分析模式（是否启用 Agent 模式） */
  const deepAnalysisMode = ref(false)

  /** 日志 ID 计数器 */
  let logIdCounter = 0

  /** IPC 日志轮询定时器 */
  let pollingInterval: number | null = null

  /** IPC 日志轮询的最后日志 ID */
  let lastLogId = 0

  // ===== 新增 State（SSE 连接管理）=====

  /** SSE 服务实例 */
  let sseService: SSEService | null = null

  /** SSE 连接状态 */
  const sseConnected = ref(false)

  /** SSE 正在连接 */
  const sseConnecting = ref(false)

  /** SSE 连接错误 */
  const sseError = ref<string | null>(null)

  /** AI Agent 思考过程（实时输出） */
  const agentThinking = ref('')

  /** AI Agent 工具调用记录 */
  const agentToolCalls = ref<Array<{
    tool: string;
    status: 'running' | 'done' | 'error';
    args?: any;
    result?: any;
  }>>([])

  // ===== Getters =====

  /** 当前阶段的描述 */
  const phaseDescription = computed(() => {
    const descriptions: Record<AnalysisPhase, string> = {
      'idle': '空闲',
      'cloning': '克隆仓库中',
      'scanning': '扫描路由中',
      'scan-failed': '扫描失败',
      'code-exploring': '代码探索中',
      'analyzing': 'AI 深度分析中',
      'test-generating': '生成测试用例中',
      'generating': '生成报告中',
      'done': '完成',
      'error': '错误',
    }
    return descriptions[phase.value] || '未知'
  })

  /** 是否有实时日志 */
  const hasLogs = computed(() => logs.value.length > 0)

  /** 最新的一条日志 */
  const latestLog = computed(() => {
    if (logs.value.length === 0) return null
    return logs.value[logs.value.length - 1]
  })

  // ===== Actions =====

  /** 加载持久化的仓库配置 */
  async function loadConfig(): Promise<void> {
    try {
      const settings = await ipc.settings.getAll()
      if (settings?.aiCodeAnalysisConfig) {
        const config = settings.aiCodeAnalysisConfig
        repoConfig.value = {
          repoUrl: config.repoUrl || '',
          repoType: detectRepoType(config.repoUrl || ''),
          branch: config.branch || 'main',
          accessToken: config.accessToken || '',
          authMethod: config.authMethod || 'http',
          cloneDir: config.cloneDir || '',
          repoUrlHistory: config.repoUrlHistory || [],
        }
      }
    } catch (err: any) {
      console.error('[AiAnalysisStore] 加载配置失败:', err.message)
    }
  }

  /** 保存仓库配置到 settings */
  async function saveConfig(): Promise<void> {
    try {
      // 手动构造纯普通对象，避免 Vue 响应式代理导致 IPC 结构化克隆失败
      const plainConfig = {
        repoUrl: String(repoConfig.value.repoUrl || ''),
        repoType: repoConfig.value.repoType || 'github',
        branch: String(repoConfig.value.branch || 'main'),
        accessToken: String(repoConfig.value.accessToken || ''),
        authMethod: repoConfig.value.authMethod || 'http',
        cloneDir: String(repoConfig.value.cloneDir || ''),
        repoUrlHistory: Array.isArray(repoConfig.value.repoUrlHistory)
          ? [...repoConfig.value.repoUrlHistory].map(String)
          : [],
      }
      await ipc.settings.saveAll({
        aiCodeAnalysisConfig: plainConfig,
      })
    } catch (err: any) {
      console.error('[AiAnalysisStore] 保存配置失败:', err.message)
    }
  }

  /** 将当前 repoUrl 加入历史记录（去重，最多20条） */
  async function addRepoUrlToHistory(): Promise<void> {
    const url = repoConfig.value.repoUrl.trim()
    if (!url) return

    const history = [...repoConfig.value.repoUrlHistory]
    // 去重
    const index = history.indexOf(url)
    if (index !== -1) {
      history.splice(index, 1)
    }
    // 插入到最前面
    history.unshift(url)
    // 最多保留 20 条
    repoConfig.value.repoUrlHistory = history.slice(0, 20)
  }

  /** M1: 检测 Git 可用性 */
  async function checkGitAvailability(): Promise<void> {
    gitChecking.value = true
    try {
      const result = await ipc.aiCodeAnalysis.checkGitAvailability()
      gitAvailable.value = result.available
      if (!result.available) {
        error.value = result.error || 'Git 不可用'
      }
    } catch (err: any) {
      gitAvailable.value = false
      error.value = err.message
    } finally {
      gitChecking.value = false
    }
  }

  /** M3: 检查磁盘空间 */
  async function checkDiskSpace(): Promise<DiskSpaceResult | null> {
    try {
      const result = await ipc.aiCodeAnalysis.checkDiskSpace(repoConfig.value.cloneDir)
      if (!result.hasEnoughSpace) {
        error.value = result.warning || '磁盘空间不足'
      }
      return result
    } catch (err: any) {
      console.error('[AiAnalysisStore] 磁盘空间检查失败:', err.message)
      return null
    }
  }

  /**
   * 注册 IPC 监听器（接收实时日志和进度）
   * 每次调用前会先清理旧监听器，防止重复注册
   */
  function registerIPCListeners(): void {
    // 先清理旧监听器（防止重复注册）
    cleanupListeners()

    // 注册 Clone 进度监听
    cloneProgressCleanup = ipc.aiCodeAnalysis.onCloneProgress((progress: CloneProgress) => {
      cloneProgress.value = progress
      appendLog({
        level: 'info',
        message: `Clone 进度: ${progress.percent}% - ${progress.message || ''}`,
      })
    })

    // 注册扫描进度监听
    scanProgressCleanup = ipc.aiCodeAnalysis.onScanProgress((progress: {
      scanned: number; total: number; percent: number;
      phase?: string; currentFile?: string; matchCount?: number
    }) => {
      scanProgress.value = progress
      // 不再硬编码 phase = 'scanning'
      // AI 分析期间 AIAnalyzeService.pushProgress 也会通过 IPC 发送 ai:scan-progress，
      // 如果硬编码为 'analyzing'，会把 SSE 驱动的 phase 从 'analyzing' 打回 'scanning'，
      // 导致进度条计算出 NaN% 而消失。
      // 仅当确实在扫描阶段时才更新 phase，避免干扰 AI 分析阶段的状态。
      if (phase.value !== 'analyzing' && phase.value !== 'generating' && phase.value !== 'done' && phase.value !== 'error') {
        phase.value = 'scanning'
      }
    })

    // 注册流式 chunk 监听（兼容旧版本）
    streamChunkCleanup = ipc.aiCodeAnalysis.onStreamChunk((chunk: string) => {
      streamContent.value += chunk
    })

    // 注册流式结束监听（兼容旧版本）
    streamEndCleanup = ipc.aiCodeAnalysis.onStreamEnd((res: CodeAnalysisResult) => {
      result.value = res
      analyzing.value = false
      phase.value = 'done'
      cleanupListeners()
    })
  }

  /**
   * 连接到 SSE 服务器
   * 用于接收实时分析进度和 AI 输出
   */
  async function connectSSE(): Promise<void> {
    if (sseService) {
      console.warn('[AiAnalysisStore] SSE 已连接，跳过')
      return
    }

    try {
      sseConnecting.value = true
      sseError.value = null

      // 获取 SSE 服务器端口
      const portResult = await ipc.aiCodeAnalysis.getSSEPort()
      if (!portResult.success || !portResult.port) {
        throw new Error('SSE 服务器未启动')
      }

      const port = portResult.port
      const url = `http://localhost:${port}/ai-analysis-progress`

      console.log(`[AiAnalysisStore] 正在连接 SSE: ${url}`)

      // 创建 SSE 服务
      sseService = createSSEService(url, {
        maxRetries: 5,
        retryDelay: 3000,
        autoReconnect: true,
      })

      // 注册回调函数
      // 使用 Promise 等待 SSE 连接成功
      let connectResolve: (() => void) | null = null
      let connectReject: ((err: Error) => void) | null = null
      const connectPromise = new Promise<void>((resolve, reject) => {
        connectResolve = resolve
        connectReject = reject
      })
      
      // 超时保护：10 秒后 reject
      const connectTimeout = setTimeout(() => {
        if (connectReject) {
          connectReject(new Error('SSE 连接超时（10秒）'))
          connectResolve = null
          connectReject = null
        }
      }, 10000)
      
      sseService.onStateChange = (state, error) => {
        console.log(`[AiAnalysisStore] SSE 状态变化: ${state}`, error ? `| 错误: ${error.message}` : '')
        sseConnecting.value = state === 'connecting' || state === 'reconnecting'
        sseConnected.value = state === 'connected'
        sseError.value = error ? error.message : null
        
        if (state === 'connected' && connectResolve) {
          console.log('[AiAnalysisStore] SSE 连接成功')
          clearTimeout(connectTimeout)
          connectResolve()
          connectResolve = null
          connectReject = null
        } else if ((state === 'error' || state === 'disconnected') && connectReject) {
          console.warn('[AiAnalysisStore] SSE 连接失败:', error?.message)
          clearTimeout(connectTimeout)
          connectReject(error || new Error('SSE 连接失败'))
          connectResolve = null
          connectReject = null
        }
      }

      sseService.onLog = (log) => {
        console.log('[AiAnalysisStore] onLog 回调触发:', log)
        appendLog(log)
      }

      sseService.onProgress = (progress) => {
        console.log('[AiAnalysisStore] onProgress 回调触发:', progress)
        // 更新 phase 状态
        if (progress.phase) {
          // Phase 映射：将 AI 分析相关的非标准 phase 统一映射到前端识别的 AnalysisPhase
          // 后端 AIAnalyzeService 会发送 'ai-agent'、'ai-tool-call'、'ai-tool-result'、
          // 'code-explorer'、'test-generator' 等非标准 phase
          const phaseMapping: Record<string, AnalysisPhase> = {
            'ai-agent': 'analyzing',
            'ai-tool-call': 'analyzing',
            'ai-tool-result': 'analyzing',
            'code-explorer': 'code-exploring',
            'test-generator': 'test-generating',
          }
          const mappedPhase = phaseMapping[progress.phase] || progress.phase

          // 验证 phase 值是否有效
          const validPhases: AnalysisPhase[] = ['idle', 'cloning', 'scanning', 'scan-failed', 'code-exploring', 'analyzing', 'test-generating', 'generating', 'done', 'error']
          const newPhase = validPhases.includes(mappedPhase as AnalysisPhase) 
            ? (mappedPhase as AnalysisPhase) 
            : phase.value // 如果无效，保持当前 phase
          
          // 如果 phase 从 cloning 切换到其他阶段，清空 cloneProgress
          if (phase.value === 'cloning' && newPhase !== 'cloning') {
            cloneProgress.value = null
          }
          phase.value = newPhase
        }
        // 记录日志
        appendLog({
          level: 'info',
          message: progress.message || `进度更新: ${progress.phase}`,
        })
      }

      sseService.onAgentThinking = (content, phaseName) => {
        // 两阶段模式下：在 Phase 1 → Phase 2 切换时自动插入分隔标记
        if (phaseName === 'explorer' && phase.value !== 'code-exploring') {
          // Phase 1 思考开始，不插入分隔
        } else if (phaseName !== 'explorer' && phase.value === 'code-exploring') {
          // Phase 1 → Phase 2 切换
          agentThinking.value += '\n\n--- 代码探索完成，开始生成测试用例 ---\n\n'
        }
        agentThinking.value += content
      }

      sseService.onAgentToolCall = (tool, args) => {
        console.log('[AiAnalysisStore] onAgentToolCall 回调触发:', tool, args)
        agentToolCalls.value.push({
          tool,
          status: 'running',
          args,
        })
      }

      sseService.onAgentToolResult = (tool, result) => {
        console.log('[AiAnalysisStore] onAgentToolResult 回调触发:', tool)
        const index = agentToolCalls.value.findIndex(
          (call) => call.tool === tool && call.status === 'running'
        )
        if (index !== -1) {
          agentToolCalls.value[index].status = 'done'
          agentToolCalls.value[index].result = result
        }
      }

      sseService.onDone = (result) => {
        console.log('[AiAnalysisStore] onDone 回调触发')
        deepAnalysisResult.value = result
        analyzing.value = false
        phase.value = 'done'
        // 保存到历史记录，防止刷新页面后数据丢失
        saveResultToHistory(result)
        disconnectSSE()
      }

      sseService.onError = (message) => {
        console.error('[AiAnalysisStore] onError 回调触发:', message)
        error.value = message
        // 不立即断开连接，允许重试
      }

      // 连接
      console.log('[AiAnalysisStore] 开始连接 SSE...')
      sseService.connect()
      
      // 等待 SSE 连接成功（或超时/失败）
      try {
        await connectPromise
      } catch (err: any) {
        console.warn('[AiAnalysisStore] SSE 连接失败，降级到 IPC 轮询:', err.message)
        sseConnecting.value = false
        startPollingLogs()
        // 不 throw，允许继续（降级模式）
      }
    } catch (err: any) {
      console.error('[AiAnalysisStore] SSE 连接失败:', err.message)
      sseError.value = err.message
      sseConnecting.value = false

      // 降级到 IPC 轮询
      console.log('[AiAnalysisStore] 降级到 IPC 轮询模式')
      startPollingLogs()
    }
  }

  /**
   * 断开 SSE 连接
   */
  function disconnectSSE(): void {
    if (sseService) {
      console.log('[AiAnalysisStore] 断开 SSE 连接')
      sseService.disconnect()
      sseService = null
      sseConnected.value = false
      sseConnecting.value = false
    }

    // 停止 IPC 轮询（降级方案）
    stopPollingLogs()
  }

  /**
   * 发起分析（支持混合模式）
   * @param request 分析请求参数
   * @param enableDeepAnalysis 是否启用深度分析（阶段2）
   */
  async function startAnalysis(
    request: CodeAnalysisRequest,
    enableDeepAnalysis: boolean = false
  ): Promise<void> {
    if (analyzing.value) return

    // 重置状态
    analyzing.value = true
    phase.value = 'cloning'
    streamContent.value = ''
    result.value = null
    deepAnalysisResult.value = null
    error.value = null
    cloneProgress.value = null
    scanProgress.value = null
    deepAnalysisMode.value = enableDeepAnalysis
    clearLogs()

    // 重置 AI 输出状态
    agentThinking.value = ''
    agentToolCalls.value = []

    // 生成 sessionId
    sessionId.value = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    try {
      // 注册 IPC 监听器（接收实时日志和进度）
      registerIPCListeners()

      // 启动 SSE 连接
      await connectSSE()

      // 发起分析请求
      const response = await ipc.aiCodeAnalysis.startAnalysis(request, enableDeepAnalysis)
      if (!response.success) {
        error.value = response.error || '分析失败'
        analyzing.value = false
        phase.value = 'error'
        cleanupListeners()
        disconnectSSE()
      }
    } catch (err: any) {
      error.value = err.message
      analyzing.value = false
      phase.value = 'error'
      cleanupListeners()
      disconnectSSE()
    }
  }

  /**
   * 取消分析
   */
  async function cancelAnalysis(): Promise<void> {
    try {
      await ipc.aiCodeAnalysis.cancelAnalysis()
    } catch (err: any) {
      console.error('[AiAnalysisStore] 取消分析失败:', err.message)
    } finally {
      analyzing.value = false
      phase.value = 'idle'
      cleanupListeners()
      disconnectSSE()
    }
  }

  /**
   * 启动 IPC 日志轮询（降级方案）
   * 每 500ms 轮询一次，获取新日志
   */
  function startPollingLogs(): void {
    if (pollingInterval) {
      console.warn('[startPollingLogs] 轮询已在运行，跳过')
      return
    }

    lastLogId = 0
    console.log('[startPollingLogs] 启动日志轮询，初始 lastLogId=0')
    pollingInterval = window.setInterval(async () => {
      try {
        const result = await ipc.aiCodeAnalysis.getLogs(lastLogId)
        if (result.logs && result.logs.length > 0) {
          console.log(`[pollLogs] 收到 ${result.logs.length} 条日志，lastLogId=${result.lastLogId}`)
          result.logs.forEach((log: AnalysisLogEntry) => {
            appendLog(log)
          })
          lastLogId = result.lastLogId || 0
        }
      } catch (err) {
        console.error('[AiAnalysisStore] 轮询日志失败:', err)
      }
    }, 500) // 每 500ms 轮询一次
  }

  /**
   * 停止 IPC 日志轮询
   */
  function stopPollingLogs(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
  }

  /**
   * 追加日志条目（带去重）
   * 去重规则：相同 message + level 在 1 秒内只保留第一条
   * @param entry 日志条目（部分，需要自动补充 id 和 timestamp）
   */
  function appendLog(entry: Partial<AnalysisLogEntry> & { message: string; level?: AnalysisLogEntry['level'] }): void {
    const now = Date.now()
    const entryTimestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : now

    console.log('[appendLog] 收到日志:', entry.level || 'info', entry.message, '| entry.timestamp:', entry.timestamp)

    // 去重：检查最后 10 条日志是否有相同内容且时间差 < 1秒
    const recentLogs = logs.value.slice(-10)
    const isDuplicate = recentLogs.some((log) => {
      // 内容不同，不是重复
      if (log.message !== entry.message || log.level !== (entry.level || 'info')) {
        return false
      }

      // 计算时间差（使用日志时间戳，而非当前时间）
      const logTime = new Date(log.timestamp).getTime()
      const timeDiff = Math.abs(entryTimestamp - logTime)

      // 1 秒内认为是重复
      return timeDiff < 1000
    })

    if (isDuplicate) {
      console.log('[appendLog] 过滤重复日志:', entry.message, '| entryTimestamp:', entryTimestamp, '| 最近日志时间戳:', recentLogs.map(l => new Date(l.timestamp).getTime()))
      return
    }

    const fullEntry: AnalysisLogEntry = {
      id: entry.id || ++logIdCounter,
      timestamp: entry.timestamp || new Date().toISOString(),
      level: entry.level || 'info',
      message: entry.message,
    }

    logs.value.push(fullEntry)
    console.log('[appendLog] 日志已写入 store.logs，当前条数:', logs.value.length, '| 日志内容:', fullEntry.message)

    // 限制日志数量（最多 1000 条）
    if (logs.value.length > 1000) {
      logs.value.splice(0, logs.value.length - 1000)
    }
  }

  /**
   * 清空日志
   */
  function clearLogs(): void {
    logs.value = []
    logIdCounter = 0
  }

  /** 清理临时仓库 */
  async function cleanupRepo(): Promise<void> {
    // 优先使用深度分析结果，回退到旧版结果
    const repoName = deepAnalysisResult.value?.repoName || result.value?.repoName
    if (!repoName) return

    cleanupStatus.value = 'cleaning'
    try {
      const response = await ipc.aiCodeAnalysis.cleanupRepo(repoName)
      if (response.success) {
        cleanupStatus.value = 'done'
      } else {
        cleanupStatus.value = 'idle'
        error.value = response.error || '清理失败'
      }
    } catch (err: any) {
      cleanupStatus.value = 'idle'
      error.value = err.message
    }
  }

  /** 清理监听器 */
  function cleanupListeners(): void {
    if (streamChunkCleanup) {
      streamChunkCleanup()
      streamChunkCleanup = null
    }
    if (streamEndCleanup) {
      streamEndCleanup()
      streamEndCleanup = null
    }
    if (cloneProgressCleanup) {
      cloneProgressCleanup()
      cloneProgressCleanup = null
    }
    if (scanProgressCleanup) {
      scanProgressCleanup()
      scanProgressCleanup = null
    }
    stopPollingLogs()
  }

  /** 重置状态 */
  function reset(): void {
    analyzing.value = false
    phase.value = 'idle'
    streamContent.value = ''
    result.value = null
    deepAnalysisResult.value = null
    error.value = null
    cloneProgress.value = null
    scanProgress.value = null
    cleanupStatus.value = 'idle'
    deepAnalysisMode.value = false
    clearLogs()

    // 清理 AI 输出状态
    agentThinking.value = ''
    agentToolCalls.value = []

    // 断开 SSE 连接
    disconnectSSE()

    cleanupListeners()
  }

  /**
   * 保存分析结果到 localStorage（历史记录）
   * @param result 分析结果
   */
  function saveResultToHistory(result: AIDeepAnalysisResult): void {
    try {
      const historyKey = 'ai-analysis-history'
      const raw = localStorage.getItem(historyKey)
      let history: AIDeepAnalysisResult[] = raw ? JSON.parse(raw) : []

      // 添加到历史记录开头
      history.unshift(result)

      // 最多保留 10 条
      if (history.length > 10) {
        history = history.slice(0, 10)
      }

      localStorage.setItem(historyKey, JSON.stringify(history))
    } catch (err) {
      console.error('[AiAnalysisStore] 保存历史记录失败:', err)
    }
  }

  /**
   * 获取历史记录
   * @returns 历史记录列表
   */
  function getHistoryFromStorage(): AIDeepAnalysisResult[] {
    try {
      const historyKey = 'ai-analysis-history'
      const raw = localStorage.getItem(historyKey)
      return raw ? JSON.parse(raw) : []
    } catch (err) {
      console.error('[AiAnalysisStore] 读取历史记录失败:', err)
      return []
    }
  }

  /**
   * 清除历史记录
   */
  function clearHistory(): void {
    try {
      localStorage.removeItem('ai-analysis-history')
    } catch (err) {
      console.error('[AiAnalysisStore] 清除历史记录失败:', err)
    }
  }

  return {
    // State
    analyzing,
    phase,
    streamContent,
    result,
    deepAnalysisResult,
    error,
    repoConfig,
    cleanupStatus,
    gitAvailable,
    gitChecking,
    cloneProgress,
    scanProgress,
    logs,
    autoScroll,
    sessionId,
    deepAnalysisMode,

    // SSE State
    sseConnected,
    sseConnecting,
    sseError,
    agentThinking,
    agentToolCalls,

    // Getters
    phaseDescription,
    hasLogs,
    latestLog,

    // Actions
    loadConfig,
    saveConfig,
    addRepoUrlToHistory,
    checkGitAvailability,
    checkDiskSpace,
    startAnalysis,
    cancelAnalysis,
    connectSSE,
    disconnectSSE,
    appendLog,
    clearLogs,
    cleanupRepo,
    reset,
    saveResultToHistory,
    getHistoryFromStorage,
    clearHistory,
  }
})
