<template>
  <div class="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
    <!-- 左侧：视图切换 Tab + 录制按钮 -->
    <div class="flex items-center gap-2">
      <!-- 视图切换 Tab -->
      <div class="flex items-center rounded-lg bg-gray-100 dark:bg-gray-700 p-0.5">
        <button
          class="px-3 h-8 text-xs font-medium rounded-md transition-all duration-200"
          :class="viewMode === 'group'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="$emit('switch-view', 'group')"
        >
          Structure
        </button>
        <button
          class="px-3 h-8 text-xs font-medium rounded-md transition-all duration-200"
          :class="viewMode === 'list'
            ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="$emit('switch-view', 'list')"
        >
          Sequence
        </button>
      </div>

      <!-- 录制按钮（绿色胶囊形） -->
      <button
        class="flex items-center gap-2 px-4 h-8 rounded-full text-xs font-medium transition-all duration-200"
        :class="isRecording ? 'bg-red-500 text-white hover:bg-red-600 recording-indicator' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'"
        :disabled="loadingStates.startingProxy"
        @click="$emit('toggle-record')"
      >
        <span v-if="loadingStates.startingProxy" class="spinner w-3 h-3" style="border-color: rgba(0,0,0,0.15); border-top-color: currentColor;"></span>
        <span v-else class="w-2 h-2 rounded-full" :class="isRecording ? 'bg-white' : 'bg-green-500'"></span>
        {{ loadingStates.startingProxy ? '启动中...' : (isRecording ? '录制中' : '录制') }}
      </button>
    </div>

    <!-- 中间：统计信息（居中） -->
    <div class="flex-1 flex items-center justify-center gap-2 text-xs text-gray-600 dark:text-gray-400">
      <span>已捕获 {{ totalCount }} 条</span>
      <span v-if="domainFilters.length > 0">· 过滤后 {{ filteredCount }} 条</span>
      <span v-if="checkedCount > 0" class="text-blue-600 dark:text-blue-400 font-medium">· 已选 {{ checkedCount }}/2</span>
    </div>

    <!-- 右侧：断点 + 操作按钮 -->
    <div class="flex items-center gap-2">
      <!-- 断点按钮（带红色徽章） -->
      <button
        class="flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-md transition-all duration-200 border"
        :class="showBreakpointRules
          ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600/50'"
        @click="$emit('toggle-breakpoint')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a1 1 0 011 1v1h1a1 1 0 110 2H9v2h2a1 1 0 110 2H9v2h1a1 1 0 110 2H9v1a1 1 0 11-2 0v-1H6a1 1 0 110-2h1V9H5a1 1 0 110-2h1V5H5a1 1 0 110-2h1V2a1 1 0 011-1z" />
        </svg>
        <span>断点</span>
        <span
          v-if="breakpointCount > 0"
          class="min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold rounded-full bg-red-500 text-white"
        >
          {{ breakpointCount }}
        </span>
      </button>

      <!-- AI 对比按钮（蓝紫色实心） -->
      <button
        class="flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-all duration-200 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!canCompare || loadingStates.comparing"
        @click="$emit('compare')"
      >
        <span v-if="loadingStates.comparing" class="spinner w-3 h-3"></span>
        {{ loadingStates.comparing ? '对比中...' : 'AI 对比' }}
      </button>

      <!-- 导出按钮（浅灰背景带细边框） -->
      <button
        class="flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-all duration-200 border border-gray-200 dark:border-gray-600/50 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!compareResult || loadingStates.exporting"
        @click="$emit('export-result')"
      >
        <span v-if="loadingStates.exporting" class="spinner w-3 h-3" style="border-color: rgba(0,0,0,0.15); border-top-color: currentColor;"></span>
        导出
      </button>

      <!-- 清空按钮（浅灰背景带细边框） -->
      <button
        class="flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-all duration-200 border border-gray-200 dark:border-gray-600/50 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="totalCount === 0"
        @click="$emit('clear')"
      >
        清空
      </button>
    </div>
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
  breakpointCount: number
  showBreakpointRules: boolean
}>()

defineEmits<{
  (e: 'toggle-record'): void
  (e: 'compare'): void
  (e: 'export-result'): void
  (e: 'clear'): void
  (e: 'switch-view', mode: 'list' | 'group'): void
  (e: 'toggle-breakpoint'): void
}>()
</script>
