<template>
  <div class="card p-4">
    <div class="flex items-center gap-3 mb-3">
      <span class="spinner spinner-dark"></span>
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ progress?.message || '正在准备 Clone...' }}
      </span>
    </div>

    <!-- 进度条 -->
    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
      <div
        class="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
        :style="{ width: `${percent}%` }"
      ></div>
    </div>

    <!-- 百分比 -->
    <div class="flex justify-between items-center mt-2">
      <span class="text-xs text-gray-500 dark:text-gray-400">
        正在克隆仓库代码...
      </span>
      <span class="text-xs font-mono text-gray-600 dark:text-gray-400">
        {{ percent }}%
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CloneProgress } from '../services/types'

const props = defineProps<{
  progress: CloneProgress | null
}>()

const percent = computed(() => {
  if (!props.progress) return 0
  return Math.min(100, Math.max(0, Math.round(props.progress.percent)))
})
</script>
