<template>
  <div class="analysis-log-viewer h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
    <!-- 工具栏 -->
    <div class="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-2">
        <div
          class="w-2 h-2 rounded-full"
          :class="connected ? 'bg-green-400' : 'bg-red-400'"
        />
        <span class="text-xs text-gray-600 dark:text-gray-400">
          {{ connected ? '已连接' : '未连接' }}
        </span>
        <span class="text-xs text-gray-400 dark:text-gray-500 ml-2">
          共 {{ logs.length }} 条日志
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-xs"
          :class="autoScroll ? 'btn-primary' : 'btn-secondary'"
          @click="emit('update:autoScroll', !autoScroll)"
        >
          {{ autoScroll ? '自动滚动开启' : '自动滚动关闭' }}
        </button>
        <button
          class="btn btn-xs btn-secondary"
          @click="clearLogs"
        >
          清空日志
        </button>
      </div>
    </div>

    <!-- 日志内容区 -->
    <div
      ref="logContainer"
      class="flex-1 overflow-y-auto px-4 py-2 font-mono text-sm"
      @scroll="onScroll"
    >
      <div
        v-for="log in logs"
        :key="log.id"
        class="log-entry mb-1 leading-relaxed"
        :class="levelClass(log.level)"
      >
        <span class="text-gray-400 dark:text-gray-500 mr-2">[{{ formatTime(log.timestamp) }}]</span>
        <span class="log-level mr-2">[{{ log.level }}]</span>
        <span class="log-message">{{ log.message }}</span>
      </div>

      <!-- 空状态 -->
      <div
        v-if="logs.length === 0"
        class="flex items-center justify-center h-full text-gray-400 dark:text-gray-500"
      >
        等待分析开始...
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { AnalysisLogEntry } from '../services/types'

const props = defineProps<{
  logs: AnalysisLogEntry[]
  autoScroll: boolean
  connected: boolean
}>()

const emit = defineEmits<{
  (e: 'update:autoScroll', value: boolean): void
  (e: 'clear'): void
}>()

const logContainer = ref<HTMLElement | null>(null)
let isUserScrolling = false

// 监听日志变化，自动滚动到底部
watch(
  () => props.logs.length,
  async () => {
    if (props.autoScroll && !isUserScrolling) {
      await nextTick()
      scrollToBottom()
    }
  }
)

function scrollToBottom(): void {
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
}

function onScroll(): void {
  if (!logContainer.value) return

  const { scrollTop, scrollHeight, clientHeight } = logContainer.value
  // 如果用户滚动到了接近底部（100px 内），则认为是自动滚动模式
  isUserScrolling = scrollHeight - scrollTop - clientHeight > 100
}

function clearLogs(): void {
  emit('clear')
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return isoString
  }
}

function levelClass(level: string): string {
  const classes: Record<string, string> = {
    info: 'text-blue-500 dark:text-blue-400',
    warn: 'text-yellow-500 dark:text-yellow-400',
    error: 'text-red-500 dark:text-red-400',
    debug: 'text-gray-400 dark:text-gray-500',
  }
  return classes[level] || 'text-gray-500 dark:text-gray-400'
}

// 暴露方法供父组件调用
defineExpose({
  scrollToBottom,
})
</script>

<style scoped>
.log-entry {
  word-wrap: break-word;
  white-space: pre-wrap;
}

.log-level {
  font-weight: 600;
  text-transform: uppercase;
}

.btn-xs {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
}
</style>
