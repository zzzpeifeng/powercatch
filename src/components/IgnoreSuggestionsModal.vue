<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    @click.self="onCancel"
  >
    <div
      class="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden"
    >
      <!-- 标题栏 -->
      <div class="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <div>
          <h3 class="text-base font-semibold text-[var(--color-text)] flex items-center gap-2">
            <span>🤖</span> AI 智能忽略建议
          </h3>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
            以下字段可能为易变 / 噪声字段，勾选后将加入「对比忽略规则」，重新对比时不计入差异。
          </p>
        </div>
        <button
          class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none shrink-0"
          title="关闭"
          @click="onCancel"
        >✕</button>
      </div>

      <!-- 主体：按类别分组 -->
      <div class="flex-1 overflow-auto px-5 py-4">
        <div v-if="loading && groups.length === 0" class="flex flex-col items-center justify-center gap-3 py-10 text-gray-400 dark:text-gray-500">
          <div class="spinner !w-6 !h-6"></div>
          <span class="text-sm">AI 正在分析可忽略字段...</span>
        </div>

        <div v-else-if="groups.length === 0" class="flex flex-col items-center justify-center gap-2 py-10 text-gray-400 dark:text-gray-500">
          <span class="text-2xl">✅</span>
          <span class="text-sm">未发现可忽略的易变字段</span>
        </div>

        <div v-else class="flex flex-col gap-4">
          <div v-for="group in groups" :key="group.category" class="card p-3">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs font-semibold text-[var(--color-text)]">
                {{ group.label }}
                <span class="text-gray-400 dark:text-gray-500 font-normal">({{ group.items.length }})</span>
              </h4>
              <button
                class="text-[11px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                @click="setGroupAll(group.category, !isGroupAllSelected(group.category))"
              >{{ isGroupAllSelected(group.category) ? '本组全不选' : '本组全选' }}</button>
            </div>

            <label
              v-for="{ s, index } in group.items"
              :key="group.category + ':' + (s.name ?? s.path ?? index)"
              class="group flex items-start gap-2.5 py-1.5 px-1 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <input
                type="checkbox"
                class="mt-0.5 shrink-0"
                :checked="selected[index]"
                @change="toggleOne(index)"
              />
              <div class="min-w-0 flex-1">
                <div class="font-mono text-xs text-[var(--color-text)] break-all">{{ fieldLabel(s) }}</div>
                <div v-if="s.reason" class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 break-words">{{ s.reason }}</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <button
          class="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          :disabled="groups.length === 0"
          @click="setAll(!allSelected)"
        >{{ allSelected ? '全不选' : '全选' }}</button>

        <div class="flex items-center gap-2">
          <button
            class="btn-ghost btn-sm text-xs"
            @click="onCancel"
          >取消</button>
          <button
            class="btn-primary btn-sm text-xs"
            :disabled="selectedCount === 0"
            @click="onConfirm"
          >应用选中 ({{ selectedCount }})</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { IgnoreSuggestion } from '../services/types'

const props = defineProps<{
  /** 忽略建议列表（通常由后端 AI 分析得出） */
  suggestions: IgnoreSuggestion[]
  /** 是否正在加载（后端分析中） */
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', selected: IgnoreSuggestion[]): void
  (e: 'cancel'): void
}>()

/** 类别展示顺序与中文标签 */
const CATEGORY_LABELS: Record<IgnoreSuggestion['category'], string> = {
  header: '请求 / 响应头',
  query: '查询参数 (Query)',
  body: '响应体路径 (JSON)',
}
const CATEGORY_ORDER: IgnoreSuggestion['category'][] = ['header', 'query', 'body']

/** 勾选状态（与 suggestions 索引对齐，默认全选） */
const selected = ref<boolean[]>([])

watch(
  () => props.suggestions,
  (list) => {
    selected.value = (list ?? []).map(() => true)
  },
  { immediate: true },
)

/** 按类别分组的展示数据 */
const groups = computed(() =>
  CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: props.suggestions
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.category === category),
  })).filter((g) => g.items.length > 0),
)

/** 已勾选数量 */
const selectedCount = computed(() => selected.value.filter(Boolean).length)
/** 是否全部勾选 */
const allSelected = computed(() => selected.value.length > 0 && selected.value.every(Boolean))

/** 切换单个勾选（重新赋值数组以保证响应式更新） */
function toggleOne(index: number): void {
  selected.value = selected.value.map((v, i) => (i === index ? !v : v))
}

/** 全局全选 / 全不选 */
function setAll(value: boolean): void {
  selected.value = selected.value.map(() => value)
}

/** 某类别是否全部勾选 */
function isGroupAllSelected(category: IgnoreSuggestion['category']): boolean {
  const idx = groups.value.find((g) => g.category === category)?.items.map((i) => i.index) ?? []
  return idx.length > 0 && idx.every((i) => selected.value[i])
}

/** 某类别全选 / 全不选（重新赋值数组以保证响应式更新） */
function setGroupAll(category: IgnoreSuggestion['category'], value: boolean): void {
  const idx = groups.value.find((g) => g.category === category)?.items.map((i) => i.index) ?? []
  selected.value = selected.value.map((v, i) => (idx.includes(i) ? value : v))
}

/** 字段展示名：header/query 用 name，body 用 path */
function fieldLabel(s: IgnoreSuggestion): string {
  return s.category === 'body' ? (s.path ?? '') : (s.name ?? '')
}

/** 确认：仅回传已勾选的建议 */
function onConfirm(): void {
  const chosen = props.suggestions.filter((_, i) => selected.value[i])
  emit('confirm', chosen)
}

/** 取消 */
function onCancel(): void {
  emit('cancel')
}
</script>
