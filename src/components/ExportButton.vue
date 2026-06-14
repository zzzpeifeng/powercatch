<template>
  <div class="relative" ref="dropdownRef">
    <button
      class="btn-secondary btn-sm flex items-center gap-1"
      :disabled="disabled"
      @click="showDropdown = !showDropdown"
    >
      <span>导出</span>
      <span class="text-xs">▾</span>
    </button>

    <!-- 下拉菜单 -->
    <Transition name="fade">
      <div
        v-if="showDropdown"
        class="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[120px]"
      >
        <button
          v-for="format in formats"
          :key="format.key"
          class="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          @click="handleExport(format.key)"
        >
          {{ format.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { ExportFormat } from '../services/types'

defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  (e: 'export', format: ExportFormat): void
}>()

const showDropdown = ref<boolean>(false)
const dropdownRef = ref<HTMLDivElement | null>(null)

const formats = [
  { key: 'json' as ExportFormat, label: 'JSON 文件' },
  { key: 'html' as ExportFormat, label: 'HTML 报告' },
  { key: 'txt' as ExportFormat, label: 'TXT 文本' },
]

function handleExport(format: ExportFormat): void {
  showDropdown.value = false
  emit('export', format)
}

function handleClickOutside(event: MouseEvent): void {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
