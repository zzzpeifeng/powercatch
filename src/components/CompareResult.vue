<template>
  <div class="h-full flex flex-col border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <!-- 标题栏（保留原有能力：标题、deviceA vs deviceB、分析中...、导出、关闭） -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">AI 对比结果</span>
        <!-- AI 对比模板快速切换（从工具栏移入，标题旁） -->
        <select
          class="h-7 text-xs rounded-md border border-gray-200 dark:border-gray-600/50 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2"
          :value="settingsStore.selectedTemplateId"
          @change="settingsStore.selectTemplate(($event.target as HTMLSelectElement).value)"
          title="切换 AI 对比模板"
        >
          <option v-for="t in settingsStore.promptTemplates" :key="t.id" :value="t.id">
            {{ t.name }}{{ t.builtin ? '' : ' *' }}
          </option>
        </select>
        <span v-if="compareResult" class="text-xs text-gray-400 dark:text-gray-500">
          {{ compareResult.deviceA.name }} vs {{ compareResult.deviceB.name }}
        </span>
        <span
          v-if="effectiveIgnoreCount"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          title="当前生效的对比忽略规则（内置智能忽略 + 手动规则），点击前往设置页管理"
          @click="goToIgnoreRulesSettings"
        >忽略 {{ effectiveIgnoreCount }} 项</span>
        <span
          v-if="compareResult?.degraded"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs"
          title="AI 调用失败，已回退为结构化差异概览，点击「对比」可重试获取完整分析。"
        >⚠ 降级结果</span>
        <span v-else-if="loadingStates.comparing" class="text-xs text-gray-400 dark:text-gray-500 animate-pulse">
          分析中...
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="compareResult"
          class="btn-ghost btn-sm text-xs"
          @click="$emit('export-result')"
          :disabled="loadingStates.exporting"
        >
          <span v-if="loadingStates.exporting" class="spinner mr-1 spinner-dark"></span>
          导出
        </button>
        <button
          v-if="compareResult || loadingStates.comparing"
          class="btn-ghost btn-sm text-xs"
          @click="$emit('close')"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 概览条：same/different chips + 变更统计徽章（基于本地重算的 displayDiff） -->
    <div
      v-if="displayDiff"
      class="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs shrink-0"
    >
      <span
        v-for="item in displayDiff.overview.same"
        :key="'same-' + item"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
      >✓ {{ item }}</span>
      <span
        v-for="item in displayDiff.overview.different"
        :key="'diff-' + item"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
      >~ {{ item }}</span>

      <span class="mx-1 h-3.5 w-px bg-gray-300 dark:bg-gray-600"></span>

      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-mono">
        请求头
        <span class="text-green-600 dark:text-green-400">+{{ displayDiff.overview.stats.requestHeaders.added }}</span>
        <span class="text-amber-600 dark:text-amber-400">~{{ displayDiff.overview.stats.requestHeaders.modified }}</span>
        <span class="text-red-600 dark:text-red-400">-{{ displayDiff.overview.stats.requestHeaders.removed }}</span>
      </span>
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-mono">
        响应头
        <span class="text-green-600 dark:text-green-400">+{{ displayDiff.overview.stats.responseHeaders.added }}</span>
        <span class="text-amber-600 dark:text-amber-400">~{{ displayDiff.overview.stats.responseHeaders.modified }}</span>
        <span class="text-red-600 dark:text-red-400">-{{ displayDiff.overview.stats.responseHeaders.removed }}</span>
      </span>
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-mono">
        请求体 <span class="text-gray-800 dark:text-gray-100">{{ displayDiff.overview.stats.requestBody.changes }}</span>
      </span>
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-mono">
        响应体 <span class="text-gray-800 dark:text-gray-100">{{ displayDiff.overview.stats.responseBody.changes }}</span>
      </span>

      <span class="ml-auto inline-flex items-center px-2 py-0.5 rounded bg-amber-600 text-white font-medium">
        差异 {{ totalDiffCount }} 处
      </span>
    </div>

    <!-- Tab 栏：复用全局 .tab-bar / .tab-item（激活态 = border-b-2 + 主题色） -->
    <div class="tab-bar px-4 shrink-0">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-item', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >{{ tab.label }}</div>
    </div>

    <!-- 内容区（始终存在，无结果时显示占位） -->
    <div class="flex-1 overflow-auto p-4">
      <!-- ====== Tab 1: AI 分析（原有 Markdown 渲染） ====== -->
      <template v-if="activeTab === 'ai'">
        <!-- 加载中 -->
        <div v-if="loadingStates.comparing && !formattedContent" class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3">
          <div class="spinner !w-6 !h-6"></div>
          <span class="text-sm">AI 正在分析中，请稍候...</span>
        </div>

        <!-- 流式输出中 -->
        <div v-else-if="formattedContent" class="md-content" v-html="formattedContent"></div>

        <!-- 无结果占位 -->
        <div v-else class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-2 select-none">
          <span class="text-2xl">🤖</span>
          <span class="text-sm">勾选两个请求后点击"对比"按钮</span>
          <span class="text-xs text-gray-300 dark:text-gray-600">AI 将自动分析差异并生成对比报告</span>
        </div>
      </template>

      <!-- ====== Tab 2: 结构化差异（DiffResult 可视化，支持一键加忽略） ====== -->
      <template v-else-if="activeTab === 'diff'">
        <!-- 无结构化差异数据 -->
        <div v-if="!displayDiff" class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-2 select-none">
          <span class="text-2xl">🔍</span>
          <span class="text-sm">暂无结构化差异数据</span>
        </div>

        <div v-else class="flex flex-col gap-4">
          <!-- 内联反馈：最近加入的忽略规则 -->
          <div
            v-if="lastIgnored"
            class="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs"
          >
            <span>已加入忽略规则：<code class="font-mono">{{ lastIgnored }}</code>（AI 分析需重新对比生效）</span>
            <button class="ml-auto text-amber-600 dark:text-amber-400 hover:underline shrink-0" @click="lastIgnored = ''">✕</button>
          </div>

          <!-- 概览：same / different 列表 -->
          <div class="card p-3">
            <h4 class="text-xs font-semibold mb-2 text-[var(--color-text)]">概览</h4>
            <div class="mb-2">
              <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1">相同维度</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="item in displayDiff.overview.same"
                  :key="'ov-s-' + item"
                  class="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs"
                >✓ {{ item }}</span>
                <span v-if="!displayDiff.overview.same.length" class="text-xs text-gray-400 dark:text-gray-500">无</span>
              </div>
            </div>
            <div>
              <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1">不同维度</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="item in displayDiff.overview.different"
                  :key="'ov-d-' + item"
                  class="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs"
                >~ {{ item }}</span>
                <span v-if="!displayDiff.overview.different.length" class="text-xs text-green-600 dark:text-green-400">✓ 无差异</span>
              </div>
            </div>
          </div>

          <!-- 请求头 / 响应头差异：added / removed / modified（每行可一键加忽略） -->
          <div v-for="section in headerSections" :key="section.title" class="card p-3">
            <h4 class="text-xs font-semibold mb-2 text-[var(--color-text)]">{{ section.title }}</h4>
            <div v-if="isEmptyHeader(section.data)" class="text-xs text-gray-400 dark:text-gray-500">无差异</div>
            <template v-else>
              <div v-if="Object.keys(section.data.added).length" class="mb-2">
                <div class="text-[11px] text-green-600 dark:text-green-400 mb-1">+ 新增</div>
                <div
                  v-for="(val, key) in section.data.added"
                  :key="'a-' + key"
                  class="group flex items-center gap-2 diff-added text-xs py-0.5 break-all"
                >
                  <span class="flex-1">{{ key }}: {{ val }}</span>
                  <button
                    class="opacity-0 group-hover:opacity-100 shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity"
                    title="加入忽略规则"
                    @click="onIgnoreHeader(key)"
                  >忽略</button>
                </div>
              </div>
              <div v-if="Object.keys(section.data.removed).length" class="mb-2">
                <div class="text-[11px] text-red-600 dark:text-red-400 mb-1">- 删除</div>
                <div
                  v-for="(val, key) in section.data.removed"
                  :key="'r-' + key"
                  class="group flex items-center gap-2 diff-removed text-xs py-0.5 break-all"
                >
                  <span class="flex-1">{{ key }}: {{ val }}</span>
                  <button
                    class="opacity-0 group-hover:opacity-100 shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity"
                    title="加入忽略规则"
                    @click="onIgnoreHeader(key)"
                  >忽略</button>
                </div>
              </div>
              <div v-if="section.data.modified.length" class="mb-2">
                <div class="text-[11px] text-amber-600 dark:text-amber-400 mb-1">~ 修改</div>
                <div
                  v-for="m in section.data.modified"
                  :key="'m-' + m.key"
                  class="group flex items-center gap-2 diff-changed text-xs py-0.5 break-all"
                >
                  <span class="flex-1"><span class="diff-key">{{ m.key }}</span>: {{ m.old }} → {{ m.new }}</span>
                  <button
                    class="opacity-0 group-hover:opacity-100 shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity"
                    title="加入忽略规则"
                    @click="onIgnoreHeader(m.key)"
                  >忽略</button>
                </div>
              </div>
            </template>
          </div>

          <!-- 请求体 / 响应体差异：changes 或 delta（JSON delta 每行可一键加忽略） -->
          <div v-for="section in bodySections" :key="section.title" class="card p-3">
            <h4 class="text-xs font-semibold mb-2 text-[var(--color-text)]">
              {{ section.title }}
              <span class="text-[11px] text-gray-400 dark:text-gray-500 font-normal ml-1">({{ section.data.type }})</span>
            </h4>
            <div v-if="section.data.type === 'empty'" class="text-xs text-gray-400 dark:text-gray-500">无内容</div>
            <div v-else-if="section.data.type === 'binary'" class="text-xs text-gray-400 dark:text-gray-500">二进制内容，无法结构化对比</div>
            <div v-else-if="section.data.type === 'json' && section.data.delta && section.data.delta.length" class="flex flex-col gap-0.5">
              <div
                v-for="(d, i) in section.data.delta"
                :key="'j-' + i"
                class="group flex items-center gap-2 text-xs font-mono py-0.5 break-all"
                :class="deltaClass(d.type)"
              >
                <span class="flex-1"><span class="font-bold">{{ deltaSign(d.type) }}</span> {{ d.path }}: {{ formatDeltaValue(d) }}</span>
                <button
                  class="opacity-0 group-hover:opacity-100 shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity"
                  title="加入忽略规则"
                  @click="onIgnoreBodyPath(d.path)"
                >忽略</button>
              </div>
            </div>
            <div v-else-if="section.data.changes && section.data.changes.length" class="flex flex-col gap-0">
              <div
                v-for="(c, i) in section.data.changes"
                :key="'c-' + i"
                class="text-xs font-mono py-0.5 whitespace-pre-wrap break-all"
                :class="c.added ? 'diff-added' : c.removed ? 'diff-removed' : ''"
              >
                <span v-if="c.added" class="font-bold text-green-600 dark:text-green-400">+ </span>
                <span v-else-if="c.removed" class="font-bold text-red-600 dark:text-red-400">- </span>
                <span v-else class="text-gray-500 dark:text-gray-400">  </span>{{ c.value }}
              </div>
            </div>
            <div v-else class="text-xs text-gray-400 dark:text-gray-500">无差异</div>
          </div>
        </div>
      </template>

      <!-- ====== Tab 3: 原始报文 A·B ====== -->
      <template v-else-if="activeTab === 'raw'">
        <!-- 无请求数据占位 -->
        <div v-if="!requestA || !requestB" class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-2 select-none">
          <span class="text-2xl">📋</span>
          <span class="text-sm">勾选两个请求后点击"对比"按钮</span>
        </div>

        <div v-else class="grid grid-cols-2 gap-4 min-h-0">
          <div
            v-for="col in rawColumns"
            :key="col.label"
            class="card p-3 overflow-hidden flex flex-col"
          >
            <div class="text-xs font-semibold mb-2 text-[var(--color-text)] truncate">
              {{ col.label }} · {{ col.req?.deviceName || col.req?.clientIp || '—' }}
            </div>
            <template v-if="col.req">
              <!-- method + url -->
              <div class="mb-2 text-xs">
                <span class="text-[11px] text-gray-400 dark:text-gray-500">请求</span>
                <span class="font-mono break-all">{{ col.req.method }} {{ col.req.url }}</span>
              </div>
              <!-- statusCode + duration -->
              <div class="mb-2 text-xs flex flex-wrap gap-x-4">
                <span><span class="text-[11px] text-gray-400 dark:text-gray-500">状态码</span> {{ col.req.statusCode ?? '—' }}</span>
                <span><span class="text-[11px] text-gray-400 dark:text-gray-500">耗时</span> {{ col.req.duration ?? '—' }} ms</span>
              </div>
              <!-- 请求头 -->
              <div class="mb-2">
                <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1">请求头</div>
                <div
                  v-for="(val, key) in normalizeHeaders(col.req.requestHeaders)"
                  :key="'rh-' + key"
                  class="text-xs font-mono break-all"
                ><span class="text-gray-500 dark:text-gray-400">{{ key }}</span>: {{ val }}</div>
                <div v-if="!Object.keys(normalizeHeaders(col.req.requestHeaders)).length" class="text-xs text-gray-400 dark:text-gray-500">（无）</div>
              </div>
              <!-- 请求体 -->
              <div class="mb-2">
                <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1">请求体</div>
                <div class="overflow-auto max-h-[40vh] border border-gray-100 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-900">
                  <pre class="text-xs whitespace-pre-wrap p-2">{{ col.req.requestBody || '（空）' }}</pre>
                </div>
              </div>
              <!-- 响应头 -->
              <div class="mb-2">
                <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1">响应头</div>
                <div
                  v-for="(val, key) in normalizeHeaders(col.req.responseHeaders)"
                  :key="'sh-' + key"
                  class="text-xs font-mono break-all"
                ><span class="text-gray-500 dark:text-gray-400">{{ key }}</span>: {{ val }}</div>
                <div v-if="!Object.keys(normalizeHeaders(col.req.responseHeaders)).length" class="text-xs text-gray-400 dark:text-gray-500">（无）</div>
              </div>
              <!-- 响应体 -->
              <div class="mb-2">
                <div class="text-[11px] text-gray-400 dark:text-gray-500 mb-1">响应体</div>
                <div class="overflow-auto max-h-[40vh] border border-gray-100 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-900">
                  <pre class="text-xs whitespace-pre-wrap p-2">{{ col.req.responseBody || '（空）' }}</pre>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { CompareResult, LoadingStates, CaptureRequest, DiffResult } from '../services/types'
import { renderMarkdown } from '../utils/markdown'
import { useSettingsStore } from '../stores/settings-store'
import {
  computeDiff,
  applyIgnoreRules,
  mergeIgnoreRules,
  buildIgnoreRuleFromDiffEntry,
} from '../services/diff-engine'

const props = defineProps<{
  compareResult: CompareResult | null
  streamingText: string
  loadingStates: LoadingStates
  requestA: CaptureRequest | null
  requestB: CaptureRequest | null
  diffResult: DiffResult | null
}>()

defineEmits<{
  (e: 'export-result'): void
  (e: 'close'): void
}>()

/** 设置 store：AI 对比模板快速切换（从工具栏移入标题栏） */
const settingsStore = useSettingsStore()

/** 路由（用于「忽略 N 项」徽标点击跳转设置页） */
const router = useRouter()

/** 点击「忽略 N 项」徽标前往设置页管理对比忽略规则 */
function goToIgnoreRulesSettings(): void {
  router?.push('/settings')
}

/** 有效忽略规则数 = 用户规则 + （启用时内置名单长度），用于「忽略 N 项」徽标 */
const effectiveIgnoreCount = computed<number>(() =>
  mergeIgnoreRules(settingsStore.compareIgnoreRules, settingsStore.compareUseBuiltinIgnore).length,
)

/** 本地重算的结构化差异（点击「忽略」后即时剔除，不触发 AI / IPC） */
const displayDiff = ref<DiffResult | null>(props.diffResult)
/** 最近一次加入的忽略规则（内联反馈） */
const lastIgnored = ref<string>('')

/** 用当前生效忽略规则对 A/B 重算结构化差异 */
function recomputeDisplayDiff(): void {
  const a = props.requestA
  const b = props.requestB
  if (!a || !b) return
  const effective = mergeIgnoreRules(settingsStore.compareIgnoreRules, settingsStore.compareUseBuiltinIgnore)
  const ra = applyIgnoreRules(a, effective)
  const rb = applyIgnoreRules(b, effective)
  displayDiff.value = computeDiff(ra, rb)
}

/** 将某 Header/Query 名加入忽略规则并重算 */
async function onIgnoreHeader(key: string): Promise<void> {
  const rule = buildIgnoreRuleFromDiffEntry({ category: 'header', name: key })
  if (!rule) return
  const next = Array.from(new Set([...settingsStore.compareIgnoreRules, rule]))
  await settingsStore.setCompareIgnoreRules(next)
  recomputeDisplayDiff()
  lastIgnored.value = rule
}

/** 将某 JSON body 路径加入忽略规则并重算 */
async function onIgnoreBodyPath(path: string): Promise<void> {
  const rule = buildIgnoreRuleFromDiffEntry({ category: 'body', path })
  if (!rule) return
  const next = Array.from(new Set([...settingsStore.compareIgnoreRules, rule]))
  await settingsStore.setCompareIgnoreRules(next)
  recomputeDisplayDiff()
  lastIgnored.value = rule
}

/** 新对比结果 / 请求变化到来时，重置本地重算状态 */
watch(
  () => [props.diffResult, props.requestA, props.requestB],
  () => {
    displayDiff.value = props.diffResult
    lastIgnored.value = ''
  },
)

/** 当前激活的 Tab */
const activeTab = ref<'ai' | 'diff' | 'raw'>('ai')

/** Tab 定义 */
const tabs: Array<{ key: 'ai' | 'diff' | 'raw'; label: string }> = [
  { key: 'ai', label: 'AI 分析' },
  { key: 'diff', label: '结构化差异' },
  { key: 'raw', label: '原始报文 A·B' },
]

/** AI 分析 Markdown（保留原逻辑：analysis 优先，其次流式文本） */
const formattedContent = computed(() => {
  const text = props.compareResult?.analysis || props.streamingText
  if (!text) return ''
  return renderMarkdown(text)
})

/** 概览条汇总徽章：四项变更计数之和（基于本地重算 displayDiff） */
const totalDiffCount = computed<number>(() => {
  const d = displayDiff.value
  if (!d) return 0
  const s = d.overview.stats
  return (
    s.requestHeaders.added +
    s.requestHeaders.removed +
    s.requestHeaders.modified +
    s.requestBody.changes +
    s.responseHeaders.added +
    s.responseHeaders.removed +
    s.responseHeaders.modified +
    s.responseBody.changes
  )
})

/** 请求头 / 响应头 差异区块（基于本地重算 displayDiff） */
const headerSections = computed(() => {
  if (!displayDiff.value) return []
  return [
    { title: '请求头差异', data: displayDiff.value.requestHeaders },
    { title: '响应头差异', data: displayDiff.value.responseHeaders },
  ]
})

/** 请求体 / 响应体 差异区块（基于本地重算 displayDiff） */
const bodySections = computed(() => {
  if (!displayDiff.value) return []
  return [
    { title: '请求体差异', data: displayDiff.value.requestBody },
    { title: '响应体差异', data: displayDiff.value.responseBody },
  ]
})

/** 原始报文两栏 */
const rawColumns = computed(() => [
  { label: '请求 A', req: props.requestA },
  { label: '请求 B', req: props.requestB },
])

// ===== 渲染辅助函数 =====

/** 判断 headers diff 是否为空 */
function isEmptyHeader(data: {
  added: Record<string, string>
  removed: Record<string, string>
  modified: Array<{ key: string; old: string; new: string }>
}): boolean {
  return (
    Object.keys(data.added).length === 0 &&
    Object.keys(data.removed).length === 0 &&
    data.modified.length === 0
  )
}

/** JSON delta 符号 */
function deltaSign(type: string): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '-'
  return '~'
}

/** JSON delta 着色 class */
function deltaClass(type: string): string {
  if (type === 'added') return 'text-green-600 dark:text-green-400'
  if (type === 'removed') return 'text-red-600 dark:text-red-400'
  return 'text-amber-600 dark:text-amber-400'
}

/** 将 JSON delta 的 old/new 值格式化为可读字符串 */
function formatDeltaValue(d: { type: string; oldValue?: unknown; newValue?: unknown }): string {
  const fmt = (v: unknown): string => {
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    if (typeof v === 'string') return v
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  if (d.type === 'added') return fmt(d.newValue)
  if (d.type === 'removed') return fmt(d.oldValue)
  return `${fmt(d.oldValue)} → ${fmt(d.newValue)}`
}

/** 将 HttpHeaders（值可能为 string[]）规范化为 string 映射，便于展示 */
function normalizeHeaders(headers: Record<string, string | string[] | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue
    out[key] = Array.isArray(val) ? val.join(', ') : String(val)
  }
  return out
}
</script>
