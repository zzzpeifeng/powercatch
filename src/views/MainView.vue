<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- 本机代理提示条（仅在系统代理开启时显示） -->
    <SystemProxyBanner
      v-if="systemProxyStore.isActive"
      :active-services="systemProxyStore.activeServices"
      :port="systemProxyStore.port"
      :hidden="bannerHidden"
      @hide="bannerHidden = true"
      @disable="handleDisableProxy"
    />

    <!-- 域名过滤 -->
    <DomainFilter
      ref="domainFilterRef"
      v-model="requestStore.domainFilters"
      @update:model-value="handleDomainFilterChange"
    />

    <!-- 录制控制栏 -->
    <RecordControl
      :is-recording="requestStore.isRecording"
      :total-count="requestStore.totalCount"
      :filtered-count="requestStore.filteredCount"
      :checked-count="requestStore.checkedCount"
      :can-compare="requestStore.canCompare"
      :compare-result="requestStore.compareResult"
      :loading-states="requestStore.loadingStates"
      :domain-filters="requestStore.domainFilters"
      :view-mode="requestStore.viewMode"
      :breakpoint-count="breakpointStore.rules.length"
      :show-breakpoint-rules="showBreakpointRules"
      :map-local-count="mapLocalStore.rules.length"
      :show-map-local-rules="showMapLocalRules"
      :map-remote-count="mapRemoteStore.rules.length"
      :show-map-remote-rules="showMapRemoteRules"
      :auto-responder-count="autoResponderStore.rules.length"
      :show-auto-responder-rules="showAutoResponderRules"
      :rewrite-rules-count="rewriteRulesStore.rules.length"
      :show-rewrite-rules="showRewriteRules"
      :dns-override-count="dnsOverrideStore.rules.length"
      :show-dns-override-rules="showDnsOverrideRules"
      @toggle-record="handleToggleRecord"
      @compare="handleCompare"
      @export-result="showExportMenu = true"
      @clear="handleClear"
      @switch-view="(mode: 'list' | 'group') => requestStore.setViewMode(mode)"
      @toggle-breakpoint="showBreakpointRules = !showBreakpointRules"
      @toggle-map-local="showMapLocalRules = !showMapLocalRules"
      @toggle-map-remote="showMapRemoteRules = !showMapRemoteRules"
      @toggle-auto-responder="showAutoResponderRules = !showAutoResponderRules"
      @toggle-rewrite-rules="showRewriteRules = !showRewriteRules"
      @toggle-dns-override="showDnsOverrideRules = !showDnsOverrideRules"
      @open-diff="openDiff"
      @toggle-session-manager="showSessionManager = !showSessionManager"
    />

    <!-- 断点规则面板 -->
    <BreakpointRules v-if="showBreakpointRules" @close="showBreakpointRules = false" />

    <!-- Map Local 规则面板 -->
    <MapLocalRules v-if="showMapLocalRules" @close="showMapLocalRules = false" />

    <!-- Map Remote 规则面板 -->
    <MapRemoteRules v-if="showMapRemoteRules" @close="showMapRemoteRules = false" />

    <!-- Auto Responder 规则面板 -->
    <AutoResponderRules v-if="showAutoResponderRules" @close="showAutoResponderRules = false" />

    <!-- Rewrite Rules 规则面板 -->
    <RewriteRules v-if="showRewriteRules" @close="showRewriteRules = false" />

    <!-- DNS 覆盖规则面板 -->
    <DnsOverrideRules v-if="showDnsOverrideRules" @close="showDnsOverrideRules = false" />

    <!-- 会话管理面板 -->
    <SessionManager v-if="showSessionManager" @close="showSessionManager = false" />

    <!-- 主内容区：可拖拽上下分割 -->
    <div ref="containerRef" class="flex-1 flex flex-col overflow-hidden">
      <!-- 上半区：请求列表 + 请求详情 -->
      <div
        class="flex overflow-hidden shrink-0"
        :style="{ height: `calc(${splitPct}% - 3px)` }"
      >
        <!-- 请求列表 -->
        <RequestList
          :selected-request="requestStore.selectedRequest"
          :is-recording="requestStore.isRecording"
          @select="handleSelectRequest"
          @toggle-check="requestStore.toggleCheck"
        />

        <!-- 请求详情 -->
        <RequestDetail :request="requestStore.selectedRequest" />
      </div>

      <!-- 拖拽分割线 -->
      <div
        class="h-[3px] bg-gray-100 dark:bg-gray-700 hover:bg-[var(--color-primary)] cursor-row-resize transition-colors shrink-0"
        @mousedown="onDividerMouseDown"
      ></div>

      <!-- 下半区：AI 对比结果（始终渲染，无结果时显示占位） -->
      <div
        class="flex-1 overflow-hidden min-h-0"
        :style="{ height: `calc(${100 - splitPct}% - 3px)` }"
      >
        <CompareResult
          :compare-result="requestStore.compareResult"
          :streaming-text="requestStore.streamingText"
          :loading-states="requestStore.loadingStates"
          @export-result="showExportMenu = true"
          @close="requestStore.compareResult = null"
        />
      </div>
    </div>

    <!-- 导出弹窗 -->
    <ExportButton
      v-if="showExportMenu"
      :disabled="!requestStore.compareResult"
      @export="handleExport"
      class="fixed bottom-20 right-8 z-50"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRequestStore } from '../stores/request-store'
import { useSettingsStore } from '../stores/settings-store'
import { useToast } from '../composables/useToast'
import { useKeyboardShortcuts, createMainShortcuts } from '../utils/keyboard'
import { useDebounce } from '../composables/useDebounce'
import type { CaptureRequest, ExportFormat } from '../services/types'

import { ipc } from '../services/ipc'
import { useSystemProxyStore } from '../stores/system-proxy-store'
import { useBreakpointStore } from '../stores/breakpoint-store'
import { useMapLocalStore } from '../stores/map-local-store'
import { useMapRemoteStore } from '../stores/map-remote-store'
import { useAutoResponderStore } from '../stores/auto-responder-store'
import { useRewriteRulesStore } from '../stores/rewrite-rules-store'
import { useDnsOverrideStore } from '../stores/dns-override-store'
import { useDiffStore } from '../stores/diff-store'
import SystemProxyBanner from '../components/SystemProxyBanner.vue'
import DomainFilter from '../components/DomainFilter.vue'
import RecordControl from '../components/RecordControl.vue'
import RequestList from '../components/RequestList.vue'
import RequestDetail from '../components/RequestDetail.vue'
import CompareResult from '../components/CompareResult.vue'
import ExportButton from '../components/ExportButton.vue'
import BreakpointRules from '../components/BreakpointRules.vue'
import MapLocalRules from '../components/MapLocalRules.vue'
import MapRemoteRules from '../components/MapRemoteRules.vue'
import AutoResponderRules from '../components/AutoResponderRules.vue'
import RewriteRules from '../components/RewriteRules.vue'
import DnsOverrideRules from '../components/DnsOverrideRules.vue'
import SessionManager from '../components/SessionManager.vue'

const router = useRouter()
const requestStore = useRequestStore()
const settingsStore = useSettingsStore()
const systemProxyStore = useSystemProxyStore()
const breakpointStore = useBreakpointStore()
const mapLocalStore = useMapLocalStore()
const mapRemoteStore = useMapRemoteStore()
const autoResponderStore = useAutoResponderStore()
const rewriteRulesStore = useRewriteRulesStore()
const dnsOverrideStore = useDnsOverrideStore()
const diffStore = useDiffStore()
const toast = useToast()

const domainFilterRef = ref<InstanceType<typeof DomainFilter> | null>(null)
const showExportMenu = ref<boolean>(false)
const containerRef = ref<HTMLElement | null>(null)
const bannerHidden = ref<boolean>(false)
const showBreakpointRules = ref<boolean>(false)
const showMapLocalRules = ref<boolean>(false)
const showMapRemoteRules = ref<boolean>(false)
const showAutoResponderRules = ref<boolean>(false)
const showRewriteRules = ref<boolean>(false)
const showDnsOverrideRules = ref<boolean>(false)
const showSessionManager = ref<boolean>(false)

/** 当前键盘导航焦点在 displayRows 中的索引（group 模式专用，含域名头） */
const navigationIndex = ref<number>(-1)

// 切换视图模式时重置焦点
watch(() => requestStore.viewMode, () => {
  navigationIndex.value = -1
})

// 拖拽分割线：上下比例（上半区百分比），默认 60/40
const splitPct = ref<number>(60)

// 从 localStorage 恢复上次的比例
onMounted(() => {
  const saved = localStorage.getItem('main-view-split-pct')
  if (saved) {
    const val = Number(saved)
    if (!isNaN(val) && val >= 20 && val <= 80) {
      splitPct.value = val
    }
  }

  // 启动系统代理状态轮询（开启时 banner 才能正确显示）
  systemProxyStore.startPolling()

  // 加载 Map Local、Map Remote、Auto Responder、Rewrite Rules 和 DNS 覆盖规则
  mapLocalStore.loadRules()
  mapRemoteStore.loadRules()
  autoResponderStore.loadRules()
  rewriteRulesStore.loadRules()
  dnsOverrideStore.loadRules()
})

onUnmounted(() => {
  systemProxyStore.stopPolling()
})

// 拖拽分割线
function onDividerMouseDown(e: MouseEvent): void {
  e.preventDefault()
  if (!containerRef.value) return

  const startY = e.clientY
  const startPct = splitPct.value

  function onMouseMove(e: MouseEvent): void {
    const rect = containerRef.value!.getBoundingClientRect()
    const delta = e.clientY - startY
    const deltaPct = (delta / rect.height) * 100
    let newPct = startPct + deltaPct
    newPct = Math.max(20, Math.min(80, newPct))
    splitPct.value = Math.round(newPct)
  }

  function onMouseUp(): void {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    // 保存用户偏好
    localStorage.setItem('main-view-split-pct', String(splitPct.value))
  }

  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 双击分割线恢复默认比例
function resetSplit(): void {
  splitPct.value = 60
  localStorage.setItem('main-view-split-pct', '60')
}

// 域名过滤防抖保存
const debouncedDomainSave = useDebounce((filters: string[]) => {
  settingsStore.saveDomainFilters(filters)
  ipc.proxy.setDomainFilters(filters).catch(() => {})
}, 300)

function handleDomainFilterChange(filters: string[]): void {
  requestStore.domainFilters = filters
  debouncedDomainSave(filters)
}

async function handleToggleRecord(): Promise<void> {
  const success = await requestStore.toggleRecording()
  if (success) {
    toast.success('录制已开始')
  } else if (requestStore.isRecording) {
    toast.error('录制启动失败，端口可能被占用')
  } else {
    toast.info('录制已停止')
  }
}

async function handleCompare(): Promise<void> {
  if (!requestStore.canCompare) {
    toast.warning('请先勾选两个请求')
    return
  }
  if (!settingsStore.apiKey) {
    toast.error('请先在设置页面配置 API Key')
    return
  }
  try {
    await requestStore.doCompare()
    toast.success('对比完成')
  } catch (error: any) {
    toast.error(error.message || '对比失败')
  }
}

function handleSelectRequest(request: CaptureRequest): void {
  requestStore.selectRequest(request)
  // 同步 navigationIndex 到该请求在 displayRows 中的位置
  if (requestStore.viewMode === 'group') {
    const idx = requestStore.displayRows.findIndex(r => r.type === 'request' && r.request?.id === request.id)
    if (idx >= 0) navigationIndex.value = idx
  }
}

async function handleExport(format: ExportFormat): Promise<void> {
  showExportMenu.value = false
  const success = await requestStore.doExport(format)
  if (success) {
    toast.success('导出成功')
  } else {
    toast.error('导出失败或已取消')
  }
}

function handleClear(): void {
  requestStore.clearRequests()
  toast.info('已清空所有请求')
}

/** 打开 Diff 视图 */
function openDiff(): void {
  const checked = requestStore.checkedRequests
  if (checked.length !== 2) {
    toast.warning('请先勾选 2 个请求')
    return
  }
  diffStore.setRequests(checked[0], checked[1])
  router.push('/diff')
}

/** 提示条：关闭本机代理 */
async function handleDisableProxy(): Promise<void> {
  try {
    const result = await systemProxyStore.disable()
    if (result.success) {
      toast.success(result.message)
      bannerHidden.value = true
    } else {
      toast.error(result.message)
    }
  } catch (error: any) {
    toast.error('关闭失败：' + error.message)
  }
}

/** 列表键盘导航 — 上移 */
function handleNavigateUp(): void {
  const rows = requestStore.displayRows
  if (rows.length === 0) return

  if (requestStore.viewMode === 'list') {
    // list 模式：在请求行间移动（跳过域名行）
    const reqRows = rows.filter(r => r.type === 'request')
    if (reqRows.length === 0) return
    const curReqIdx = requestStore.selectedRequest
      ? reqRows.findIndex(r => r.request!.id === requestStore.selectedRequest!.id)
      : -1
    const newReqIdx = curReqIdx <= 0 ? reqRows.length - 1 : curReqIdx - 1
    requestStore.selectRequest(reqRows[newReqIdx].request!)
    return
  }

  // group 模式：在所有可见行间移动（含域名头）
  const newIndex = navigationIndex.value <= 0 ? rows.length - 1 : navigationIndex.value - 1
  navigationIndex.value = newIndex
  const row = rows[newIndex]
  if (row.type === 'request' && row.request) {
    requestStore.selectRequest(row.request)
  }
}

/** 列表键盘导航 — 下移 */
function handleNavigateDown(): void {
  const rows = requestStore.displayRows
  if (rows.length === 0) return

  if (requestStore.viewMode === 'list') {
    const reqRows = rows.filter(r => r.type === 'request')
    if (reqRows.length === 0) return
    const curReqIdx = requestStore.selectedRequest
      ? reqRows.findIndex(r => r.request!.id === requestStore.selectedRequest!.id)
      : -1
    const newReqIdx = curReqIdx < 0 || curReqIdx >= reqRows.length - 1 ? 0 : curReqIdx + 1
    requestStore.selectRequest(reqRows[newReqIdx].request!)
    return
  }

  const newIndex = navigationIndex.value < 0 || navigationIndex.value >= rows.length - 1
    ? 0
    : navigationIndex.value + 1
  navigationIndex.value = newIndex
  const row = rows[newIndex]
  if (row.type === 'request' && row.request) {
    requestStore.selectRequest(row.request)
  }
}

/** 空格键：请求行 toggleCheck / 域名行 toggle 展开折叠 */
function handleToggleSelect(): void {
  const activeEl = document.activeElement
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
    return
  }

  // group 模式下检查焦点是否在域名行
  if (requestStore.viewMode === 'group' && navigationIndex.value >= 0) {
    const row = requestStore.displayRows[navigationIndex.value]
    if (row?.type === 'domain' && row.host) {
      requestStore.toggleDomainExpand(row.host)
      return
    }
  }

  // 请求行：toggle check
  if (requestStore.selectedRequest) {
    requestStore.toggleCheck(requestStore.selectedRequest)
  }
}

/** ← 键盘：域名头折叠 / 请求行跳到父域名头 */
function handleNavigateLeft(): void {
  if (requestStore.viewMode !== 'group') return
  const rows = requestStore.displayRows
  if (rows.length === 0) return

  // 确定当前焦点索引
  let idx = navigationIndex.value
  if (idx < 0 || idx >= rows.length) {
    // 没有焦点时，尝试从 selectedRequest 反查
    if (requestStore.selectedRequest) {
      idx = rows.findIndex(r => r.type === 'request' && r.request?.id === requestStore.selectedRequest!.id)
    }
    if (idx < 0) return
  }

  const currentRow = rows[idx]

  if (currentRow.type === 'domain') {
    // 域名头：折叠
    requestStore.toggleDomainExpand(currentRow.host!)
  } else if (currentRow.depth > 0) {
    // 请求行：跳到父域名头
    for (let i = idx - 1; i >= 0; i--) {
      if (rows[i].type === 'domain') {
        navigationIndex.value = i
        break
      }
    }
  }
}

/** → 键盘：域名头展开 */
function handleNavigateRight(): void {
  if (requestStore.viewMode !== 'group') return
  const rows = requestStore.displayRows
  if (rows.length === 0) return

  let idx = navigationIndex.value
  if (idx < 0 || idx >= rows.length) return

  const currentRow = rows[idx]

  if (currentRow.type === 'domain') {
    requestStore.toggleDomainExpand(currentRow.host!)
  }
  // 请求行：无操作
}

// 键盘快捷键
useKeyboardShortcuts(
  createMainShortcuts({
    toggleRecord: handleToggleRecord,
    compare: handleCompare,
    exportResult: () => {
      if (requestStore.compareResult) {
        handleExport('json')
      }
    },
    openSettings: () => router.push('/settings'),
    focusDomainFilter: () => domainFilterRef.value?.focusInput(),
    cancel: () => {
      showExportMenu.value = false
      requestStore.selectRequest(null)
    },
    navigateUp: handleNavigateUp,
    navigateDown: handleNavigateDown,
    toggleSelect: handleToggleSelect,
    navigateLeft: handleNavigateLeft,
    navigateRight: handleNavigateRight,
  })
)
</script>
