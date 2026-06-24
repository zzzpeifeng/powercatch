<template>
  <div class="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
    <!-- 内容区 -->
    <div class="max-w-5xl mx-auto px-4 py-6">
      <!-- M1: Git 不可用提示 -->
      <template v-if="store.gitAvailable === false && !store.gitChecking">
        <GitNotInstalled
          :error="store.error || undefined"
          :checking="store.gitChecking"
          @recheck="store.checkGitAvailability()"
        />
      </template>

      <template v-else>
        <!-- 接口信息卡片 -->
        <div class="card p-4 mb-4">
          <div class="flex items-center gap-3">
            <span
              class="badge text-xs font-mono"
              :class="methodBadgeClass"
            >
              {{ requestInfo.method }}
            </span>
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
              {{ requestInfo.path }}
            </span>
          </div>
          <div class="mt-2 text-xs text-gray-500 dark:text-gray-400 truncate">
            完整URL: {{ requestInfo.url }}
          </div>
        </div>

        <!-- 仓库配置卡片 -->
        <div v-if="!store.analyzing && !store.result" class="card p-6 mb-4">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            代码仓库配置
          </h3>

          <!-- 仓库链接 -->
          <div class="mb-4">
            <label class="label text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              代码仓库
            </label>
            <div class="flex gap-2">
              <div class="flex-1 relative">
                <input
                  v-model="store.repoConfig.repoUrl"
                  type="text"
                  class="input w-full pl-9 pr-8"
                  placeholder="https://github.com/org/repo"
                  @focus="showHistory = true"
                  @blur="hideHistory"
                  @input="onUrlInput"
                />
                <!-- 输入框左侧图标 -->
                <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.6 9h16.8M3.6 15h16.8" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.5 4 2.5 14 0 18" />
                  </svg>
                </div>
                <!-- 右侧历史按钮 -->
                <button
                  v-if="store.repoConfig.repoUrlHistory.length > 0"
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  @mousedown.prevent="showHistory = !showHistory"
                  title="查看历史记录"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <!-- 历史记录下拉 -->
                <div
                  v-if="showHistory && filteredHistory.length > 0"
                  class="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                >
                    <div
                      v-for="url in filteredHistory"
                      :key="url"
                      class="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                      @mousedown.prevent="selectHistoryUrl(url)"
                    >
                      <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                      </svg>
                      <span class="truncate text-gray-700 dark:text-gray-300">{{ url }}</span>
                    </div>
                </div>
              </div>
              <!-- 仓库类型 badge -->
              <span
                v-if="detectedRepoType"
                class="badge badge-info text-xs whitespace-nowrap self-center"
              >
                {{ detectedRepoType }}
              </span>
            </div>
          </div>

          <!-- 分支 -->
          <div class="mb-4">
            <label class="label text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              分支
            </label>
            <div class="flex gap-2">
              <div class="flex-1 relative">
                <!-- 分支下拉（优先显示 select，否则显示 input） -->
                <select
                  v-if="branches.length > 0"
                  v-model="store.repoConfig.branch"
                  class="input w-full pl-8 pr-8 appearance-none bg-white dark:bg-gray-800 dark:text-gray-200"
                >
                  <option v-for="branch in branches" :key="branch" :value="branch" class="bg-white dark:bg-gray-800">
                    {{ branch }}
                  </option>
                </select>
                <input
                  v-else
                  v-model="store.repoConfig.branch"
                  type="text"
                  class="input w-full pl-8"
                  placeholder="输入分支名，再点右侧按钮获取"
                />
                <!-- 输入框左侧分支图标 -->
                <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                </div>
                <!-- select 右侧下拉箭头 -->
                <div v-if="branches.length > 0" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
              </div>
              <button
                class="btn btn-secondary text-xs px-3 flex items-center gap-1"
                :disabled="fetchingBranches"
                @click="fetchBranches"
                title="从仓库获取分支列表"
              >
                <svg class="w-4 h-4" :class="fetchingBranches ? 'animate-spin' : ''" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                <span v-if="fetchingBranches" class="text-xs">获取中</span>
              </button>
            </div>
            <p v-if="branches.length > 0" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
              已获取 {{ branches.length }} 个分支，可输入关键字筛选
            </p>
          </div>

          <!-- Access Token -->
          <div class="mb-4">
            <label class="label text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              Access Token
              <span class="text-gray-400 font-normal">（私有仓库需要）</span>
            </label>
            <div class="flex gap-2">
              <div class="flex-1 relative">
                <input
                  v-model="store.repoConfig.accessToken"
                  :type="showToken ? 'text' : 'password'"
                  class="input flex-1 pl-9"
                  placeholder="ghp_xxxxxxxxxxxx / oauth2 token"
                />
                <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.967-.247-1.9.145-2.496.934a.75.75 0 01-.243.912c-.725.565-1.775.93-2.943.756-1.333-.193-2.22-1.162-2.22-2.157V8.25a6 6 0 016-6h2.25a3 3 0 013 3z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 13.5h-1.5a1.5 1.5 0 01-1.5-1.5v-1.5a1.5 1.5 0 011.5-1.5h1.5m0 4.5h-1.5a1.5 1.5 0 01-1.5-1.5v-1.5a1.5 1.5 0 011.5-1.5h1.5m0 4.5v-4.5m0 4.5h3.75m-3.75 0H2.25m3 0h1.5m0 0v-4.5" />
                  </svg>
                </div>
              </div>
              <button
                class="btn btn-secondary text-xs px-3 flex items-center gap-1"
                @click="showToken = !showToken"
                :title="showToken ? '隐藏 Token' : '显示 Token'"
              >
                <svg v-if="!showToken" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.639 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.639 0-8.573-3.007-9.963-7.178z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.503 10.503 0 002.25 12c2.25 4.494 6.161 7.5 10.5 7.5 1.768 0 3.44-.487 4.865-1.328M19.5 12c-.75-1.5-2.25-4.5-5.25-6.75M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" stroke="currentColor" stroke-width="2" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 认证方式 -->
          <div class="mb-6">
            <label class="label text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              认证方式
            </label>
            <div class="flex gap-2">
              <button
                class="btn text-xs"
                :class="store.repoConfig.authMethod === 'http' ? 'btn-primary' : 'btn-secondary'"
                @click="store.repoConfig.authMethod = 'http'"
              >
                HTTP + Token
              </button>
              <button
                class="btn text-xs"
                :class="store.repoConfig.authMethod === 'ssh' ? 'btn-primary' : 'btn-secondary'"
                @click="store.repoConfig.authMethod = 'ssh'"
              >
                SSH
              </button>
            </div>
          </div>

          <!-- 语言选择（v1.0 只启用 Go） -->
          <div class="mb-6">
            <label class="label text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              项目语言
            </label>
            <div class="flex gap-2">
              <button class="btn btn-primary text-xs">
                Go
              </button>
              <button
                class="btn btn-secondary text-xs opacity-50 cursor-not-allowed"
                disabled
                title="v1.1 支持"
              >
                Java（v1.1 支持）
              </button>
            </div>
          </div>

          <!-- 磁盘空间警告 -->
          <div
            v-if="diskWarning"
            class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-4 py-3 mb-4"
          >
            <p class="text-sm text-yellow-600 dark:text-yellow-400">{{ diskWarning }}</p>
          </div>

          <!-- 错误信息 -->
          <div
            v-if="store.error && !store.analyzing"
            class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-4"
          >
            <p class="text-sm text-red-600 dark:text-red-400">{{ store.error }}</p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex justify-end gap-3">
            <button
              class="btn btn-secondary"
              @click="$router.push('/')"
            >
              返回主页
            </button>
            <button
              class="btn btn-primary"
              :disabled="!canStartAnalysis || analyzing"
              @click="handleStartAnalysis"
            >
              <span v-if="analyzing" class="spinner spinner-dark mr-2"></span>
              {{ analyzing ? '分析中...' : '开始分析' }}
            </button>
          </div>
        </div>

        <!-- M2: Clone 进度 -->
        <CloneProgress
          v-if="store.cloneProgress && store.analyzing"
          :progress="store.cloneProgress"
          class="mb-4"
        />

        <!-- 分析中状态区 -->
        <div v-if="store.analyzing" class="card p-6 mb-4">
          <div class="flex items-center gap-3 mb-4">
            <span class="spinner spinner-dark"></span>
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              <!-- 扫描进度 -->
              <template v-if="store.scanProgress">
                正在扫描路由文件... ({{ store.scanProgress.scanned }}/{{ store.scanProgress.total }}) {{ store.scanProgress.percent }}%
              </template>
              <template v-else>
                AI 正在分析代码...
              </template>
            </span>
          </div>

          <!-- 扫描进度条 -->
          <div
            v-if="store.scanProgress"
            class="mb-4"
          >
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                class="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
                :style="`width: ${store.scanProgress.percent}%`"
              ></div>
            </div>
          </div>

          <!-- 流式输出文本 -->
          <div
            v-if="store.streamContent"
            class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700"
          >
            <pre class="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">{{ store.streamContent }}</pre>
          </div>

          <!-- 中断按钮 -->
          <div class="flex justify-end">
            <button
              class="btn btn-danger text-sm"
              @click="store.abortAnalysis()"
            >
              中断分析
            </button>
          </div>
        </div>

        <!-- 结果展示区 -->
        <div v-if="store.result" class="card p-6">
          <!-- Tab Bar -->
          <div class="tab-bar flex border-b border-gray-200 dark:border-gray-700 mb-4">
            <button
              class="tab-item px-4 py-2 text-sm font-medium border-b-2 transition-colors"
              :class="activeTab === 'analysis'
                ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'"
              @click="activeTab = 'analysis'"
            >
              链路分析
            </button>
            <button
              class="tab-item px-4 py-2 text-sm font-medium border-b-2 transition-colors"
              :class="activeTab === 'curls'
                ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'"
              @click="activeTab = 'curls'"
            >
              curl 测试用例
              <span
                v-if="store.result?.scenarios?.length > 0"
                class="ml-1 text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full"
              >
                {{ store.result?.scenarios?.length ?? 0 }}
              </span>
            </button>
          </div>

          <!-- Tab 1: 链路分析 -->
          <div v-show="activeTab === 'analysis'">
            <div
              class="prose prose-sm dark:prose-invert max-w-none"
              v-html="renderedAnalysis"
            ></div>
          </div>

          <!-- Tab 2: curl 测试用例 -->
          <div v-show="activeTab === 'curls'">
            <!-- 路由信息 -->
            <div v-if="store.result.routeInfo" class="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p class="text-xs text-blue-600 dark:text-blue-400">
                <strong>路由信息:</strong> {{ store.result.routeInfo }}
              </p>
            </div>

            <!-- 场景卡片列表 -->
            <div v-if="store.result?.scenarios?.length > 0">
              <TestScenarioCard
                v-for="(scenario, index) in store.result.scenarios"
                :key="index"
                :scenario="scenario"
                @toast="showToast"
              />
            </div>
            <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
              <p class="text-sm">未生成测试用例，请查看「链路分析」Tab 了解分析详情</p>
            </div>

            <!-- 底部操作栏 -->
            <div class="flex justify-between items-center mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                模型: {{ store.result?.modelName }} | 分析时间: {{ formatTime(store.result?.analyzedAt) }}
              </div>
              <div class="flex gap-3">
                <button
                  class="btn btn-secondary text-sm"
                  :disabled="store.cleanupStatus === 'cleaning'"
                  @click="handleCleanup"
                >
                  {{ store.cleanupStatus === 'done' ? '已清理' : store.cleanupStatus === 'cleaning' ? '清理中...' : '清理临时仓库' }}
                </button>
                <button
                  class="btn btn-secondary text-sm"
                  @click="copyAllScenarios"
                >
                  📋 复制全部用例
                </button>
                <button
                  class="btn btn-primary text-sm"
                  @click="handleReanalyze"
                >
                  🔄 重新分析
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Toast -->
    <div
      v-if="toastMessage"
      class="fixed bottom-6 right-6 z-50 animate-fade-in"
    >
      <div
        class="px-4 py-2 rounded-lg shadow-lg text-sm"
        :class="toastType === 'error' ? 'bg-red-500 text-white' : toastType === 'success' ? 'bg-green-500 text-white' : 'bg-gray-700 text-white'"
      >
        {{ toastMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAiAnalysisStore } from '../stores/ai-analysis-store'
import type { AnalysisRequestInfo, CodeAnalysisRequest } from '../services/types'
import { ipc } from '../services/ipc'
import GitNotInstalled from '../components/GitNotInstalled.vue'
import CloneProgress from '../components/CloneProgress.vue'
import TestScenarioCard from '../components/TestScenarioCard.vue'

const route = useRoute()
const router = useRouter()
const store = useAiAnalysisStore()

// ===== 状态 =====
const activeTab = ref<'analysis' | 'curls'>('analysis')
const showToken = ref(false)
const showHistory = ref(false)
const branches = ref<string[]>([])
const fetchingBranches = ref(false)
const diskWarning = ref<string | null>(null)
const toastMessage = ref('')
const toastType = ref<'success' | 'error' | 'info'>('info')
let toastTimer: ReturnType<typeof setTimeout> | null = null

// ===== 请求信息（从路由 query 读取） =====
const requestInfo = computed<AnalysisRequestInfo>(() => ({
  method: (route.query.method as string || 'GET').toUpperCase() as any,
  url: (route.query.url as string) || '',
  path: (route.query.path as string) || '/',
  requestBody: (route.query.requestBody as string) || undefined,
  requestHeaders: route.query.requestHeaders
    ? JSON.parse(route.query.requestHeaders as string)
    : undefined,
}))

// ===== 计算属性 =====
const detectedRepoType = computed(() => {
  const url = store.repoConfig.repoUrl.toLowerCase()
  if (!url) return ''
  try {
    const hostname = new URL(url).hostname
    if (hostname.includes('github')) return 'GitHub'
    if (hostname.includes('gitlab') || hostname.startsWith('git.')) return 'GitLab'
    if (hostname.includes('gitee')) return 'Gitee'
    if (hostname.includes('bitbucket')) return 'Bitbucket'
    // 通用识别：如果URL以 .git 结尾或包含 /-/tree 等 GitLab 特征
    if (url.includes('/-/tree') || url.includes('/-/blob')) return 'GitLab'
  } catch {
    // URL 解析失败，尝试简单匹配
    if (url.includes('github')) return 'GitHub'
    if (url.includes('gitlab') || url.includes('git.')) return 'GitLab'
    if (url.includes('gitee')) return 'Gitee'
  }
  return ''
})

const filteredHistory = computed(() => {
  const url = store.repoConfig.repoUrl.toLowerCase()
  if (!url) return store.repoConfig.repoUrlHistory
  return store.repoConfig.repoUrlHistory.filter((h) =>
    h.toLowerCase().includes(url)
  )
})

const canStartAnalysis = computed(() => {
  return store.repoConfig.repoUrl.trim() && store.repoConfig.branch.trim()
})

const analyzing = computed(() => store.analyzing)

const methodBadgeClass = computed(() => {
  const method = requestInfo.value.method.toUpperCase()
  const classes: Record<string, string> = {
    GET: 'badge-success',
    POST: 'badge-info',
    PUT: 'badge-warning',
    DELETE: 'badge-error',
    PATCH: 'badge-warning',
  }
  return classes[method] || 'badge-info'
})

const renderedAnalysis = computed(() => {
  if (!store.result?.analysis) return ''
  // 简单 Markdown 渲染（转义 HTML 后处理基本格式）
  let html = store.result.analysis
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

// ===== 方法 =====
function onUrlInput(): void {
  // 自动识别仓库类型
  const url = store.repoConfig.repoUrl.toLowerCase()
  if (url.includes('github')) {
    store.repoConfig.repoType = 'github'
  } else if (url.includes('gitlab') || /git\.[a-z]+\./.test(url)) {
    store.repoConfig.repoType = 'gitlab'
  } else if (url.includes('gitee')) {
    store.repoConfig.repoType = 'gitee'
  } else if (url.includes('bitbucket')) {
    store.repoConfig.repoType = 'bitbucket'
  }
}

function selectHistoryUrl(url: string): void {
  store.repoConfig.repoUrl = url
  showHistory.value = false
  onUrlInput()
  // 自动获取分支
  fetchBranches()
}

function hideHistory(): void {
  // 延迟关闭，让 mousedown 事件先触发
  setTimeout(() => {
    showHistory.value = false
  }, 200)
}

async function fetchBranches(): Promise<void> {
  const url = store.repoConfig.repoUrl.trim()
  if (!url) {
    showToast('请先输入仓库 URL', 'error')
    return
  }

  fetchingBranches.value = true
  try {
    const result = await ipc.aiCodeAnalysis.fetchBranches(
      url,
      store.repoConfig.accessToken,
      store.repoConfig.authMethod
    )
    branches.value = result
    if (result.length > 0) {
      if (!result.includes(store.repoConfig.branch)) {
        store.repoConfig.branch = result[0]
      }
      showToast(`已获取 ${result.length} 个分支`, 'success')
    } else {
      showToast('未获取到分支，请检查仓库 URL 和 Token', 'error')
    }
  } catch (err: any) {
    console.error('获取分支失败:', err.message)
    showToast(`获取分支失败: ${err.message}`, 'error')
    branches.value = []
  } finally {
    fetchingBranches.value = false
  }
}

async function handleStartAnalysis(): Promise<void> {
  if (!canStartAnalysis.value || analyzing.value) return

  // 保存配置
  await store.addRepoUrlToHistory()
  await store.saveConfig()

  // 检查磁盘空间
  const diskResult = await store.checkDiskSpace()
  if (diskResult && !diskResult.hasEnoughSpace) {
    return
  }
  if (diskResult?.warning) {
    diskWarning.value = diskResult.warning
  }

  // 构建分析请求
  const settings = await ipc.settings.getAll()
  if (!settings?.apiKey) {
    store.error = '请先在设置页面配置 API Key'
    return
  }

  const request: CodeAnalysisRequest = {
    repoUrl: store.repoConfig.repoUrl,
    branch: store.repoConfig.branch,
    accessToken: store.repoConfig.accessToken,
    authMethod: store.repoConfig.authMethod,
    method: requestInfo.value.method,
    url: requestInfo.value.url,
    path: requestInfo.value.path,
    requestBody: requestInfo.value.requestBody,
    requestHeaders: requestInfo.value.requestHeaders,
    modelName: settings.modelName,
    apiUrl: settings.apiUrl,
    apiKey: settings.apiKey,
    request: requestInfo.value,
  }

  await store.startAnalysis(request)
}

function handleReanalyze(): void {
  store.reset()
  activeTab.value = 'analysis'
}

function handleCleanup(): void {
  store.cleanupRepo()
}

async function copyAllScenarios(): Promise<void> {
  if (!store.result?.scenarios.length) return

  const content = store.result.scenarios
    .map((s, i) => `# 场景 ${i + 1}: ${s.title} (${s.type})\n${s.description}\n\n# cURL\n${s.curl}\n\n# Python 断言\n${s.pythonAssertion}`)
    .join('\n\n' + '='.repeat(60) + '\n\n')

  try {
    await navigator.clipboard.writeText(content)
    showToast('全部用例已复制', 'success')
  } catch {
    showToast('复制失败', 'error')
  }
}

function showToast(message: string, type: string): void {
  toastMessage.value = message
  toastType.value = type as 'success' | 'error' | 'info'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 2000)
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('zh-CN')
  } catch {
    return isoString
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  await store.loadConfig()
  await store.checkGitAvailability()
  // 有历史记录时自动展开下拉提示用户
  if (store.repoConfig.repoUrlHistory.length > 0) {
    showHistory.value = true
    setTimeout(() => { showHistory.value = false }, 1500)
  }
})

onUnmounted(() => {
  store.reset()
  if (toastTimer) clearTimeout(toastTimer)
})

// 分析完成后自动切换到结果 Tab
watch(() => store.result, (newResult) => {
  if (newResult) {
    activeTab.value = newResult.scenarios.length > 0 ? 'curls' : 'analysis'
  }
})
</script>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.prose h1 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; }
.prose h2 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
.prose h3 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
.prose li { margin-left: 1.5rem; list-style-type: disc; }
.prose code {
  background: var(--color-surface);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
}
</style>
