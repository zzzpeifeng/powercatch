<template>
  <div class="diff-view">
    <!-- 头部 -->
    <div class="diff-header">
      <button class="btn-back" @click="goBack">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        返回
      </button>
      <h2 class="diff-title">Diff 视图</h2>
      <div class="header-actions">
        <button class="btn-action" @click="swapRequests" :disabled="!hasDiff">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          交换
        </button>
        <button class="btn-action btn-danger" @click="clearDiff">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          清空
        </button>
        <div class="export-dropdown">
          <button class="btn-action" :disabled="!hasDiff">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            导出
          </button>
          <div class="export-menu">
            <button @click="handleExport('html')">HTML 报告</button>
            <button @click="handleExport('markdown')">Markdown</button>
            <button @click="handleExport('json')">JSON</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 无 Diff 状态 -->
    <div v-if="!hasDiff" class="empty-state">
      <div class="empty-icon">
        <svg class="w-16 h-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      </div>
      <div class="empty-text">暂无 Diff 对比</div>
      <div class="empty-hint">请在主页勾选 2 个请求，然后点击"Diff 视图"</div>
    </div>

    <!-- 有 Diff 状态 -->
    <template v-else>
      <!-- 请求卡片 -->
      <div class="request-cards">
        <div class="request-card">
          <div class="card-label">请求 1（较旧）</div>
          <div class="card-value">
            <span class="method-badge" :class="getMethodClass(request1?.method)">{{ request1?.method }}</span>
            <span class="url-text">{{ request1?.path }}</span>
          </div>
          <div class="card-meta">
            <span :class="getStatusClass(request1?.statusCode)">{{ request1?.statusCode ?? '—' }}</span>
            <span>·</span>
            <span>{{ formatSize(request1?.responseBody?.length ?? 0) }}</span>
            <span>·</span>
            <span>{{ request1?.duration ?? '—' }}ms</span>
          </div>
        </div>
        <div class="request-card">
          <div class="card-label">请求 2（较新）</div>
          <div class="card-value">
            <span class="method-badge" :class="getMethodClass(request2?.method)">{{ request2?.method }}</span>
            <span class="url-text">{{ request2?.path }}</span>
          </div>
          <div class="card-meta">
            <span :class="getStatusClass(request2?.statusCode)">{{ request2?.statusCode ?? '—' }}</span>
            <span>·</span>
            <span>{{ formatSize(request2?.responseBody?.length ?? 0) }}</span>
            <span>·</span>
            <span>{{ request2?.duration ?? '—' }}ms</span>
          </div>
        </div>
      </div>

      <!-- Tab 栏 -->
      <div class="tab-bar">
        <div v-for="tab in tabs" :key="tab.key"
             :class="['tab-item', { active: activeTab === tab.key }]"
             @click="setActiveTab(tab.key)">
          {{ tab.label }}
          <span v-if="getTabBadge(tab.key)" class="tab-badge">{{ getTabBadge(tab.key) }}</span>
        </div>
      </div>

      <!-- 内容区 -->
      <div class="diff-content" ref="contentRef">
        <DiffOverview v-if="activeTab === 'overview'" />
        <DiffHeaders v-else-if="activeTab === 'requestHeaders'" :diff="diffResult?.requestHeaders" />
        <DiffBody v-else-if="activeTab === 'requestBody'" :diff="diffResult?.requestBody" />
        <DiffHeaders v-else-if="activeTab === 'responseHeaders'" :diff="diffResult?.responseHeaders" />
        <DiffBody v-else-if="activeTab === 'responseBody'" :diff="diffResult?.responseBody" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDiffStore } from '../stores/diff-store'
import { exportDiff } from '../services/diff-export'
import DiffOverview from '../components/DiffOverview.vue'
import DiffHeaders from '../components/DiffHeaders.vue'
import DiffBody from '../components/DiffBody.vue'

const router = useRouter()
const diffStore = useDiffStore()
const contentRef = ref<HTMLElement>()

// 从 store 解构（使用 storeToRefs 保持响应性）
const { request1, request2, diffResult, activeTab, hasDiff } = storeToRefs(diffStore)

// Tab 配置
const tabs = [
  { key: 'overview', label: '概览' },
  { key: 'requestHeaders', label: '请求头' },
  { key: 'requestBody', label: '请求体' },
  { key: 'responseHeaders', label: '响应头' },
  { key: 'responseBody', label: '响应体' },
]

// 设置 Tab
function setActiveTab(tab: string) {
  diffStore.setActiveTab(tab as any)
}

// 交换请求
function swapRequests() {
  diffStore.swapRequests()
}

// 清空 Diff
function clearDiff() {
  diffStore.clear()
}

// 导出 Diff
function handleExport(format: 'html' | 'markdown' | 'json') {
  if (!request1.value || !request2.value || !diffResult.value) return
  exportDiff(request1.value, request2.value, diffResult.value, format)
}

// 返回主页
function goBack() {
  router.push('/')
}

// 获取 Tab 徽章
function getTabBadge(tab: string): string {
  if (!diffResult.value) return ''
  const stats = diffResult.value.overview.stats
  switch (tab) {
    case 'requestHeaders':
      const reqH = stats.requestHeaders
      return reqH.added + reqH.removed + reqH.modified > 0 ? `${reqH.added + reqH.removed + reqH.modified}` : ''
    case 'requestBody':
      return stats.requestBody.changes > 0 ? `${stats.requestBody.changes}` : ''
    case 'responseHeaders':
      const resH = stats.responseHeaders
      return resH.added + resH.removed + resH.modified > 0 ? `${resH.added + resH.removed + resH.modified}` : ''
    case 'responseBody':
      return stats.responseBody.changes > 0 ? `${stats.responseBody.changes}` : ''
    default:
      return ''
  }
}

// 格式化大小
function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 方法样式
function getMethodClass(method: string | undefined): string {
  if (!method) return ''
  const classes: Record<string, string> = {
    GET: 'method-get',
    POST: 'method-post',
    PUT: 'method-put',
    DELETE: 'method-delete',
    PATCH: 'method-patch',
  }
  return classes[method.toUpperCase()] || ''
}

// 状态码样式
function getStatusClass(status: number | null | undefined): string {
  if (status === null || status === undefined) return ''
  if (status >= 200 && status < 300) return 'status-success'
  if (status >= 300 && status < 400) return 'status-redirect'
  if (status >= 400 && status < 500) return 'status-client-error'
  if (status >= 500) return 'status-server-error'
  return ''
}

// 滚动位置保存/恢复
onMounted(() => {
  const savedPosition = diffStore.getScrollPosition('main')
  if (savedPosition && contentRef.value) {
    nextTick(() => {
      contentRef.value?.scrollTo(0, savedPosition)
    })
  }
})

onBeforeUnmount(() => {
  if (contentRef.value) {
    diffStore.saveScrollPosition('main', contentRef.value.scrollTop)
  }
})
</script>

<style scoped>
.diff-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.btn-back {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-back:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.diff-title {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-action:hover:not(:disabled) {
  background: var(--color-bg);
  color: var(--color-text);
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.export-dropdown {
  position: relative;
}

.export-dropdown:hover .export-menu {
  display: block;
}

.export-menu {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  z-index: 10;
  min-width: 120px;
}

.export-menu button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--color-text);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.export-menu button:hover {
  background: var(--color-bg);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  color: var(--color-text-secondary);
}

.empty-icon {
  opacity: 0.3;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
}

.empty-hint {
  font-size: 13px;
  opacity: 0.7;
}

.request-cards {
  display: flex;
  gap: 1px;
  background: var(--color-border);
}

.request-card {
  flex: 1;
  padding: 12px 16px;
  background: var(--color-surface);
}

.card-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.card-value {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}

.method-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
}

.method-get {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.method-post {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.method-put {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.method-delete {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.method-patch {
  background: rgba(168, 85, 247, 0.2);
  color: #a855f7;
}

.url-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.status-success {
  color: var(--color-success);
}

.status-redirect {
  color: var(--color-warning);
}

.status-client-error {
  color: var(--color-danger);
}

.status-server-error {
  color: var(--color-danger);
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab-item:hover {
  color: var(--color-text);
}

.tab-item.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 500;
}

.tab-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 10px;
  background: var(--color-primary);
  color: white;
}

.diff-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
</style>
