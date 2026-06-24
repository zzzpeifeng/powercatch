<template>
  <div class="h-full overflow-y-auto bg-[#1a1a2e] text-gray-200">
    <!-- 顶部导航栏 -->
    <div class="sticky top-0 z-10 bg-[#2d2d44] border-b border-gray-700/50 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          class="btn btn-secondary text-xs"
          @click="$router.push('/ai-analysis')"
        >
          ← 返回
        </button>
        <h1 class="text-base font-semibold">AI 分析进度</h1>
      </div>
      <div class="flex items-center gap-2">
        <!-- SSE 连接状态指示器 -->
        <span
          class="text-xs px-2 py-1 rounded flex items-center gap-1"
          :class="sseStatusClass"
        >
          <span v-if="store.sseConnected" class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span v-else-if="store.sseConnecting" class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span v-else class="w-2 h-2 rounded-full bg-gray-500" />
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
    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- 进度指示器 -->
      <div class="card p-6 mb-6">
        <div class="flex items-center gap-4 mb-6">
          <div
            v-if="store.analyzing"
            class="spinner spinner-dark"
          />
          <div
            v-else-if="store.phase === 'done'"
            class="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center"
          >
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div
            v-else-if="store.phase === 'error'"
            class="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center"
          >
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 class="text-lg font-semibold">{{ phaseTitle }}</h2>
        </div>

        <!-- 进度条 -->
        <div v-if="store.analyzing" class="mb-6">
          <div class="w-full bg-gray-700 rounded-full h-2.5">
            <div
              class="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
              :style="`width: ${progressPercent}%`"
            />
          </div>
          <p class="text-xs text-gray-400 mt-2">进度: {{ progressPercent }}%</p>
        </div>

        <!-- Clone 进度 -->
        <div v-if="store.cloneProgress" class="mb-4 p-3 bg-[#1a1a2e] rounded-lg">
          <p class="text-xs text-gray-400 mb-1">Clone 进度</p>
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-gray-700 rounded-full h-1.5">
              <div
                class="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                :style="`width: ${store.cloneProgress.percent}%`"
              />
            </div>
            <span class="text-xs text-gray-400">{{ store.cloneProgress.percent }}%</span>
          </div>
          <p class="text-xs text-gray-500 mt-1">{{ store.cloneProgress.message }}</p>
        </div>

        <!-- AI 分析实时输出 -->
        <div v-if="store.phase === 'analyzing' || store.agentThinking" class="mb-4 p-3 bg-[#1a1a2e] rounded-lg">
          <p class="text-xs text-gray-400 mb-2">AI 分析过程</p>
          <div class="text-sm text-gray-300 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
            {{ store.agentThinking || '等待 AI 分析...' }}
          </div>
        </div>

        <!-- 工具调用历史 -->
        <div v-if="store.agentToolCalls.length > 0" class="mb-4 p-3 bg-[#1a1a2e] rounded-lg">
          <p class="text-xs text-gray-400 mb-2">工具调用记录</p>
          <div class="space-y-2 max-h-48 overflow-y-auto">
            <div
              v-for="(call, index) in store.agentToolCalls"
              :key="index"
              class="text-xs p-2 bg-[#2d2d44] rounded"
            >
              <span class="text-blue-400">{{ call.tool }}</span>
              <span v-if="call.status === 'running'" class="text-yellow-400 ml-2">执行中...</span>
              <span v-else-if="call.status === 'done'" class="text-green-400 ml-2">完成</span>
              <span v-else-if="call.status === 'error'" class="text-red-400 ml-2">失败</span>
            </div>
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="store.error" class="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
          <p class="text-sm text-red-400">{{ store.error }}</p>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-3">
          <button
            v-if="store.analyzing"
            class="btn btn-danger text-sm"
            @click="handleCancel"
          >
            中断分析
          </button>
          <button
            v-if="store.phase === 'done'"
            class="btn btn-primary text-sm"
            @click="$router.push('/ai-analysis/result')"
          >
            查看结果 →
          </button>
          <button
            v-if="store.phase === 'error' && !store.sseConnected"
            class="btn btn-secondary text-sm"
            @click="handleRetry"
          >
            重试
          </button>
        </div>
      </div>

      <!-- 实时日志 -->
      <div class="card p-0 overflow-hidden">
        <AnalysisLogViewer
          :logs="store.logs"
          :auto-scroll="store.autoScroll"
          :connected="store.sseConnected"
          @clear="store.clearLogs()"
          @update:auto-scroll="store.autoScroll = $event"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAiAnalysisStore } from '../stores/ai-analysis-store'
import AnalysisLogViewer from '../components/AnalysisLogViewer.vue'

const router = useRouter()
const store = useAiAnalysisStore()

const phaseTitle = computed(() => {
  const titles: Record<string, string> = {
    idle: '准备分析',
    cloning: '克隆仓库中',
    scanning: '扫描路由中',
    'scan-failed': '扫描失败',
    analyzing: 'AI 深度分析中',
    generating: '生成报告中',
    done: '分析完成',
    error: '分析失败',
  }
  return titles[store.phase] || '未知状态'
})

const phaseBadgeClass = computed(() => {
  const classes: Record<string, string> = {
    idle: 'bg-gray-700 text-gray-300',
    cloning: 'bg-blue-900/50 text-blue-400',
    scanning: 'bg-blue-900/50 text-blue-400',
    'scan-failed': 'bg-yellow-900/50 text-yellow-400',
    analyzing: 'bg-purple-900/50 text-purple-400',
    generating: 'bg-purple-900/50 text-purple-400',
    done: 'bg-green-900/50 text-green-400',
    error: 'bg-red-900/50 text-red-400',
  }
  return classes[store.phase] || 'bg-gray-700 text-gray-300'
})

const progressPercent = computed(() => {
  if (store.phase === 'cloning' && store.cloneProgress) {
    return store.cloneProgress.percent * 0.3 // Clone 占 30%
  }
  if (store.phase === 'analyzing') {
    return 50 + (store.agentThinking ? Math.min(store.agentToolCalls.length * 10, 40) : 0) // AI 分析占 50-90%
  }
  if (store.phase === 'done') {
    return 100
  }
  return 0
})

// SSE 连接状态
const sseStatusClass = computed(() => {
  if (store.sseConnected) {
    return 'bg-green-900/30 text-green-400 border border-green-500/30'
  } else if (store.sseConnecting) {
    return 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/30'
  } else {
    return 'bg-gray-800 text-gray-400 border border-gray-600'
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
  // 清理 SSE 连接
  store.disconnectSSE()
})
</script>

<style scoped>
.card {
  background: #2d2d44;
  border-radius: 0.5rem;
  border: 1px solid rgba(107, 114, 128, 0.2);
}

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
</style>
