<template>
  <div class="h-full flex flex-col border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <!-- 标题栏 -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">AI 对比结果</span>
        <span v-if="compareResult" class="text-xs text-gray-400 dark:text-gray-500">
          {{ compareResult.deviceA.name }} vs {{ compareResult.deviceB.name }}
        </span>
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

    <!-- 内容区（始终存在，无结果时显示占位） -->
    <div class="flex-1 overflow-auto p-4">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CompareResult, LoadingStates } from '../services/types'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  compareResult: CompareResult | null
  streamingText: string
  loadingStates: LoadingStates
}>()

defineEmits<{
  (e: 'export-result'): void
  (e: 'close'): void
}>()

const formattedContent = computed(() => {
  const text = props.compareResult?.analysis || props.streamingText
  if (!text) return ''
  return renderMarkdown(text)
})
</script>
