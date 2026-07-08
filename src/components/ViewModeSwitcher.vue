<template>
  <div
    class="flex items-center rounded border border-gray-200 dark:border-gray-600 overflow-hidden text-[11px] leading-none shrink-0"
  >
    <button
      v-for="m in modes"
      :key="m.value"
      type="button"
      class="px-2 py-1 transition-colors"
      :class="viewMode === m.value
        ? 'bg-primary-500 text-white'
        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'"
      :title="m.label"
      @click="store.setViewMode(m.value)"
    >{{ m.label }}</button>
  </div>
</template>

<script setup lang="ts">
import { useRequestStore } from '../stores/request-store'
import { storeToRefs } from 'pinia'
import type { ViewMode } from '../services/types'

const store = useRequestStore()
const { viewMode } = storeToRefs(store)

/** 三态视图切换：列表 / 分组 / 树状 */
const modes: { value: ViewMode; label: string }[] = [
  { value: 'list', label: '列表' },
  { value: 'group', label: '分组' },
  { value: 'tree', label: '树状' },
]
</script>
