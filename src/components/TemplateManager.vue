<script setup lang="ts">
/**
 * AI 对比模板管理弹窗
 * 直接读写 useSettingsStore 中的模板库，父组件仅控制显隐。
 */
import { ref, computed } from 'vue'
import { useSettingsStore } from '../stores/settings-store'
import type { PromptTemplate } from '../services/types'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const settingsStore = useSettingsStore()

// 编辑区状态
const editingId = ref<string | null>(null)
const editingName = ref<string>('')
const editingContent = ref<string>('')
const isNew = ref<boolean>(false)

// 内容框是否全屏展开（隐藏左侧列表，内容框独占宽度）
const expanded = ref<boolean>(false)

// 当前编辑项是否为内置（决定删除按钮可用性）
const selectedTpl = computed<PromptTemplate | undefined>(() =>
  settingsStore.promptTemplates.find((t) => t.id === editingId.value),
)
const canDelete = computed<boolean>(
  () => !!editingId.value && !!selectedTpl.value && !selectedTpl.value.builtin,
)

// 可用占位符速查
const PLACEHOLDERS = [
  '{diff_result}',
  '{path}',
  '{device_a_name}',
  '{device_b_name}',
  '{response_a_json}',
  '{response_b_json}',
]

/** 左侧列表点击：把模板加载到编辑区 */
function selectForEdit(tpl: PromptTemplate): void {
  editingId.value = tpl.id
  editingName.value = tpl.name
  editingContent.value = tpl.content
  isNew.value = false
}

/** 新建：清空编辑区进入新建态 */
function newTemplate(): void {
  editingId.value = null
  editingName.value = ''
  editingContent.value = ''
  isNew.value = true
}

/** 保存：新建态走 saveCustomTemplate，否则 updateCustomTemplate */
function save(): void {
  const name = editingName.value.trim() || '未命名模板'
  const content = editingContent.value
  if (isNew.value) {
    const id = settingsStore.saveCustomTemplate({ name, content })
    editingId.value = id
    isNew.value = false
  } else if (editingId.value) {
    settingsStore.updateCustomTemplate(editingId.value, { name, content })
  }
}

/** 删除当前编辑模板（仅自定义） */
function remove(): void {
  if (!editingId.value) return
  settingsStore.deleteTemplate(editingId.value)
  editingId.value = null
  editingName.value = ''
  editingContent.value = ''
  isNew.value = false
}

/** 恢复内置默认 */
function resetAll(): void {
  settingsStore.resetTemplates()
  editingId.value = 'builtin-v1'
  const tpl = settingsStore.promptTemplates.find((t) => t.id === 'builtin-v1')
  editingName.value = tpl?.name ?? ''
  editingContent.value = tpl?.content ?? ''
  isNew.value = false
}

/** 关闭弹窗 */
function close(): void {
  emit('close')
}

// 默认选中第一项作为初始编辑内容
if (settingsStore.promptTemplates.length > 0) {
  selectForEdit(settingsStore.promptTemplates[0])
}
</script>

<template>
  <!-- 遮罩 + 弹窗 -->
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    @click.self="close"
  >
    <div
      class="w-[940px] max-w-[92vw] max-h-[92vh] flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden"
    >
      <!-- 标题栏 -->
      <div
        class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700"
      >
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100">AI对比Prompt管理</h3>
        <button
          class="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          :title="expanded ? '收起内容框' : '展开内容框（隐藏列表）'"
          @click="expanded = !expanded"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
          </svg>
        </button>
        <button
          class="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="关闭"
          @click="close"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- 主体：左列表面板 + 右侧编辑区 -->
      <div class="flex flex-1 min-h-0">
        <!-- 左侧模板列表 -->
        <div
          v-show="!expanded"
          class="w-56 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-2 flex flex-col gap-1"
        >
          <button
            class="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            @click="newTemplate"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建模板
          </button>

          <div
            v-for="t in settingsStore.promptTemplates"
            :key="t.id"
            class="flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-md text-left cursor-pointer transition-colors"
            :class="editingId === t.id
              ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'"
            @click="selectForEdit(t)"
          >
            <span class="flex items-center gap-1 truncate">
              <span class="truncate">{{ t.name }}</span>
              <span
                v-if="t.builtin"
                class="shrink-0 px-1 rounded bg-gray-200 dark:bg-gray-600 text-[9px] text-gray-600 dark:text-gray-300"
              >内置</span>
              <span v-else class="shrink-0 text-amber-500">*</span>
            </span>
            <button
              class="shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400"
              :disabled="t.builtin"
              :title="t.builtin ? '内置模板不可删除' : '删除模板'"
              data-testid="delete-btn"
              @click.stop="editingId = t.id; remove()"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 右侧编辑区 -->
        <div class="flex-1 flex flex-col min-w-0 p-4 gap-3 overflow-y-auto">
          <div class="flex items-center gap-3">
            <label class="label w-16 shrink-0 text-gray-600 dark:text-gray-300">模板名称</label>
            <input
              v-model="editingName"
              type="text"
              class="input input-sm flex-1 text-sm"
              placeholder="请输入模板名称"
            />
          </div>

          <div class="flex-1 flex flex-col min-h-0">
            <label class="label mb-2 block text-gray-600 dark:text-gray-300">模板内容</label>
            <textarea
              v-model="editingContent"
              class="flex-1 w-full min-h-[360px] resize-none rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-3 text-sm leading-relaxed font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              placeholder="编写 Prompt 模板，可使用下方占位符"
            ></textarea>
          </div>

          <!-- 占位符速查 -->
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="p in PLACEHOLDERS"
              :key="p"
              class="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-500 dark:text-gray-300 font-mono"
            >{{ p }}</span>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-2 pt-1">
            <button class="btn btn-primary btn-sm" @click="save">保存</button>
            <button
              class="btn btn-danger btn-sm"
              :disabled="!canDelete"
              title="内置模板不可删除"
              @click="remove"
            >删除</button>
            <button class="btn btn-secondary btn-sm ml-auto" @click="resetAll">
              恢复内置默认
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
