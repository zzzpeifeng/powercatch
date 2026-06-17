<template>
  <div class="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700" style="min-width: 380px; max-width: 42%;">
    <!-- 搜索筛选 -->
    <div class="p-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <input
        v-model="searchQuery"
        class="input input-sm text-xs w-full"
        placeholder="搜索路径、状态码..."
      />
    </div>

    <!-- 虚拟滚动列表 -->
    <RecycleScroller
      v-if="displayRequests.length > 0"
      class="flex-1 request-list-scroller"
      :items="displayRequests"
      :item-size="48"
      key-field="id"
      v-slot="{ item }"
    >
      <div
        class="scroller-item"
        :class="{
          selected: selectedRequest?.id === item.id,
          'bg-blue-50 dark:bg-blue-900': item.checked,
        }"
        @click="$emit('select', item)"
      >
        <!-- 勾选框 -->
        <input
          type="checkbox"
          :checked="item.checked"
          class="flex-shrink-0 cursor-pointer"
          @click.stop="$emit('toggle-check', item)"
        />

        <!-- 请求信息 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium" :class="methodClass(item.method)">{{ item.method }}</span>
            <span class="text-xs text-gray-700 dark:text-gray-300 truncate">{{ item.path }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <span class="text-gray-500 dark:text-gray-400 shrink-0 font-mono tabular-nums">{{ formatTime(item.capturedAt) }}</span>
            <span :class="item.statusCode ? statusClass(item.statusCode) : 'text-gray-400'">{{ item.statusCode ?? '-' }}</span>
            <span v-if="item.statusCode !== null">{{ item.duration }}ms</span>
            <span class="truncate">{{ item.deviceName || item.clientIp }}</span>
            <span class="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{{ item.host }}</span>
          </div>
        </div>
      </div>
    </RecycleScroller>

    <!-- 空状态 -->
    <div v-else class="flex-1 flex items-center justify-center h-full text-gray-600 dark:text-gray-400 text-sm">
      <div class="text-center">
        <div class="text-3xl mb-2">📡</div>
        <div v-if="!isRecording">点击录制按钮开始抓包</div>
        <div v-else>等待请求中...</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import type { CaptureRequest } from '../services/types'

const props = defineProps<{
  requests: CaptureRequest[]
  selectedRequest: CaptureRequest | null
  isRecording: boolean
}>()

defineEmits<{
  (e: 'select', request: CaptureRequest): void
  (e: 'toggle-check', request: CaptureRequest): void
}>()

const searchQuery = ref<string>('')

const displayRequests = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.requests

  return props.requests.filter((req) => {
    return (
      req.path.toLowerCase().includes(query) ||
      req.method.toLowerCase().includes(query) ||
      String(req.statusCode).includes(query) ||
      req.host.toLowerCase().includes(query)
    )
  })
})

function methodClass(method: string): string {
  const classes: Record<string, string> = {
    GET: 'method-get',
    POST: 'method-post',
    PUT: 'method-put',
    DELETE: 'method-delete',
    PATCH: 'method-patch',
  }
  return classes[method] || 'badge bg-gray-100 text-gray-700'
}

function statusClass(code: number | null): string {
  if (!code) return 'text-gray-600'
  if (code >= 200 && code < 300) return 'text-green-700'
  if (code >= 300 && code < 400) return 'text-yellow-700'
  if (code >= 400) return 'text-red-700'
  return 'text-gray-600'
}

/**
 * 格式化请求时间戳
 * - 当天：HH:mm:ss
 * - 往年：MM-DD HH:mm
 */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '--:--:--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--:--:--'

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')

  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const ss = pad(d.getSeconds())

  // 是否是今天
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  if (isToday) {
    return `${hh}:${mm}:${ss}`
  }
  // 往年：月日 + 时分
  const MM = pad(d.getMonth() + 1)
  const DD = pad(d.getDate())
  return `${MM}-${DD} ${hh}:${mm}`
}
</script>
