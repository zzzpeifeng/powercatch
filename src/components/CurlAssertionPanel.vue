<template>
  <div class="curl-assertion-panel w-full">
    <!-- 面板 Header -->
    <div class="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 rounded-t-lg border border-gray-200 dark:border-gray-700">
      <h3 class="text-xs font-semibold text-gray-700 dark:text-gray-300">场景 {{ scenarioIndex + 1 }}: {{ scenarioName }}</h3>
      <div class="flex items-center gap-2">
        <span v-if="expectedStatusCode" class="text-xs px-2 py-0.5 rounded" :class="statusCodeBadgeClass">
          预期 {{ expectedStatusCode }}
        </span>
      </div>
    </div>

    <!-- 左右分栏 -->
    <div class="split-container bg-gray-50 dark:bg-gray-900">
      <!-- 左栏：curl 命令 -->
      <div class="split-pane flex flex-col border-r border-gray-200 dark:border-gray-700">
        <div class="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">cURL 命令</span>
          <button
            class="copy-btn"
            title="复制 cURL"
            @click="copyCurl"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3">
          <pre class="code-block text-green-600 dark:text-green-400">{{ curlCommand }}</pre>
        </div>
      </div>

      <!-- 右栏：Python 断言 -->
      <div class="split-pane flex flex-col">
        <div class="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">Python 断言</span>
          <button
            class="copy-btn"
            title="复制 Python 断言"
            @click="copyPython"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3">
          <pre class="code-block text-blue-600 dark:text-blue-400">{{ pythonAssertion }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  scenarioIndex: number
  scenarioName: string
  curlCommand: string
  pythonAssertion: string
  expectedStatusCode?: number
  testData?: Record<string, any>
}>()

const toast = useToast()

const statusCodeBadgeClass = computed(() => {
  const code = props.expectedStatusCode
  if (!code) return ''
  if (code >= 200 && code < 300) return 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
  if (code >= 400 && code < 500) return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400'
  if (code >= 500) return 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400'
  return 'bg-gray-100 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400'
})

async function copyCurl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.curlCommand)
    toast.success('cURL 命令已复制')
  } catch {
    toast.error('复制失败，请手动复制')
  }
}

async function copyPython(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.pythonAssertion)
    toast.success('Python 断言已复制')
  } catch {
    toast.error('复制失败，请手动复制')
  }
}
</script>

<style scoped>
/* 复制按钮 */
.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 0.25rem;
  color: var(--color-text-secondary, #9ca3af);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}
.copy-btn:hover {
  color: var(--color-text, #e5e7eb);
  background: rgba(0, 0, 0, 0.05);
}
.dark .copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* 左右分栏容器 */
.split-container {
  display: flex;
  height: 200px;
  overflow: hidden;
  border-radius: 0 0 0.5rem 0.5rem;
}

/* 每个面板：固定 50% 宽度 + min-width:0 防止 flex 子项溢出 */
.split-pane {
  flex: 1 1 50%;
  min-width: 0;       /* 关键：允许 flex 子项收缩到比内容更窄 */
  overflow: hidden;
}

/* 代码块：超长内容自动换行 */
.code-block {
  margin: 0;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;      /* 保留空白符但允许换行 */
  word-wrap: break-word;       /* 长单词/URL 强制换行 */
  overflow-wrap: break-word;   /* 标准属性 */
  word-break: break-all;       /* 无条件在任意字符处断行（适合长 URL） */
}

/* 响应式：小屏幕改为上下堆叠 */
@media (max-width: 640px) {
  .split-container {
    flex-direction: column;
    height: auto;
  }

  .split-pane {
    flex: none;
    min-height: 150px;
    max-height: 50vh;
  }

  .split-pane:first-child {
    border-right: none;
    border-bottom: 1px solid var(--color-border, rgba(107, 114, 128, 0.5));
  }
}
</style>
