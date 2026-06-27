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

    <!-- 右侧：下拉菜单 + 操作按钮 -->
    <div class="flex items-center gap-2">
      <!-- 工具下拉菜单 -->
      <DropdownMenu ref="toolsMenuRef" label="工具" :badge-count="breakpointCount + mapLocalCount + mapRemoteCount + autoResponderCount + rewriteRulesCount">
        <template #icon>
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
          </svg>
        </template>
        <button
          class="dropdown-item"
          @click="$emit('toggle-breakpoint'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-red-500" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a1 1 0 011 1v1h1a1 1 0 110 2H9v2h2a1 1 0 110 2H9v2h1a1 1 0 110 2H9v1a1 1 0 11-2 0v-1H6a1 1 0 110-2h1V9H5a1 1 0 110-2h1V5H5a1 1 0 110-2h1V2a1 1 0 011-1z" />
          </svg>
          <span class="flex-1">断点</span>
          <span
            v-if="breakpointCount > 0"
            class="min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[9px] font-bold rounded-full bg-red-500 text-white"
          >
            {{ breakpointCount }}
          </span>
        </button>
        <button
          class="dropdown-item"
          @click="$emit('toggle-map-local'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <span class="flex-1">Map Local</span>
          <span
            v-if="mapLocalCount > 0"
            class="min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[9px] font-bold rounded-full bg-green-500 text-white"
          >
            {{ mapLocalCount }}
          </span>
        </button>
        <button
          class="dropdown-item"
          @click="$emit('toggle-map-remote'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span class="flex-1">Map Remote</span>
          <span
            v-if="mapRemoteCount > 0"
            class="min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[9px] font-bold rounded-full bg-blue-500 text-white"
          >
            {{ mapRemoteCount }}
          </span>
        </button>
        <button
          class="dropdown-item"
          @click="$emit('toggle-auto-responder'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span class="flex-1">Auto Responder</span>
          <span
            v-if="autoResponderCount > 0"
            class="min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[9px] font-bold rounded-full bg-orange-500 text-white"
          >
            {{ autoResponderCount }}
          </span>
        </button>
        <button
          class="dropdown-item"
          @click="$emit('toggle-rewrite-rules'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-teal-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span class="flex-1">Rewrite Rules</span>
          <span
            v-if="rewriteRulesCount > 0"
            class="min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[9px] font-bold rounded-full bg-teal-500 text-white"
          >
            {{ rewriteRulesCount }}
          </span>
        </button>
        <button
          class="dropdown-item"
          :disabled="checkedCount !== 2"
          @click="$emit('open-diff'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span class="flex-1">Diff 视图</span>
          <span class="text-[10px] text-gray-400">{{ checkedCount }}/2</span>
        </button>
        <div class="h-px bg-gray-200 dark:bg-gray-600 my-1"></div>
        <button
          class="dropdown-item"
          @click="$emit('toggle-session-manager'); toolsMenuRef?.close()"
        >
          <svg class="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span class="flex-1">会话管理</span>
        </button>
      </DropdownMenu>

      <!-- AI 处理下拉菜单 -->
      <DropdownMenu ref="aiMenuRef" label="AI 处理">
        <template #icon>
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2z" />
            <circle cx="8.5" cy="14.5" r="1.5" />
            <circle cx="15.5" cy="14.5" r="1.5" />
          </svg>
        </template>
        <button
          class="dropdown-item"
          :disabled="!canCompare || loadingStates.comparing"
          @click="$emit('compare'); aiMenuRef?.close()"
        >
          <span v-if="loadingStates.comparing" class="spinner w-4 h-4"></span>
          <svg v-else class="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span class="flex-1">{{ loadingStates.comparing ? '对比中...' : 'AI 对比' }}</span>
        </button>
      </DropdownMenu>

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
import { ref } from 'vue'
import type { CompareResult, LoadingStates } from '../services/types'
import DropdownMenu from './DropdownMenu.vue'

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
  mapLocalCount: number
  showMapLocalRules: boolean
  mapRemoteCount: number
  showMapRemoteRules: boolean
  autoResponderCount: number
  showAutoResponderRules: boolean
  rewriteRulesCount: number
  showRewriteRules: boolean
}>()

defineEmits<{
  (e: 'toggle-record'): void
  (e: 'compare'): void
  (e: 'export-result'): void
  (e: 'clear'): void
  (e: 'switch-view', mode: 'list' | 'group'): void
  (e: 'toggle-breakpoint'): void
  (e: 'toggle-map-local'): void
  (e: 'toggle-map-remote'): void
  (e: 'toggle-auto-responder'): void
  (e: 'toggle-rewrite-rules'): void
  (e: 'open-diff'): void
  (e: 'toggle-session-manager'): void
}>()

const toolsMenuRef = ref<InstanceType<typeof DropdownMenu> | null>(null)
const aiMenuRef = ref<InstanceType<typeof DropdownMenu> | null>(null)
</script>

<style scoped>
.dropdown-item {
  @apply flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors duration-150 w-full text-left;
}

.dropdown-item:disabled {
  @apply opacity-50 cursor-not-allowed;
}
</style>
