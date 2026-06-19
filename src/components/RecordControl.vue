<template>
  <div class="flex items-center gap-3 px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
    <!-- 视图切换 Tab -->
    <div class="flex items-center rounded-lg bg-gray-100 dark:bg-gray-700 p-0.5">
      <button
        class="px-3 py-1 text-xs font-medium rounded-md transition-all duration-200"
        :class="viewMode === 'group'
          ? 'bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
        @click="$emit('switch-view', 'group')"
      >
        Structure
      </button>
      <button
        class="px-3 py-1 text-xs font-medium rounded-md transition-all duration-200"
        :class="viewMode === 'list'
          ? 'bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
        @click="$emit('switch-view', 'list')"
      >
        Sequence
      </button>
    </div>

    <!-- 录制按钮 -->
    <button
      class="flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
      :class="isRecording ? 'bg-red-500 text-white hover:bg-red-600 recording-indicator' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'"
      :disabled="loadingStates.startingProxy"
      @click="$emit('toggle-record')"
    >
      <span v-if="loadingStates.startingProxy" class="spinner" style="border-color: rgba(0,0,0,0.2); border-top-color: currentColor;"></span>
      <span v-else class="w-2 h-2 rounded-full" :class="isRecording ? 'bg-white' : 'bg-gray-500 dark:bg-gray-400'"></span>
      {{ loadingStates.startingProxy ? '启动中...' : (isRecording ? '录制中' : '录制') }}
    </button>

    <!-- 统计信息 -->
    <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
      <span>已捕获 {{ totalCount }} 条</span>
      <span v-if="domainFilters.length > 0">· 过滤后 {{ filteredCount }} 条</span>
      <span v-if="checkedCount > 0" class="text-primary-600 dark:text-primary-400 font-medium">· 已选 {{ checkedCount }}/2</span>
    </div>

    <!-- 间隔 -->
    <div class="flex-1"></div>

    <!-- 操作按钮 -->
    <button
      class="btn-primary btn-sm"
      :disabled="!canCompare || loadingStates.comparing"
      @click="$emit('compare')"
    >
      <span v-if="loadingStates.comparing" class="spinner mr-1"></span>
      {{ loadingStates.comparing ? '对比中...' : 'AI 对比' }}
    </button>

    <button
      class="btn-secondary btn-sm"
      :disabled="!compareResult || loadingStates.exporting"
      @click="$emit('export-result')"
    >
      <span v-if="loadingStates.exporting" class="spinner mr-1 spinner-dark"></span>
      导出
    </button>

    <button
      class="btn-ghost btn-sm text-xs"
      @click="$emit('clear')"
      :disabled="totalCount === 0"
    >
      清空
    </button>

  </div>
</template>

<script setup lang="ts">
import type { CompareResult, LoadingStates } from '../services/types'

defineProps<{
  isRecording: boolean
  totalCount: number
  filteredCount: number
  checkedCount: number
  canCompare: boolean
  compareResult: CompareResult | null
  loadingStates: LoadingStates
  domainFilters: string[]
  viewMode: 'list' | 'group'
}>()

defineEmits<{
  (e: 'toggle-record'): void
  (e: 'compare'): void
  (e: 'export-result'): void
  (e: 'clear'): void
  (e: 'switch-view', mode: 'list' | 'group'): void
}>()
</script>
