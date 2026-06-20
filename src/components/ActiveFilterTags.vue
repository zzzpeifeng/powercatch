<template>
  <div
    v-if="store.hasActiveFilters"
    class="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-x-auto"
  >
    <span class="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">过滤：</span>

    <!-- HTTP 方法标签 -->
    <button
      v-if="store.filterState.methods.length > 0"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 shrink-0 group"
      @click="store.removeFilterGroup('methods')"
    >
      <span>{{ store.filterState.methods.join(', ') }}</span>
      <span class="text-blue-400 dark:text-blue-500 group-hover:text-blue-600 dark:group-hover:text-blue-300 ml-0.5">&times;</span>
    </button>

    <!-- 状态码标签 -->
    <button
      v-if="store.filterState.statusGroups.length > 0"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700 shrink-0 group"
      @click="store.removeFilterGroup('statusGroups')"
    >
      <span>{{ store.filterState.statusGroups.join(', ') }}</span>
      <span class="text-red-400 dark:text-red-500 group-hover:text-red-600 dark:group-hover:text-red-300 ml-0.5">&times;</span>
    </button>

    <!-- Content-Type 标签 -->
    <button
      v-if="store.filterState.contentTypes.length > 0"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700 shrink-0 group"
      @click="store.removeFilterGroup('contentTypes')"
    >
      <span>{{ store.filterState.contentTypes.join(', ') }}</span>
      <span class="text-orange-400 dark:text-orange-500 group-hover:text-orange-600 dark:group-hover:text-orange-300 ml-0.5">&times;</span>
    </button>

    <!-- 响应时间标签 -->
    <button
      v-if="store.filterState.durationRanges.length > 0"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-yellow-100 dark:bg-yellow-900/60 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700 shrink-0 group"
      @click="store.removeFilterGroup('durationRanges')"
    >
      <span>{{ formatDurationLabels() }}</span>
      <span class="text-yellow-400 dark:text-yellow-500 group-hover:text-yellow-600 dark:group-hover:text-yellow-300 ml-0.5">&times;</span>
    </button>

    <!-- 请求体大小标签 -->
    <button
      v-if="store.filterState.sizeRanges.length > 0"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 shrink-0 group"
      @click="store.removeFilterGroup('sizeRanges')"
    >
      <span>{{ formatSizeLabels() }}</span>
      <span class="text-purple-400 dark:text-purple-500 group-hover:text-purple-600 dark:group-hover:text-purple-300 ml-0.5">&times;</span>
    </button>

    <!-- 设备 IP 标签 -->
    <button
      v-if="store.filterState.clientIps.length > 0"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700 shrink-0 group"
      @click="store.removeFilterGroup('clientIps')"
    >
      <span>IP: {{ store.filterState.clientIps.join(', ') }}</span>
      <span class="text-green-400 dark:text-green-500 group-hover:text-green-600 dark:group-hover:text-green-300 ml-0.5">&times;</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useRequestStore } from '../stores/request-store'
import type { DurationRange, SizeRange } from '../services/types'

const store = useRequestStore()

const durationLabels: Record<DurationRange, string> = {
  fast: '<100ms',
  normal: '100-500ms',
  slow: '500ms-1s',
  very_slow: '>1s',
  pending: '待响应',
}

const sizeLabels: Record<SizeRange, string> = {
  empty: '空',
  tiny: '<1KB',
  small: '1-10KB',
  medium: '10-100KB',
  large: '>100KB',
}

function formatDurationLabels(): string {
  return store.filterState.durationRanges.map(d => durationLabels[d] || d).join(', ')
}

function formatSizeLabels(): string {
  return store.filterState.sizeRanges.map(s => sizeLabels[s] || s).join(', ')
}
</script>
