<template>
  <div class="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700" style="min-width: 380px; max-width: 42%;">
    <!-- 搜索筛选 -->
    <div class="p-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center gap-1.5">
      <input
        :value="searchQuery"
        @input="store.setSearchQuery(($event.target as HTMLInputElement).value)"
        class="input input-sm text-xs flex-1"
        :placeholder="viewMode === 'group' ? '搜索域名、路径、状态码...' : '搜索路径、状态码...'"
      />
      <!-- 过滤按钮 -->
      <button
        class="flex items-center gap-0.5 px-2 py-0.5 text-[11px] rounded border transition-colors"
        :class="isFilterPanelOpen
          ? 'bg-primary-100 dark:bg-primary-900 border-primary-300 dark:border-primary-600 text-primary-700 dark:text-primary-300'
          : hasActiveFilters
            ? 'bg-blue-50 dark:bg-blue-900/50 border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400'
            : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
        @click="store.toggleFilterPanel()"
      >
        <span>{{ isFilterPanelOpen ? '△' : '▽' }}</span>
        <span>过滤</span>
        <span
          v-if="activeFilterCount > 0"
          class="ml-0.5 px-1 py-px text-[9px] rounded-full bg-blue-500 dark:bg-blue-400 text-white leading-none"
        >{{ activeFilterCount }}</span>
      </button>
      <!-- 域名排序下拉菜单（仅 group 模式显示） -->
      <select
        v-if="viewMode === 'group'"
        :value="domainSortMode"
        @change="store.setDomainSortMode(($event.target as HTMLSelectElement).value as DomainSortMode)"
        class="select select-xs text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer"
      >
        <option value="latest">最新活动</option>
        <option value="count">请求量</option>
        <option value="alphabetical">字母序</option>
      </select>
    </div>

    <!-- 过滤面板（展开态） -->
    <FilterPanel v-if="isFilterPanelOpen" />

    <!-- 激活条件标签行（折叠态 + 有过滤条件） -->
    <ActiveFilterTags v-if="!isFilterPanelOpen && hasActiveFilters" />

    <!-- 虚拟滚动列表（始终渲染，避免异步创建时高度计算失败） -->
    <RecycleScroller
      ref="scrollerRef"
      class="flex-1 request-list-scroller"
      :items="displayRows"
      :item-size="48"
      key-field="key"
      v-slot="{ item }"
      @scroll="onScroll"
    >
      <!-- 域名节点行（group 模式） -->
      <div
        v-if="item.type === 'domain'"
        class="scroller-item domain-row flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
        @click="store.toggleDomainExpand(item.host!)"
      >
        <span class="text-xs text-gray-400 w-3 shrink-0">{{ item.expanded ? '▼' : '▶' }}</span>
        <span class="text-xs shrink-0">🌐</span>
        <span class="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">{{ item.displayHost }}</span>
        <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">
          {{ item.count }}{{ item.totalCount ? `/${item.totalCount}` : '' }} 条
        </span>
        <span v-if="item.hasError" class="text-xs text-red-500 shrink-0">⚠</span>
        <span v-if="item.pendingCount && item.pendingCount > 0" class="text-xs text-yellow-500 shrink-0">⏳{{ item.pendingCount }}</span>
        <span v-if="item.hasChecked" class="w-1 h-6 bg-primary-500 rounded-full shrink-0"></span>
      </div>

      <!-- 请求行（两种模式共用） -->
      <div
        v-else
        class="scroller-item"
        :style="{ paddingLeft: `${item.depth * 20 + 8}px` }"
        :class="{
          selected: selectedRequest?.id === item.request!.id,
          'bg-blue-50 dark:bg-blue-900': item.request!.checked,
        }"
        @click="$emit('select', item.request!)"
      >
        <!-- 勾选框 -->
        <input
          type="checkbox"
          :checked="item.request!.checked"
          class="flex-shrink-0 cursor-pointer"
          @click.stop="$emit('toggle-check', item.request!)"
        />

        <!-- 请求信息 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium" :class="methodClass(item.request!.method)">{{ item.request!.method }}</span>
            <span class="text-xs text-gray-700 dark:text-gray-300 truncate">{{ item.request!.path }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <span class="text-gray-500 dark:text-gray-400 shrink-0 font-mono tabular-nums">{{ formatTime(item.request!.capturedAt) }}</span>
            <span :class="item.request!.statusCode ? statusClass(item.request!.statusCode) : 'text-gray-400'">{{ item.request!.statusCode ?? '-' }}</span>
            <span v-if="item.request!.statusCode !== null">{{ item.request!.duration }}ms</span>
            <span class="truncate">{{ item.request!.deviceName || item.request!.clientIp }}</span>
            <span v-if="item.depth === 0" class="text-gray-600 dark:text-gray-400 truncate max-w-[160px]">{{ formatHostWithProtocol(item.request!.host, item.request!.url) }}</span>
          </div>
        </div>
      </div>
    </RecycleScroller>

    <!-- 空状态（displayRows 为空时显示） -->
    <div
      v-if="displayRows.length === 0"
      class="flex-1 flex items-center justify-center h-full text-gray-600 dark:text-gray-400 text-sm"
    >
      <div class="text-center">
        <div class="text-3xl mb-2">📡</div>
        <div v-if="searchQuery.trim() && filteredRequests.length > 0 && displayRows.length === 0">
          未找到匹配的请求
        </div>
        <div v-else-if="!isRecording">
          点击录制按钮开始抓包
        </div>
        <div v-else>
          等待请求中...
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RecycleScroller } from 'vue-virtual-scroller'
import { ref, watch, nextTick } from 'vue'
import { useRequestStore } from '../stores/request-store'
import { storeToRefs } from 'pinia'
import type { CaptureRequest, DomainSortMode } from '../services/types'
import { formatHostWithProtocol } from '../utils/url-formatter'
import FilterPanel from './FilterPanel.vue'
import ActiveFilterTags from './ActiveFilterTags.vue'

const store = useRequestStore()
const {
  searchQuery, displayRows, viewMode, filteredRequests, domainSortMode,
  isFilterPanelOpen, hasActiveFilters, activeFilterCount,
} = storeToRefs(store)

const scrollerRef = ref<InstanceType<typeof RecycleScroller> | null>(null)
const userScrolled = ref(false)

function onScroll(): void {
  if (scrollerRef.value) {
    const el = (scrollerRef.value as any).$el as HTMLElement
    userScrolled.value = el.scrollTop > 10
  }
}

watch(
  () => store.flatTreeRows,
  () => {
    if (store.isRecording && !userScrolled.value && !store.searchQuery) {
      nextTick(() => {
        scrollerRef.value?.scrollToItem(0)
      })
    }
  }
)

const props = defineProps<{
  selectedRequest: CaptureRequest | null
  isRecording: boolean
}>()

defineEmits<{
  (e: 'select', request: CaptureRequest): void
  (e: 'toggle-check', request: CaptureRequest): void
}>()

// 诊断：watch displayRows 变化
watch(
  () => store.displayRows,
  (newRows, oldRows) => {
    console.log('[RequestList] displayRows 变化：', oldRows?.length, '→', newRows?.length)
  },
  { deep: true }
)

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
