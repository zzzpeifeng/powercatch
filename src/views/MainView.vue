<template>
  <div class="flex-1 flex flex-col overflow-hidden">
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
      @toggle-record="handleToggleRecord"
      @compare="handleCompare"
      @export-result="showExportMenu = true"
      @clear="handleClear"
      @toggle-view="requestStore.toggleViewMode()"
    />

    <!-- 主内容区：可拖拽上下分割 -->
    <div ref="containerRef" class="flex-1 flex flex-col overflow-hidden">
      <!-- 上半区：请求列表 + 请求详情 -->
      <div
        class="flex overflow-hidden shrink-0"
        :style="{ height: `calc(${splitPct}% - 3px)` }"
      >
        <!-- 请求列表 -->
        <RequestList
          :requests="requestStore.filteredRequests"
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
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRequestStore } from '../stores/request-store'
import { useSettingsStore } from '../stores/settings-store'
import { useToast } from '../composables/useToast'
import { useKeyboardShortcuts, createMainShortcuts } from '../utils/keyboard'
import { useDebounce } from '../composables/useDebounce'
import type { CaptureRequest, ExportFormat } from '../services/types'

import { ipc } from '../services/ipc'
import DomainFilter from '../components/DomainFilter.vue'
import RecordControl from '../components/RecordControl.vue'
import RequestList from '../components/RequestList.vue'
import RequestDetail from '../components/RequestDetail.vue'
import CompareResult from '../components/CompareResult.vue'
import ExportButton from '../components/ExportButton.vue'

const router = useRouter()
const requestStore = useRequestStore()
const settingsStore = useSettingsStore()
const toast = useToast()

const domainFilterRef = ref<InstanceType<typeof DomainFilter> | null>(null)
const showExportMenu = ref<boolean>(false)
const containerRef = ref<HTMLElement | null>(null)

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

/** 列表键盘导航 — 上移 */
function handleNavigateUp(): void {
  const list = requestStore.filteredRequests
  if (list.length === 0) return

  const currentIndex = requestStore.selectedRequest
    ? list.findIndex((r) => r.id === requestStore.selectedRequest!.id)
    : -1

  const newIndex = currentIndex <= 0 ? list.length - 1 : currentIndex - 1
  requestStore.selectRequest(list[newIndex])
}

/** 列表键盘导航 — 下移 */
function handleNavigateDown(): void {
  const list = requestStore.filteredRequests
  if (list.length === 0) return

  const currentIndex = requestStore.selectedRequest
    ? list.findIndex((r) => r.id === requestStore.selectedRequest!.id)
    : -1

  const newIndex = currentIndex < 0 || currentIndex >= list.length - 1 ? 0 : currentIndex + 1
  requestStore.selectRequest(list[newIndex])
}

/** 空格键切换当前选中请求的勾选状态 */
function handleToggleSelect(): void {
  if (!requestStore.selectedRequest) return

  const activeEl = document.activeElement
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
    return
  }

  requestStore.toggleCheck(requestStore.selectedRequest)
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
  })
)
</script>
