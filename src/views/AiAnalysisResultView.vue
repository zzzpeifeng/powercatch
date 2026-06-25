<template>
  <div class="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
    <!-- 顶部导航栏 -->
    <div class="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          class="btn btn-secondary text-xs"
          @click="$router.back()"
        >
          ← 返回
        </button>
        <h1 class="text-base font-semibold text-gray-900 dark:text-gray-100">AI 分析结果</h1>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ store.deepAnalysisResult?.repoName || '' }}
        </span>
        <span class="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400">
          完成
        </span>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="max-w-5xl mx-auto px-4 py-4">
      <!-- 空状态提示 -->
      <div v-if="!hasAnalysisData" class="card p-6 mb-4 text-center">
        <div class="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-500/20 flex items-center justify-center mx-auto mb-3">
          <svg class="w-6 h-6 text-yellow-500 dark:text-yellow-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 class="text-sm font-semibold mb-1 text-gray-900 dark:text-gray-100">没有找到分析结果</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
          分析结果数据可能已丢失或未完成。请重新开始分析。
        </p>
        <button
          class="btn btn-primary text-xs"
          @click="handleReanalyze"
        >
          🔄 重新分析
        </button>
      </div>

      <!-- 有数据时显示正常内容 -->
      <template v-else>
        <!-- 分析摘要 -->
        <div class="card p-4 mb-4">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-8 h-8 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
              <svg class="w-5 h-5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100">分析完成</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Handler: {{ store.deepAnalysisResult?.handlerFunction || '未知' }} |
                场景数: {{ scenarios.length }}
              </p>
            </div>
          </div>

          <!-- 路由信息 -->
          <div v-if="store.deepAnalysisResult?.handlerFile" class="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg mb-3">
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">Handler 文件</p>
            <p class="text-xs font-mono text-gray-700 dark:text-gray-300">{{ store.deepAnalysisResult.handlerFile }}</p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex justify-end gap-2">
            <button
              class="btn btn-secondary text-xs"
              :disabled="store.cleanupStatus === 'cleaning'"
              @click="handleCleanup"
            >
              {{ store.cleanupStatus === 'done' ? '已清理' : store.cleanupStatus === 'cleaning' ? '清理中...' : '清理临时仓库' }}
            </button>
            <button
              class="btn btn-primary text-xs"
              @click="handleReanalyze"
            >
              🔄 重新分析
            </button>
          </div>
        </div>

        <!-- 场景链路分析表格 -->
        <div class="card p-4 mb-4">
          <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">场景链路分析</h3>
          <ScenarioTable :scenarios="scenarios" />
        </div>

        <!-- curl + Python 断言面板（每个场景一个） -->
        <div v-for="(scenario, index) in scenarios" :key="index" class="mb-4">
          <CurlAssertionPanel
            :scenario-index="index"
            :scenario-name="scenario.scenarioName"
            :curl-command="scenario.curlCommand"
            :python-assertion="scenario.pythonAssertion"
          />
        </div>

        <!-- 分析报告（Markdown） -->
        <div v-if="store.deepAnalysisResult?.analysisSummary" class="card p-4 mb-4">
          <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">分析报告</h3>
          <div class="prose prose-sm dark:prose-invert max-w-none" v-html="renderedAnalysis" />
        </div>
      </template>
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
import { renderMarkdown } from '../utils/markdown'

const router = useRouter()
const store = useAiAnalysisStore()

// 检查是否有分析结果数据
const hasAnalysisData = computed(() => {
  return store.deepAnalysisResult && store.deepAnalysisResult.scenarios && store.deepAnalysisResult.scenarios.length > 0
})

const scenarios = computed<AnalysisScenario[]>(() => {
  return store.deepAnalysisResult?.scenarios || []
})

const renderedAnalysis = computed(() => {
  if (!store.deepAnalysisResult?.analysisSummary) return ''
  
  // 使用项目已有的 markdown-it 工具进行渲染
  return renderMarkdown(store.deepAnalysisResult.analysisSummary)
})

async function handleCleanup(): Promise<void> {
  await store.cleanupRepo()
}

function handleReanalyze(): void {
  store.reset()
  router.push('/ai-analysis')
}

onMounted(() => {
  // 如果 store 中没有分析结果数据，尝试从历史记录恢复（页面刷新场景）
  if (!hasAnalysisData.value) {
    const history = store.getHistoryFromStorage()
    if (history.length > 0) {
      // 恢复最近一次的分析结果
      store.deepAnalysisResult = history[0]
      console.log('[AiAnalysisResultView] 从历史记录恢复分析结果')
    } else {
      console.warn('AI分析结果页：没有找到分析结果数据，重定向到配置页')
      router.replace('/ai-analysis')
    }
  }
})

onUnmounted(() => {
  // 组件卸载时清理 SSE 连接
  store.disconnectSSE()
})
</script>

<style scoped>
/* 使用全局 .card 类，无需重复定义 */

/* Markdown 内容样式 - 支持亮/暗模式 */
.prose h1 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; color: var(--color-text); }
.prose h2 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0.5rem; color: var(--color-text); }
.prose h3 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; color: var(--color-text); }
.prose h4 { font-size: 0.875rem; font-weight: 600; margin: 0.5rem 0 0.25rem; color: var(--color-text); }
.prose p { margin: 0.5rem 0; color: var(--color-text-secondary); line-height: 1.6; }
.prose ul, .prose ol { margin: 0.5rem 0; padding-left: 1.5rem; }
.prose li { margin: 0.25rem 0; color: var(--color-text-secondary); }
.prose ul li { list-style-type: disc; }
.prose ol li { list-style-type: decimal; }
.prose code {
  background: var(--color-bg);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  color: var(--color-primary);
}
.prose pre {
  background: var(--color-bg);
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 1rem 0;
}
.prose pre code {
  background: none;
  padding: 0;
  font-size: 0.8125rem;
  color: var(--color-text);
}
.prose blockquote {
  border-left: 3px solid var(--color-border);
  padding-left: 1rem;
  margin: 1rem 0;
  color: var(--color-text-secondary);
  font-style: italic;
}
.prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}
.prose th, .prose td {
  border: 1px solid var(--color-border);
  padding: 0.5rem;
  text-align: left;
}
.prose th {
  background: var(--color-bg);
  font-weight: 600;
  color: var(--color-text);
}
.prose td {
  color: var(--color-text-secondary);
}
.prose a {
  color: var(--color-primary);
  text-decoration: underline;
}
.prose a:hover {
  color: var(--color-primary-hover);
}
.prose strong {
  color: var(--color-text);
  font-weight: 600;
}
.prose em {
  color: var(--color-text-secondary);
  font-style: italic;
}
.md-table-wrapper {
  overflow-x: auto;
  margin: 1rem 0;
}
.md-table {
  width: 100%;
  border-collapse: collapse;
}
.md-table th, .md-table td {
  border: 1px solid var(--color-border);
  padding: 0.5rem;
  text-align: left;
}
.md-table th {
  background: var(--color-bg);
  font-weight: 600;
  color: var(--color-text);
}
.md-table td {
  color: var(--color-text-secondary);
}
</style>
