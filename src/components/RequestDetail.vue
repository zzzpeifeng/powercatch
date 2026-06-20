<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-800">
    <!-- 无选中状态 -->
    <div v-if="!request" class="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
      <div class="text-center">
        <div class="text-3xl mb-2">📋</div>
        <div>点击左侧请求查看详情</div>
      </div>
    </div>

    <!-- 详情内容 -->
    <template v-else>
      <!-- 顶部信息栏 -->
      <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs font-medium" :class="methodClass">{{ request.method }}</span>
          <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ request.url }}</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span v-if="request.statusCode" :class="statusClass">{{ request.statusCode }}</span>
          <span v-if="request.duration !== null">{{ request.duration }}ms</span>
          <span>{{ request.deviceName || request.clientIp }}</span>
          <span>{{ formatHostWithProtocol(request.host, request.url) }}</span>
          <span class="text-gray-400">{{ formatTime(request.capturedAt) }}</span>
        </div>
      </div>

      <!-- 上下分栏（可拖拽分割线） -->
      <div ref="containerRef" class="flex-1 flex flex-col overflow-hidden">

        <!-- 上半区：请求（独立滚动） -->
        <div :style="{ height: `calc(${splitPct}% - 2px)` }" class="overflow-auto shrink-0">
          <!-- 请求区标题栏 + Tab -->
          <div class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
            <div class="flex items-center gap-2 px-4 py-2">
              <span class="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">请求</span>
              <span v-if="request.method" class="text-xs font-medium" :class="methodClass">{{ request.method }}</span>
              <!-- 请求体预览模式切换器 -->
              <div class="ml-auto flex items-center gap-1">
                <select
                  :value="forcedRequestMode || ''"
                  class="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:border-blue-400 cursor-pointer"
                  @change="onRequestModeChange"
                >
                  <option value="">自动 ({{ autoRequestMode.toUpperCase() }})</option>
                  <option v-for="opt in previewModeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </div>
            </div>
            <!-- 请求区 Tab 栏 -->
            <div class="tab-bar px-4">
              <div
                v-for="tab in requestTabs"
                :key="tab.key"
                class="tab-item"
                :class="{ active: requestTab === tab.key }"
                @click="requestTab = tab.key"
              >
                {{ tab.label }}
              </div>
            </div>
          </div>

          <!-- 请求头 -->
          <div v-if="requestTab === 'requestHeaders'" class="px-4 py-2">
            <div v-if="!isEmpty(request.requestHeaders)" class="rounded-md bg-gray-50 dark:bg-gray-900 overflow-hidden">
              <div v-for="(value, key) in request.requestHeaders" :key="key" class="flex py-1.5 px-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="text-xs font-medium text-blue-600 dark:text-blue-400 w-48 flex-shrink-0 truncate">{{ key }}</span>
                <span class="text-xs text-gray-700 dark:text-gray-300 break-all">{{ formatHeaderValue(value) }}</span>
              </div>
            </div>
            <div v-else class="text-xs text-gray-400 dark:text-gray-500 py-2">无请求头数据</div>
          </div>

          <!-- 请求体 -->
          <div v-if="requestTab === 'requestBody'" class="px-4 py-2">
            <div class="rounded-md bg-gray-50 dark:bg-gray-900 p-3 overflow-auto" style="max-height: 50vh">
              <BodyPreviewRouter
                :body="request.requestBody || ''"
                :content-type="getRequestContentType()"
                direction="request"
                :forced-mode="forcedRequestMode || undefined"
              />
            </div>
          </div>
        </div>

        <!-- 可拖拽分割线 -->
        <div
          class="h-1 cursor-row-resize bg-gray-100 dark:bg-gray-800 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors flex items-center justify-center shrink-0 group"
          @mousedown="onDividerMouseDown"
        >
          <div class="w-8 h-0.5 bg-gray-300 dark:bg-gray-600 rounded-full group-hover:bg-white transition-colors"></div>
        </div>

        <!-- 下半区：响应（独立滚动） -->
        <div :style="{ height: `calc(${100 - splitPct}% - 2px)` }" class="overflow-auto shrink-0">
          <!-- 响应区标题栏 + Tab -->
          <div class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
            <div class="flex items-center gap-2 px-4 py-2">
              <span class="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">响应</span>
              <span v-if="request.statusCode" :class="statusClass" class="text-xs font-medium">{{ request.statusCode }}</span>
              <span v-if="request.duration !== null" class="text-xs text-gray-500">{{ request.duration }}ms</span>
              <!-- 预览模式切换器 -->
              <div class="ml-auto flex items-center gap-1">
                <select
                  :value="forcedResponseMode || ''"
                  class="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:border-blue-400 cursor-pointer"
                  @change="onResponseModeChange"
                >
                  <option value="">自动 ({{ autoResponseMode.toUpperCase() }})</option>
                  <option v-for="opt in previewModeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </div>
            </div>
            <!-- 响应区 Tab 栏 -->
            <div class="tab-bar px-4">
              <div
                v-for="tab in responseTabs"
                :key="tab.key"
                class="tab-item"
                :class="{ active: responseTab === tab.key }"
                @click="responseTab = tab.key"
              >
                {{ tab.label }}
              </div>
            </div>
          </div>

          <!-- 响应头 -->
          <div v-if="responseTab === 'responseHeaders'" class="px-4 py-2">
            <div v-if="!isEmpty(request.responseHeaders)" class="rounded-md bg-gray-50 dark:bg-gray-900 overflow-hidden">
              <div v-for="(value, key) in request.responseHeaders" :key="key" class="flex py-1.5 px-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="text-xs font-medium text-green-600 dark:text-green-400 w-48 flex-shrink-0 truncate">{{ key }}</span>
                <span class="text-xs text-gray-700 dark:text-gray-300 break-all">{{ formatHeaderValue(value) }}</span>
              </div>
            </div>
            <div v-else class="text-xs text-gray-400 dark:text-gray-500 py-2">无响应头数据</div>
          </div>

          <!-- 响应体 -->
          <div v-if="responseTab === 'responseBody'" class="px-4 py-2">
            <div class="rounded-md bg-gray-50 dark:bg-gray-900 p-3 overflow-auto" style="max-height: 50vh">
              <BodyPreviewRouter
                :body="request.responseBody || ''"
                :content-type="getResponseContentType()"
                direction="response"
                :forced-mode="forcedResponseMode || undefined"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type Ref } from 'vue'
import type { CaptureRequest } from '../services/types'
import { formatHostWithProtocol } from '../utils/url-formatter'
import { parseBody, type PreviewMode } from '../utils/body-preview-parser'
import BodyPreviewRouter from './body-preview/BodyPreviewRouter.vue'

const props = defineProps<{
  request: CaptureRequest | null
}>()

// 分割线位置（上区百分比，默认 50%）
const splitPct = ref(50)
const containerRef: Ref<HTMLElement | null> = ref(null)

// 请求区 Tab 状态
const requestTabs = [
  { key: 'requestHeaders', label: '请求头' },
  { key: 'requestBody', label: '请求体' },
]
const requestTab = ref('requestHeaders')

// 响应区 Tab 状态
const responseTabs = [
  { key: 'responseHeaders', label: '响应头' },
  { key: 'responseBody', label: '响应体' },
]
const responseTab = ref('responseHeaders')

// 预览模式切换（null = 自动检测）
const forcedResponseMode = ref<PreviewMode | null>(null)
const forcedRequestMode = ref<PreviewMode | null>(null)

// 拖拽分割线
function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  if (!containerRef.value) return

  const startY = e.clientY
  const startPct = splitPct.value

  function onMouseMove(e: MouseEvent) {
    const rect = containerRef.value!.getBoundingClientRect()
    const delta = e.clientY - startY
    const deltaPct = (delta / rect.height) * 100
    let newPct = startPct + deltaPct
    newPct = Math.max(10, Math.min(90, newPct))
    splitPct.value = Math.round(newPct * 10) / 10
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

const methodClass = computed(() => {
  const classes: Record<string, string> = {
    GET: 'method-get',
    POST: 'method-post',
    PUT: 'method-put',
    DELETE: 'method-delete',
    PATCH: 'method-patch',
  }
  return classes[props.request?.method || ''] || 'badge bg-gray-100 text-gray-700'
})

const statusClass = computed(() => {
  const code = props.request?.statusCode
  if (!code) return 'text-gray-400'
  if (code >= 200 && code < 300) return 'text-green-600'
  if (code >= 300 && code < 400) return 'text-yellow-600'
  if (code >= 400) return 'text-red-600'
  return 'text-gray-600'
})

// 时间格式化
function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Content-Type 提取
function getResponseContentType(): string {
  if (!props.request?.responseHeaders) return ''
  const ct = props.request.responseHeaders['content-type'] || props.request.responseHeaders['Content-Type'] || ''
  return Array.isArray(ct) ? ct[0] || '' : ct
}

function getRequestContentType(): string {
  if (!props.request?.requestHeaders) return ''
  const ct = props.request.requestHeaders['content-type'] || props.request.requestHeaders['Content-Type'] || ''
  return Array.isArray(ct) ? ct[0] || '' : ct
}

// 自动检测的预览模式
const autoResponseMode = computed(() => {
  if (!props.request?.responseBody) return 'text' as PreviewMode
  return parseBody(props.request.responseBody, getResponseContentType()).mode
})

const autoRequestMode = computed(() => {
  if (!props.request?.requestBody) return 'text' as PreviewMode
  return parseBody(props.request.requestBody, getRequestContentType()).mode
})

// 预览模式选项
const previewModeOptions: { value: PreviewMode; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
  { value: 'css', label: 'CSS' },
  { value: 'js', label: 'JS' },
  { value: 'image', label: '图片' },
  { value: 'hex', label: 'Hex' },
  { value: 'text', label: '纯文本' },
]

function formatHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ')
  return value || ''
}

function isEmpty(obj: Record<string, any>): boolean {
  return !obj || Object.keys(obj).length === 0
}

function onResponseModeChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  forcedResponseMode.value = val ? (val as PreviewMode) : null
}

function onRequestModeChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  forcedRequestMode.value = val ? (val as PreviewMode) : null
}
</script>

<style scoped>
.method-get { color: #0ea5e9; font-weight: 600; }
.method-post { color: #f59e0b; font-weight: 600; }
.method-put { color: #8b5cf6; font-weight: 600; }
.method-delete { color: #ef4444; font-weight: 600; }
.method-patch { color: #ec4899; font-weight: 600; }

/* Tab 栏样式（复用全局 .tab-bar / .tab-item） */
:deep(.tab-bar) {
  display: flex;
  gap: 0;
  border-bottom: none;
  padding-bottom: 0;
}
:deep(.tab-item) {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  color: var(--color-text-secondary);
  transition: all 0.15s;
}
:deep(.tab-item:hover) {
  color: var(--color-text);
}
:deep(.tab-item.active) {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

/* vue-json-pretty 样式覆盖 */
:deep(.vjs-tree) {
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
}

:deep(.vjs-key) {
  color: #881391;
  font-weight: 500;
}

:deep(.vjs-value-string) {
  color: #c41a16;
}

:deep(.vjs-value-number) {
  color: #1c00cf;
}

:deep(.vjs-value-boolean) {
  color: #1c00cf;
}

:deep(.vjs-value-null) {
  color: #808080;
}
</style>
