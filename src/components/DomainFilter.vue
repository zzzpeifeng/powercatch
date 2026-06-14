<template>
  <div class="p-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center gap-2 mb-2">
      <span class="text-xs font-medium text-gray-500 dark:text-gray-400">域名过滤</span>
      <span class="text-xs text-gray-400 dark:text-gray-500">（支持 * 通配符，匹配任意一项即展示）</span>
    </div>
    <div class="tag-input-container" ref="containerRef">
      <span
        v-for="(filter, index) in filters"
        :key="index"
        class="tag-item"
      >
        <span>{{ filter }}</span>
        <span class="tag-remove" @click="removeFilter(index)">×</span>
      </span>
      <input
        ref="inputRef"
        v-model="inputValue"
        class="flex-1 min-w-[180px] outline-none border-none text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
        placeholder="输入域名后回车添加（支持 * 通配符，如 *shopline*）"
        @keydown.enter.prevent="addFilter"
        @keydown.backspace="handleBackspace"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { Ref } from 'vue'

const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const inputValue = ref<string>('')
const filters = ref<string[]>([...props.modelValue])

watch(
  () => props.modelValue,
  (newVal) => {
    filters.value = [...newVal]
  },
  { deep: true }
)

function addFilter(): void {
  const value = inputValue.value.trim()
  if (!value) return
  if (filters.value.includes(value)) {
    inputValue.value = ''
    return
  }
  filters.value.push(value)
  inputValue.value = ''
  emit('update:modelValue', [...filters.value])
}

function removeFilter(index: number): void {
  filters.value.splice(index, 1)
  emit('update:modelValue', [...filters.value])
}

function handleBackspace(): void {
  if (inputValue.value === '' && filters.value.length > 0) {
    removeFilter(filters.value.length - 1)
  }
}

/** 聚焦输入框（供快捷键使用） */
function focusInput(): void {
  inputRef.value?.focus()
}

defineExpose({ focusInput })
</script>
