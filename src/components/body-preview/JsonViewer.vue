<template>
  <div class="json-viewer">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <!-- 搜索框 -->
      <div class="relative flex-1 min-w-[160px] max-w-[280px]">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索 key 或 value..."
          class="w-full text-xs px-2 py-1 pl-6 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-400"
        />
        <svg class="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span v-if="searchQuery && matchCount > 0" class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
          {{ matchCount }} 条
        </span>
      </div>
      <!-- 展开/折叠全部 -->
      <button
        class="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        @click="expandAll"
      >
        展开全部
      </button>
      <button
        class="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        @click="collapseAll"
      >
        折叠全部
      </button>
      <!-- 复制按钮 -->
      <button
        class="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        @click="copyJson"
      >
        {{ copied ? '已复制' : '复制 JSON' }}
      </button>
      <span v-if="isLarge" class="text-[10px] text-gray-400">数据量较大，已自动折叠</span>
    </div>

    <!-- JSON 树 -->
    <div class="json-tree-container border border-gray-200 dark:border-gray-700 rounded-md overflow-auto" style="max-height: 50vh">
      <JsonPretty
        :key="forceRenderKey"
        :data="data"
        :deep="computedDeep"
        :show-line="false"
        :show-double-quotes="true"
        :highlight-selected-node="false"
        class="p-2"
        @node-click="onNodeClick"
      />
    </div>

    <!-- 路径复制提示 -->
    <div v-if="copiedPath" class="mt-1 text-[10px] text-green-600 dark:text-green-400">
      已复制路径: {{ copiedPath }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import JsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'

const props = defineProps<{
  data: any
  raw?: string
}>()

const searchQuery = ref('')
const copied = ref(false)
const copiedPath = ref('')

const isLarge = computed(() => {
  const raw = props.raw || JSON.stringify(props.data || '')
  return raw.length > 100 * 1024
})

const computedDeep = ref(isLarge.value ? 2 : 3)

const matchCount = computed(() => {
  if (!searchQuery.value) return 0
  const q = searchQuery.value.toLowerCase()
  return countMatches(props.data, q)
})

function countMatches(obj: any, query: string): number {
  if (obj === null || obj === undefined) return 0
  if (typeof obj !== 'object') {
    return String(obj).toLowerCase().includes(query) ? 1 : 0
  }
  let count = 0
  if (Array.isArray(obj)) {
    for (const item of obj) {
      count += countMatches(item, query)
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes(query)) count++
      count += countMatches(value, query)
    }
  }
  return count
}

function expandAll() {
  computedDeep.value = 999
  forceRenderKey.value++
}

function collapseAll() {
  computedDeep.value = isLarge.value ? 2 : 3
  forceRenderKey.value++
}

const forceRenderKey = ref(0)

function copyJson() {
  const text = props.raw || JSON.stringify(props.data, null, 2)
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  })
}

function onNodeClick(node: any) {
  // 构建 JSONPath
  const path = buildJsonPath(node)
  if (path) {
    navigator.clipboard.writeText(path).then(() => {
      copiedPath.value = path
      setTimeout(() => { copiedPath.value = '' }, 2000)
    })
  }
}

function buildJsonPath(node: any): string | null {
  if (!node) return null
  // vue-json-pretty 的 node-click 事件传递的是节点数据
  // 尝试从 path 属性获取
  if (node.path !== undefined) {
    return '$' + node.path
  }
  return null
}
</script>

<style scoped>
.json-tree-container {
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
}

:deep(.vjs-tree) {
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
}

:deep(.vjs-key) {
  color: #881391;
  font-weight: 500;
}

:deep(.vjs-value-string) {
  color: #c41a16;
}

:deep(.vjs-value-number) {
  color: #1c00cf;
}

:deep(.vjs-value-boolean) {
  color: #1c00cf;
}

:deep(.vjs-value-null) {
  color: #808080;
}
</style>
