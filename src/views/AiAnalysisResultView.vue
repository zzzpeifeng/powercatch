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
        <h1 class="text-base font-semibold">AI 分析结果</h1>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400">
          {{ store.deepAnalysisResult?.repoName || '' }}
        </span>
        <span class="text-xs px-2 py-1 rounded bg-green-900/50 text-green-400">
          完成
        </span>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="max-w-6xl mx-auto px-4 py-6">
      <!-- 分析摘要 -->
      <div class="card p-6 mb-6">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold">分析完成</h2>
            <p class="text-sm text-gray-400">
              Handler: {{ store.deepAnalysisResult?.handlerFunction || '未知' }} |
              场景数: {{ scenarios.length }}
            </p>
          </div>
        </div>

        <!-- 路由信息 -->
        <div v-if="store.deepAnalysisResult?.handlerFile" class="p-3 bg-[#1a1a2e] rounded-lg mb-4">
          <p class="text-xs text-gray-400 mb-1">Handler 文件</p>
          <p class="text-sm font-mono">{{ store.deepAnalysisResult.handlerFile }}</p>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-3">
          <button
            class="btn btn-secondary text-sm"
            :disabled="store.cleanupStatus === 'cleaning'"
            @click="handleCleanup"
          >
            {{ store.cleanupStatus === 'done' ? '已清理' : store.cleanupStatus === 'cleaning' ? '清理中...' : '清理临时仓库' }}
          </button>
          <button
            class="btn btn-primary text-sm"
            @click="handleReanalyze"
          >
            🔄 重新分析
          </button>
        </div>
      </div>

      <!-- 场景链路分析表格 -->
      <div class="card p-6 mb-6">
        <h3 class="text-base font-semibold mb-4">场景链路分析</h3>
        <ScenarioTable :scenarios="scenarios" />
      </div>

      <!-- curl + Python 断言面板（每个场景一个） -->
      <div v-for="(scenario, index) in scenarios" :key="index" class="mb-6">
        <CurlAssertionPanel
          :scenario-index="index"
          :scenario-name="scenario.scenarioName"
          :curl-command="scenario.curlCommand"
          :python-assertion="scenario.pythonAssertion"
          @copy="handleCopy"
        />
      </div>

      <!-- 分析报告（Markdown） -->
      <div v-if="store.deepAnalysisResult?.analysisSummary" class="card p-6 mb-6">
        <h3 class="text-base font-semibold mb-4">分析报告</h3>
        <div class="prose prose-sm dark:prose-invert max-w-none" v-html="renderedAnalysis" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAiAnalysisStore } from '../stores/ai-analysis-store'
import ScenarioTable from '../components/ScenarioTable.vue'
import CurlAssertionPanel from '../components/CurlAssertionPanel.vue'
import type { AnalysisScenario } from '../services/types'

const router = useRouter()
const store = useAiAnalysisStore()

const scenarios = computed<AnalysisScenario[]>(() => {
  return store.deepAnalysisResult?.scenarios || []
})

const renderedAnalysis = computed(() => {
  if (!store.deepAnalysisResult?.analysisSummary) return ''

  let html = store.deepAnalysisResult.analysisSummary
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>')

  return html
})

function handleCopy(type: 'curl' | 'python'): void {
  console.log(`已复制 ${type}`)
}

async function handleCleanup(): Promise<void> {
  await store.cleanupRepo()
}

function handleReanalyze(): void {
  store.reset()
  router.push('/ai-analysis')
}

onMounted(() => {
  // 确保 SSE 连接已清理
  store.disconnectSSE()
})

onUnmounted(() => {
  // 组件卸载时清理 SSE 连接
  store.disconnectSSE()
})
</script>

<style scoped>
.card {
  background: #2d2d44;
  border-radius: 0.5rem;
  border: 1px solid rgba(107, 114, 128, 0.2);
}

.prose h1 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; color: #e5e7eb; }
.prose h2 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0.5rem; color: #e5e7eb; }
.prose h3 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; color: #e5e7eb; }
.prose li { margin-left: 1.5rem; list-style-type: disc; color: #d1d5db; }
.prose code {
  background: #1a1a2e;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  color: #93c5fd;
}
</style>
