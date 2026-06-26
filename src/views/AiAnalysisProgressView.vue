<template>
  <div class="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
    <!-- 顶部导航栏 -->
    <div class="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          class="btn btn-secondary text-xs"
          @click="$router.push('/ai-analysis')"
        >
          ← 返回
        </button>
        <h1 class="text-base font-semibold text-gray-900 dark:text-gray-100">AI 分析进度</h1>
      </div>
      <div class="flex items-center gap-2">
        <!-- SSE 连接状态指示器 -->
        <span
          class="text-xs px-2 py-1 rounded flex items-center gap-1"
          :class="sseStatusClass"
        >
          <span v-if="store.sseConnected" class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span v-else-if="store.sseConnecting" class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span v-else class="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
          {{ sseStatusText }}
        </span>
        <span
          class="text-xs px-2 py-1 rounded"
          :class="phaseBadgeClass"
        >
          {{ store.phaseDescription }}
        </span>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="max-w-5xl mx-auto px-4 py-4">
      <!-- 进度指示器 -->
      <div class="card p-4 mb-4">
        <div class="flex items-center gap-3 mb-4">
          <div
            v-if="store.analyzing"
            class="spinner spinner-dark"
          />
          <div
            v-else-if="store.phase === 'done'"
            class="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center"
          >
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div
            v-else-if="store.phase === 'error'"
            class="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center"
          >
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ phaseTitle }}</h2>
        </div>

        <!-- 进度条 -->
        <div v-if="store.analyzing" class="mb-4">
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              class="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-500"
              :style="`width: ${progressPercent}%`"
            />
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">进度: {{ progressPercent }}%</p>
        </div>

        <!-- AI 分析实时输出 -->
        <div v-if="store.phase === 'analyzing' || store.phase === 'code-exploring' || store.phase === 'test-generating' || store.agentThinking" class="mb-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">AI 分析过程</p>
          <div
            v-if="store.agentThinking"
            class="prose-think max-h-64 overflow-y-auto"
            v-html="renderedThinking"
          />
          <div v-else class="text-xs text-gray-400 dark:text-gray-500">等待 AI 分析...</div>
        </div>

        <!-- 工具调用历史 -->
        <div v-if="store.agentToolCalls.length > 0" class="mb-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">工具调用记录</p>
          <div class="space-y-2 max-h-48 overflow-y-auto">
            <div
              v-for="(call, index) in store.agentToolCalls"
              :key="index"
              class="text-xs p-2 bg-white dark:bg-gray-700 rounded"
            >
              <span class="text-blue-500 dark:text-blue-400">{{ call.tool }}</span>
              <span v-if="call.status === 'running'" class="text-yellow-500 dark:text-yellow-400 ml-2">执行中...</span>
              <span v-else-if="call.status === 'done'" class="text-green-500 dark:text-green-400 ml-2">完成</span>
              <span v-else-if="call.status === 'error'" class="text-red-500 dark:text-red-400 ml-2">失败</span>
            </div>
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="store.error" class="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-xs text-red-600 dark:text-red-400">{{ store.error }}</p>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-2">
          <button
            v-if="store.analyzing"
            class="btn btn-danger text-xs"
            @click="handleCancel"
          >
            中断分析
          </button>
          <button
            v-if="store.phase === 'done'"
            class="btn btn-primary text-xs"
            @click="$router.push('/ai-analysis/result')"
          >
            查看结果 →
          </button>
          <button
            v-if="store.phase === 'error' && !store.sseConnected"
            class="btn btn-secondary text-xs"
            @click="handleRetry"
          >
            重试
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAiAnalysisStore } from '../stores/ai-analysis-store'
import { renderMarkdown } from '../utils/markdown'

const router = useRouter()
const store = useAiAnalysisStore()

const renderedThinking = computed(() => {
  if (!store.agentThinking) return ''
  return renderMarkdown(store.agentThinking)
})

const phaseTitle = computed(() => {
  const titles: Record<string, string> = {
    idle: '准备分析',
    cloning: '克隆仓库中',
    scanning: '扫描路由中',
    'scan-failed': '扫描失败',
    'code-exploring': '代码探索中（Phase 1/2）',
    analyzing: 'AI 深度分析中',
    'test-generating': '生成测试用例中（Phase 2/2）',
    generating: '生成报告中',
    done: '分析完成',
    error: '分析失败',
  }
  return titles[store.phase] || '未知状态'
})

const phaseBadgeClass = computed(() => {
  const classes: Record<string, string> = {
    idle: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    cloning: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    scanning: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    'scan-failed': 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
    'code-exploring': 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400',
    analyzing: 'bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400',
    'test-generating': 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400',
    generating: 'bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400',
    done: 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400',
    error: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
  }
  return classes[store.phase] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
})

const progressPercent = computed(() => {
  if (store.phase === 'cloning' && store.cloneProgress) {
    return Math.round(store.cloneProgress.percent * 0.3) // Clone 占 0-30%
  }
  if (store.phase === 'scanning') {
    const scanPct = store.scanProgress?.percent
    return 30 + (typeof scanPct === 'number' ? scanPct * 0.2 : 0) // 扫描占 30-50%
  }
  if (store.phase === 'code-exploring') {
    // Phase 1: 代码探索占 50-70%
    const toolBonus = store.agentToolCalls.length > 0
      ? Math.min(store.agentToolCalls.length * 5, 20)
      : 0
    return 50 + toolBonus
  }
  if (store.phase === 'analyzing') {
    // 旧模式 AI 分析占 50-90%
    const toolBonus = store.agentToolCalls.length > 0
      ? Math.min(store.agentToolCalls.length * 10, 40)
      : 0
    return 50 + toolBonus
  }
  if (store.phase === 'test-generating') {
    // Phase 2: 测试用例生成占 70-90%
    const toolBonus = store.agentToolCalls.length > 0
      ? Math.min(store.agentToolCalls.length * 5, 20)
      : 0
    return 70 + toolBonus
  }
  if (store.phase === 'done') {
    return 100
  }
  return 0
})

// SSE 连接状态
const sseStatusClass = computed(() => {
  if (store.sseConnected) {
    return 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/30'
  } else if (store.sseConnecting) {
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-500/30'
  } else {
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600'
  }
})

const sseStatusText = computed(() => {
  if (store.sseConnected) {
    return '已连接'
  } else if (store.sseConnecting) {
    return '连接中...'
  } else if (store.sseError) {
    return '连接失败'
  } else {
    return '未连接'
  }
})

async function handleCancel(): Promise<void> {
  await store.cancelAnalysis()
}

async function handleRetry(): Promise<void> {
  store.reset()
  router.push('/ai-analysis')
}

// 分析完成后自动跳转
onMounted(() => {
  const stopWatch = watch(
    () => store.phase,
    (newPhase: string) => {
      if (newPhase === 'done') {
        setTimeout(() => {
          router.push('/ai-analysis/result')
        }, 1000)
        stopWatch()
      }
    }
  )

  // SSE 连接已在 startAnalysis() 中启动，此处不再重复连接
  // 之前的重复连接逻辑（!store.sseConnected && !store.sseConnecting）会导致
  // 第一个连接被清理，触发断开，日志推送中断
  console.log(`[AiAnalysisProgressView] onMounted: sseConnected=${store.sseConnected}, sseConnecting=${store.sseConnecting}`)
})

onUnmounted(() => {
  // 只有在分析完成或出错时才断开 SSE 连接
  // 如果分析还在进行中，保持连接以继续接收结果
  if (store.phase === 'done' || store.phase === 'error' || store.phase === 'idle') {
    store.disconnectSSE()
  }
})
</script>

<style scoped>
.spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid rgba(59, 130, 246, 0.3);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* AI 分析过程 Markdown 渲染样式 */
.prose-think {
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  word-break: break-word;
  overflow-wrap: break-word;
}
.prose-think :deep(h1) { font-size: 0.875rem; font-weight: 700; margin: 0.5rem 0 0.25rem; color: var(--color-text); }
.prose-think :deep(h2) { font-size: 0.8125rem; font-weight: 600; margin: 0.5rem 0 0.25rem; color: var(--color-text); }
.prose-think :deep(h3) { font-size: 0.75rem; font-weight: 600; margin: 0.375rem 0 0.125rem; color: var(--color-text); }
.prose-think :deep(p) { margin: 0.25rem 0; }
.prose-think :deep(ul), .prose-think :deep(ol) { margin: 0.25rem 0; padding-left: 1.25rem; }
.prose-think :deep(li) { margin: 0.125rem 0; }
.prose-think :deep(ul li) { list-style-type: disc; }
.prose-think :deep(ol li) { list-style-type: decimal; }
.prose-think :deep(code) {
  background: var(--color-surface);
  padding: 0.0625rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  color: var(--color-primary);
}
.prose-think :deep(pre) {
  background: var(--color-surface);
  padding: 0.5rem 0.625rem;
  border-radius: 0.25rem;
  overflow-x: auto;
  margin: 0.375rem 0;
  border: 1px solid var(--color-border);
}
.prose-think :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.6875rem;
  color: var(--color-text);
  word-break: break-all;
}
.prose-think :deep(strong) { color: var(--color-text); font-weight: 600; }
.prose-think :deep(blockquote) {
  border-left: 2px solid var(--color-border);
  padding-left: 0.5rem;
  margin: 0.375rem 0;
  color: var(--color-text-secondary);
  font-style: italic;
}
</style>
