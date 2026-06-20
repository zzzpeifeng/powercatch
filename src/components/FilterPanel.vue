<template>
  <div class="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
    <!-- HTTP 方法 -->
    <div class="mb-2">
      <div class="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">HTTP 方法</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="m in httpMethods"
          :key="m"
          class="px-2 py-0.5 text-[11px] rounded-full border transition-colors"
          :class="isActive('methods', m)
            ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="store.toggleFilter('methods', m)"
        >{{ m }}</button>
      </div>
    </div>

    <!-- 状态码 -->
    <div class="mb-2">
      <div class="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">状态码</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="g in statusCodeGroups"
          :key="g.value"
          class="px-2 py-0.5 text-[11px] rounded-full border transition-colors"
          :class="isActive('statusGroups', g.value)
            ? 'bg-red-100 dark:bg-red-900 border-red-300 dark:border-red-600 text-red-700 dark:text-red-300'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="store.toggleFilter('statusGroups', g.value)"
        >{{ g.label }}</button>
      </div>
    </div>

    <!-- Content-Type -->
    <div class="mb-2">
      <div class="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Content-Type</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="ct in contentTypeGroups"
          :key="ct.value"
          class="px-2 py-0.5 text-[11px] rounded-full border transition-colors"
          :class="isActive('contentTypes', ct.value)
            ? 'bg-orange-100 dark:bg-orange-900 border-orange-300 dark:border-orange-600 text-orange-700 dark:text-orange-300'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="store.toggleFilter('contentTypes', ct.value)"
        >{{ ct.label }}</button>
      </div>
    </div>

    <!-- 响应时间 -->
    <div class="mb-2">
      <div class="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">响应时间</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="d in durationRanges"
          :key="d.value"
          class="px-2 py-0.5 text-[11px] rounded-full border transition-colors"
          :class="isActive('durationRanges', d.value)
            ? 'bg-yellow-100 dark:bg-yellow-900 border-yellow-300 dark:border-yellow-600 text-yellow-700 dark:text-yellow-300'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="store.toggleFilter('durationRanges', d.value)"
        >{{ d.label }}</button>
      </div>
    </div>

    <!-- 请求体大小 -->
    <div class="mb-2">
      <div class="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">请求体大小</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="s in sizeRanges"
          :key="s.value"
          class="px-2 py-0.5 text-[11px] rounded-full border transition-colors"
          :class="isActive('sizeRanges', s.value)
            ? 'bg-purple-100 dark:bg-purple-900 border-purple-300 dark:border-purple-600 text-purple-700 dark:text-purple-300'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="store.toggleFilter('sizeRanges', s.value)"
        >{{ s.label }}</button>
      </div>
    </div>

    <!-- 设备 IP -->
    <div v-if="store.availableClientIps.length > 0" class="mb-2">
      <div class="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">设备 IP</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="ip in store.availableClientIps"
          :key="ip"
          class="px-2 py-0.5 text-[11px] rounded-full border transition-colors"
          :class="isActive('clientIps', ip)
            ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-600 text-green-700 dark:text-green-300'
            : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'"
          @click="store.toggleFilter('clientIps', ip)"
        >{{ ip }}</button>
      </div>
    </div>

    <!-- 底部统计 + 清除 -->
    <div class="flex items-center justify-between pt-1.5 border-t border-gray-100 dark:border-gray-700">
      <span class="text-[10px] text-gray-400 dark:text-gray-500">
        <template v-if="store.hasActiveFilters">
          已激活 {{ store.activeFilterCount }} 个过滤条件 · 匹配 {{ store.advancedFilteredCount }}/{{ store.preAdvancedFilterCount }} 条
        </template>
        <template v-else>
          匹配 {{ store.preAdvancedFilterCount }} 条
        </template>
      </span>
      <button
        v-if="store.hasActiveFilters"
        class="text-[10px] text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors"
        @click="store.clearAllFilters()"
      >清除全部</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRequestStore } from '../stores/request-store'
import type {
  FilterState, StatusCodeGroup, ContentTypeGroup, DurationRange, SizeRange,
} from '../services/types'

const store = useRequestStore()

/** HTTP 方法选项 */
const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const

/** 状态码分组选项 */
const statusCodeGroups: { value: StatusCodeGroup; label: string }[] = [
  { value: '2xx', label: '2xx 成功' },
  { value: '3xx', label: '3xx 重定向' },
  { value: '4xx', label: '4xx 客户端错误' },
  { value: '5xx', label: '5xx 服务器错误' },
  { value: 'pending', label: '待响应' },
]

/** Content-Type 分组选项 */
const contentTypeGroups: { value: ContentTypeGroup; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'image', label: '图片' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'css', label: 'CSS' },
  { value: 'other', label: '其他' },
]

/** 响应时间范围选项 */
const durationRanges: { value: DurationRange; label: string }[] = [
  { value: 'fast', label: '<100ms' },
  { value: 'normal', label: '100-500ms' },
  { value: 'slow', label: '500ms-1s' },
  { value: 'very_slow', label: '>1s' },
  { value: 'pending', label: '待响应' },
]

/** 请求体大小范围选项 */
const sizeRanges: { value: SizeRange; label: string }[] = [
  { value: 'empty', label: '空' },
  { value: 'tiny', label: '<1KB' },
  { value: 'small', label: '1-10KB' },
  { value: 'medium', label: '10-100KB' },
  { value: 'large', label: '>100KB' },
]

/** 判断某个维度的某个值是否已选中 */
function isActive<K extends keyof FilterState>(category: K, value: FilterState[K][number]): boolean {
  return (store.filterState[category] as any[]).includes(value)
}
</script>
