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

          <!-- 场景类型分布统计 -->
          <div v-if="scenarios.length > 0" class="flex flex-wrap gap-2 mb-3">
            <span
              v-for="(count, type) in scenarioTypeDistribution"
              :key="type"
              class="text-xs px-2 py-1 rounded"
              :class="scenarioBadgeClass(type as string)"
            >
              {{ scenarioTypeLabel(type as string) }}: {{ count }}
            </span>
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
            :expected-status-code="scenario.expectedStatusCode"
            :test-data="scenario.testData"
          />
        </div>

        <!-- 分析报告（Markdown） -->
        <div v-if="store.deepAnalysisResult?.analysisSummary" class="card p-4 mb-4">
          <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">分析报告</h3>
          <div class="prose max-w-none" v-html="renderedAnalysis" />
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

/** 场景类型分布统计 */
const scenarioTypeDistribution = computed(() => {
  const distribution: Record<string, number> = {}
  for (const s of scenarios.value) {
    const type = s.scenarioType || 'unknown'
    distribution[type] = (distribution[type] || 0) + 1
  }
  return distribution
})

/** 场景类型 badge 样式 */
function scenarioBadgeClass(type: string): string {
  const classes: Record<string, string> = {
    normal:           'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400',
    'missing-required': 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
    boundary:         'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
    'type-error':     'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
    'format-error':   'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
    'business-rule':  'bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400',
    'auth-missing':   'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    'auth-expired':   'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    forbidden:        'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    'not-found':      'bg-gray-100 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400',
    conflict:         'bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400',
    'server-error':   'bg-red-200 dark:bg-red-900/70 text-red-700 dark:text-red-300',
    'param-error':    'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
    'auth-error':     'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
  }
  return classes[type] || 'bg-gray-100 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400'
}

/** 场景类型中文标签 */
function scenarioTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    normal: '正常',
    'missing-required': '必填缺失',
    boundary: '边界值',
    'type-error': '类型错误',
    'format-error': '格式错误',
    'business-rule': '业务规则',
    'auth-missing': '缺认证',
    'auth-expired': 'Token过期',
    forbidden: '权限不足',
    'not-found': '不存在',
    conflict: '冲突',
    'server-error': '服务端错误',
    'param-error': '参数错误',
    'auth-error': '认证错误',
  }
  return labels[type] || type
}

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
/*
 * 分析报告 Markdown 样式
 * 字号体系与软件整体一致：正文 text-xs(12px)，标题 text-xs~text-sm(12~14px)
 * 所有元素 overflow-wrap 防止破板
 */

/* 容器：防破板 */
.prose {
  font-size: 0.75rem;          /* 12px = text-xs */
  line-height: 1.5;
  color: var(--color-text-secondary);
  word-break: break-word;
  overflow-wrap: break-word;
}

/* 标题 */
.prose :deep(h1) { font-size: 0.875rem; font-weight: 700; margin: 0.75rem 0 0.375rem; color: var(--color-text); }
.prose :deep(h2) { font-size: 0.8125rem; font-weight: 600; margin: 0.625rem 0 0.375rem; color: var(--color-text); }
.prose :deep(h3) { font-size: 0.75rem; font-weight: 600; margin: 0.5rem 0 0.25rem; color: var(--color-text); }
.prose :deep(h4) { font-size: 0.75rem; font-weight: 600; margin: 0.5rem 0 0.25rem; color: var(--color-text); }

/* 段落 */
.prose :deep(p) { margin: 0.375rem 0; line-height: 1.5; }

/* 列表 */
.prose :deep(ul), .prose :deep(ol) { margin: 0.375rem 0; padding-left: 1.25rem; }
.prose :deep(li) { margin: 0.125rem 0; }
.prose :deep(ul li) { list-style-type: disc; }
.prose :deep(ol li) { list-style-type: decimal; }

/* 行内代码 */
.prose :deep(code) {
  background: var(--color-bg);
  padding: 0.0625rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;        /* 11px */
  color: var(--color-primary);
  word-break: break-all;
}

/* 代码块 */
.prose :deep(pre) {
  background: var(--color-bg);
  padding: 0.625rem 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
  margin: 0.5rem 0;
  border: 1px solid var(--color-border);
}
.prose :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.6875rem;
  color: var(--color-text);
  word-break: break-all;
}

/* 引用块 */
.prose :deep(blockquote) {
  border-left: 2px solid var(--color-border);
  padding-left: 0.75rem;
  margin: 0.5rem 0;
  color: var(--color-text-secondary);
  font-style: italic;
}

/* 表格（含防破板容器） */
.prose :deep(.md-table-wrapper) {
  overflow-x: auto;
  margin: 0.5rem 0;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
}
.prose :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}
.prose :deep(.md-table th),
.prose :deep(.md-table td) {
  border: 1px solid var(--color-border);
  padding: 0.375rem 0.5rem;
  text-align: left;
}
.prose :deep(.md-table th) {
  background: var(--color-bg);
  font-weight: 600;
  color: var(--color-text);
}
.prose :deep(.md-table td) {
  color: var(--color-text-secondary);
}

/* 链接 */
.prose :deep(a) {
  color: var(--color-primary);
  word-break: break-all;
}
.prose :deep(a:hover) {
  color: var(--color-primary-hover);
}

/* 粗体 / 斜体 */
.prose :deep(strong) { color: var(--color-text); font-weight: 600; }
.prose :deep(em) { color: var(--color-text-secondary); font-style: italic; }

/* 分隔线 */
.prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0.75rem 0;
}

/* 图片 */
.prose :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.25rem;
}
</style>
