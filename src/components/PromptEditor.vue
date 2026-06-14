<template>
  <div class="space-y-3">
    <!-- 模板版本切换 -->
    <div class="flex items-center gap-2">
      <span class="text-sm text-gray-600">模板:</span>
      <button
        class="px-3 py-1 text-sm rounded-md transition-colors"
        :class="currentVersion === 'v1' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        @click="switchVersion('v1')"
      >
        详细版 v1
      </button>
      <button
        class="px-3 py-1 text-sm rounded-md transition-colors"
        :class="currentVersion === 'v2' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        @click="switchVersion('v2')"
      >
        精简版 v2
      </button>
      <div class="flex-1"></div>
      <button class="text-xs text-gray-400 hover:text-gray-600 transition-colors" @click="$emit('reset')">
        重置为默认
      </button>
    </div>

    <!-- 编辑区 -->
    <textarea
      v-model="localValue"
      class="input font-mono text-xs leading-relaxed resize-y"
      style="min-height: 200px; max-height: 500px;"
      placeholder="编辑 AI 对比 Prompt 模板..."
      @input="handleInput"
    ></textarea>

    <!-- 可用变量列表 -->
    <div class="flex flex-wrap gap-2">
      <span class="text-xs text-gray-500">可用变量:</span>
      <span
        v-for="v in variables"
        :key="v.key"
        class="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded cursor-pointer hover:bg-blue-100 transition-colors"
        @click="insertVariable(v.key)"
        :title="v.description"
      >
        {{ v.key }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { TEMPLATE_VARIABLES } from '../services/types'
import { useDebounce } from '../composables/useDebounce'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'reset'): void
}>()

const localValue = ref<string>(props.modelValue)
const currentVersion = ref<'v1' | 'v2'>('v1')
const variables = TEMPLATE_VARIABLES

watch(
  () => props.modelValue,
  (newVal) => {
    localValue.value = newVal
  }
)

const debouncedEmit = useDebounce((value: string) => {
  emit('update:modelValue', value)
}, 300)

function handleInput(): void {
  debouncedEmit(localValue.value)
}

function switchVersion(version: 'v1' | 'v2'): void {
  currentVersion.value = version
  emit('reset')
}

function insertVariable(variable: string): void {
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const before = localValue.value.slice(0, start)
  const after = localValue.value.slice(end)
  localValue.value = before + variable + after
  debouncedEmit(localValue.value)

  // 恢复光标位置
  setTimeout(() => {
    textarea.focus()
    textarea.selectionStart = start + variable.length
    textarea.selectionEnd = start + variable.length
  }, 0)
}
</script>
