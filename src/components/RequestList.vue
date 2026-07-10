<template>
  <div class="flex flex-col">
    <!-- 搜索筛选 -->
    <div class="p-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center gap-1.5">
      <ViewModeSwitcher />
      <input
        :value="searchQuery"
        @input="store.setSearchQuery(($event.target as HTMLInputElement).value)"
        class="input input-sm text-xs flex-1"
        :placeholder="viewMode === 'list' ? '搜索路径、状态码...' : '搜索域名、路径、状态码、方法...'"
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
      <!-- 域名排序下拉菜单（group / tree 模式显示，仅作用于域名根，决策#4） -->
      <select
        v-if="viewMode === 'group' || viewMode === 'tree'"
        :value="domainSortMode"
        @change="store.setDomainSortMode(($event.target as HTMLSelectElement).value as DomainSortMode)"
        class="select select-xs text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer"
      >
        <option value="latest">最新活动</option>
        <option value="count">请求量</option>
        <option value="alphabetical">字母序</option>
        <option value="firstSeen">首次出现</option>
      </select>

      <!-- 树模式：展开全部 / 折叠全部（U7，含中间节点） -->
      <template v-if="viewMode === 'tree'">
        <button
          class="px-1.5 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 shrink-0"
          title="展开全部（含中间节点）"
          @click="store.expandAllPaths()"
        >展开</button>
        <button
          class="px-1.5 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 shrink-0"
          title="折叠全部"
          @click="store.collapseAllPaths()"
        >折叠</button>
      </template>
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
      :item-size="viewMode === 'tree' ? 30 : 40"
      :style="{ '--row-h': viewMode === 'tree' ? '30px' : '40px' }"
      key-field="key"
      v-slot="{ item }"
      @scroll="onScroll"
    >
      <!-- 域名根行（group + tree 共用） -->
      <div
        v-if="item.type === 'domain' || item.nodeKind === 'domain'"
        class="scroller-item domain-row flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
        @click="item.nodeKind === 'domain' ? store.togglePathExpand(item.pathKey!) : store.toggleDomainExpand(item.host!)"
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

      <!-- 中间路径段行（tree 模式） -->
      <div
        v-else-if="item.nodeKind === 'intermediate'"
        class="scroller-item row-intermediate flex items-center gap-0.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 group leading-tight"
        :style="{ paddingLeft: (item.depth * 12 + 20) + 'px' }"
        @click="store.togglePathExpand(item.pathKey!)"
      >
        <!-- 展开/折叠箭头（连接线已移除，层级仅靠缩进区分） -->
        <span class="text-[10px] text-gray-400 dark:text-gray-500 w-3.5 shrink-0 leading-none">{{ item.expanded ? '▼' : '▶' }}</span>
        <!-- 路径段标签 -->
        <span class="text-xs text-gray-600 dark:text-gray-400 truncate flex-1 group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors">{{ item.segmentLabel }}</span>
        <!-- 仅在有错误或 pending 时才显示标记（避免每行重复"X条"） -->
        <span v-if="item.hasErrorDescendant" class="text-[10px] text-red-400 shrink-0 opacity-70 group-hover:opacity-100">⚠</span>
        <span v-if="item.pendingCount && item.pendingCount > 0" class="text-[10px] text-yellow-500 shrink-0 opacity-70 group-hover:opacity-100">⏳{{ item.pendingCount }}</span>
        <!-- hover 时显示后代计数 -->
        <span class="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">{{ item.descendantCount }}</span>
        <span v-if="item.hasCheckedDescendant" class="w-1 h-5 bg-primary-400 rounded-full shrink-0 opacity-60"></span>
      </div>

      <!-- 叶子请求行（tree 模式）：方法 + 路径 + 时间/状态码/耗时/IP 同行 -->
      <div
        v-else-if="item.nodeKind === 'leaf'"
        class="scroller-item row-leaf flex items-center gap-1.5 overflow-hidden"
        :style="{ paddingLeft: (item.depth * 12 + 20) + 'px', height: 'var(--row-h)' }"
        :class="{
          selected: selectedRequest?.id === item.request!.id,
          'bg-blue-50 dark:bg-blue-900': item.request!.checked,
          'bg-yellow-50 dark:bg-yellow-900/30': item.highlighted,
        }"
        @click="$emit('select', item.request!)"
        @contextmenu.prevent="handleContextMenu($event, item.request!)"
      >
        <input
          type="checkbox"
          :checked="item.request!.checked"
          class="flex-shrink-0 cursor-pointer"
          @click.stop="$emit('toggle-check', item.request!)"
        />
        <span class="text-[11px] font-semibold shrink-0" :class="methodClass(item.request!.method)">{{ item.request!.method }}</span>
        <span
          class="text-[11px] font-medium truncate flex-1 min-w-0"
          :class="isLeafError(item) ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'"
          :title="item.request!.path"
        ><span :class="{ 'font-bold': isSegmentHighlighted(item) }">{{ item.segmentLabel }}</span></span>
        <span
          v-if="item.request!.isGraphQL && item.request!.graphQLOperationName"
          class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          :class="graphQLOperationClass(item.request!.graphQLOperationType)"
        >
          {{ item.request!.graphQLOperationName }}
        </span>
        <span
          v-if="item.request!.isWebSocket"
          class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
          title="WebSocket 连接"
        >
          🔌 WS
        </span>
        <span class="text-[11px] text-gray-500 dark:text-gray-400 shrink-0 font-mono tabular-nums">{{ formatTime(item.request!.capturedAt) }}</span>
        <span class="text-[11px] shrink-0" :class="item.request!.statusCode ? statusClass(item.request!.statusCode) : 'text-gray-400'">{{ item.request!.statusCode ?? '-' }}</span>
        <span v-if="item.request!.statusCode !== null" class="text-[11px] text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">{{ item.request!.duration }}ms</span>
        <span class="text-[11px] text-gray-500 dark:text-gray-400 shrink-0 truncate max-w-[110px]" :title="item.request!.deviceName || item.request!.clientIp">{{ item.request!.deviceName || item.request!.clientIp }}</span>
      </div>

      <!-- 请求行（list / group 模式共用，原样保留） -->
      <div
        v-else
        class="scroller-item row-request"
        :style="{ paddingLeft: `${item.depth * 20 + 8}px` }"
        :class="{
          selected: selectedRequest?.id === item.request!.id,
          'bg-blue-50 dark:bg-blue-900': item.request!.checked,
        }"
        @click="$emit('select', item.request!)"
        @contextmenu.prevent="handleContextMenu($event, item.request!)"
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
            <!-- GraphQL operation name 标签 -->
            <span
              v-if="item.request!.isGraphQL && item.request!.graphQLOperationName"
              class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              :class="graphQLOperationClass(item.request!.graphQLOperationType)"
            >
              {{ item.request!.graphQLOperationName }}
            </span>

            <!-- WebSocket 标识 -->
            <span
              v-if="item.request!.isWebSocket"
              class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              title="WebSocket 连接"
            >
              🔌 WS
            </span>
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
    <RequestContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :request="contextMenu.request"
      @close="contextMenu.visible = false"
      @toast="handleToast"
      @replay="handleReplay"
      @edit-and-replay="handleEditAndReplay"
    />
    <ReplayDialog
      :visible="replayDialog.visible"
      :request="replayDialog.request"
      @close="replayDialog.visible = false"
      @toast="handleToast"
    />
  </div>
</template>

<script setup lang="ts">
import { RecycleScroller } from 'vue-virtual-scroller'
import { ref, computed, watch, nextTick } from 'vue'
import { useRequestStore } from '../stores/request-store'
import { storeToRefs } from 'pinia'
import type { CaptureRequest, DomainSortMode, FlatTreeNode } from '../services/types'
import { formatHostWithProtocol } from '../utils/url-formatter'
import FilterPanel from './FilterPanel.vue'
import ActiveFilterTags from './ActiveFilterTags.vue'
import RequestContextMenu from './RequestContextMenu.vue'
import ReplayDialog from './ReplayDialog.vue'
import ViewModeSwitcher from './ViewModeSwitcher.vue'
import { useToast } from '../composables/useToast'
import { ipc } from '../services/ipc'

const store = useRequestStore()
const {
  searchQuery, displayRows, viewMode, filteredRequests, domainSortMode,
  isFilterPanelOpen, hasActiveFilters, activeFilterCount,
} = storeToRefs(store)

const scrollerRef = ref<InstanceType<typeof RecycleScroller> | null>(null)
const userScrolled = ref(false)
const contextMenu = ref({ visible: false, x: 0, y: 0, request: null as CaptureRequest | null })
const replayDialog = ref({ visible: false, request: null as CaptureRequest | null })
const toast = useToast()

// 注意：行高曾用 sizeField + sizedRows 可变方案，但 vue-virtual-scroller 在 itemSize=null 时
// 依赖 sizes 缓存的响应式计算，真实 Electron 渲染首帧可能高度计算失败导致列表空白；
// 已回退为「非空固定 :item-size」（见下方模板 RecycleScroller）：tree 模式 30、其余 40，
// 由 scoped 样式用 --row-h 变量统一驱动可见高度，二者取值同步、绝不取 null。

function onScroll(): void {
  if (scrollerRef.value) {
    const el = (scrollerRef.value as any).$el as HTMLElement
    userScrolled.value = el.scrollTop > 10
  }
}

function handleContextMenu(event: MouseEvent, request: CaptureRequest): void {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    request,
  }
}

function handleToast(message: string, type: string): void {
  if (type === 'success') {
    toast.success(message)
  } else if (type === 'error') {
    toast.error(message)
  } else {
    toast.info(message)
  }
}

async function handleReplay(request: CaptureRequest): Promise<void> {
  try {
    const result = await ipc.request.replay({
      method: request.method,
      url: request.url,
      requestHeaders: request.requestHeaders,
      requestBody: request.requestBody,
    })

    if (result.success) {
      toast.success(`重发成功: ${result.statusCode} (${result.duration}ms)`)
    } else {
      toast.error(`重发失败: ${result.error}`)
    }
  } catch (error: any) {
    toast.error(`重发失败: ${error.message}`)
  }
}

function handleEditAndReplay(request: CaptureRequest): void {
  replayDialog.value = {
    visible: true,
    request,
  }
}

watch(
  () => store.displayRows,
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

/** 叶子是否为错误请求（4xx/5xx） */
function isLeafError(item: FlatTreeNode): boolean {
  const code = item.request?.statusCode
  return code !== null && code !== undefined && code >= 400
}

/** 搜索命中段高亮判定：查询词命中末段标签 */
function isSegmentHighlighted(item: FlatTreeNode): boolean {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q || !item.segmentLabel) return false
  return item.segmentLabel.toLowerCase().includes(q)
}

function graphQLOperationClass(type?: string): string {
  const classes: Record<string, string> = {
    query: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
    mutation: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300',
    subscription: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
  }
  return classes[type || ''] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
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

<style scoped>
/* 连接线已移除：树状模式改用纯缩进区分子级（各 tree 行 paddingLeft = depth*12+20），避免拐角形似【「】 */


/* ── 行高（覆盖全局 .scroller-item 的 48px）──
   滚动定位由 :item-size 驱动、可见行高由 --row-h 变量驱动，二者取值同步。
   item-size 始终是【非空固定数字】（tree=30 / 其它=40），绝不取 null，
   因此不走 sizeField 缓存路径（后者在 itemSize=null 时真机首帧可能白屏，历史教训）。
   仅调整高度，不改变任何文本、箭头、徽章、菜单等行为。 */
.scroller-item {
  height: var(--row-h, 40px);
  min-height: var(--row-h, 40px);
}
</style>
