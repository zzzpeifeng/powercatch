<template>
  <Teleport to="body">
    <div v-if="visible" class="replay-overlay" @click.self="handleClose">
      <div class="replay-dialog">
        <!-- 头部 -->
        <div class="replay-header">
          <div class="header-info">
            <span class="header-icon">🔄</span>
            <span class="header-title">编辑后重发</span>
          </div>
          <button class="btn-close" @click="handleClose">&times;</button>
        </div>

        <!-- 编辑区 -->
        <div class="edit-area">
          <!-- Tab 切换 -->
          <div class="tab-bar">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              :class="['tab-btn', { active: activeTab === tab.key }]"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- 请求 Tab -->
          <div v-if="activeTab === 'request'" class="tab-content">
            <div class="field-group">
              <label class="field-label">Method</label>
              <select v-model="editData.method" class="field-select">
                <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>

            <div class="field-group">
              <label class="field-label">URL</label>
              <input
                v-model="editData.url"
                class="field-input"
                placeholder="完整的请求 URL"
              />
            </div>

            <div class="field-group">
              <label class="field-label">Headers</label>
              <textarea
                v-model="editHeadersStr"
                class="field-textarea"
                rows="6"
                placeholder="JSON 格式的 headers"
              ></textarea>
            </div>

            <div class="field-group">
              <label class="field-label">Body</label>
              <textarea
                v-model="editData.requestBody"
                class="field-textarea body-textarea"
                rows="10"
                placeholder="请求体内容"
              ></textarea>
            </div>
          </div>

          <!-- 结果 Tab -->
          <div v-if="activeTab === 'result'" class="tab-content">
            <div v-if="replayResult" class="result-content">
              <div class="result-status" :class="statusClass">
                <span class="status-code">{{ replayResult.statusCode }}</span>
                <span class="status-duration">{{ replayResult.duration }}ms</span>
              </div>

              <div class="field-group">
                <label class="field-label">响应头</label>
                <pre class="result-pre">{{ formatHeaders(replayResult.responseHeaders) }}</pre>
              </div>

              <div class="field-group">
                <label class="field-label">响应体</label>
                <pre class="result-pre body-pre">{{ formatBody(replayResult.responseBody) }}</pre>
              </div>
            </div>

            <div v-else-if="isReplaying" class="result-loading">
              <div class="loading-spinner"></div>
              <span>正在重发请求...</span>
            </div>

            <div v-else-if="replayError" class="result-error">
              <span class="error-icon">❌</span>
              <span class="error-message">{{ replayError }}</span>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="action-bar">
          <button class="btn btn-secondary" @click="handleClose">
            取消
          </button>
          <button
            class="btn btn-primary"
            :disabled="isReplaying"
            @click="handleSend"
          >
            {{ isReplaying ? '发送中...' : '发送' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ipc } from '../services/ipc'
import type { CaptureRequest, HttpMethod, HttpHeaders, ReplayResult } from '../services/types'

const props = defineProps<{
  visible: boolean
  request: CaptureRequest | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: string): void
}>()

// 编辑数据
const editData = ref({
  method: 'GET' as HttpMethod,
  url: '',
  requestHeaders: {} as HttpHeaders,
  requestBody: '',
})

// 当前激活的 tab
const activeTab = ref<string>('request')

// 重发结果
const replayResult = ref<ReplayResult | null>(null)
const replayError = ref<string>('')
const isReplaying = ref(false)

// 可用的 HTTP 方法
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

// Tab 列表
const tabs = [
  { key: 'request', label: '请求' },
  { key: 'result', label: '结果' },
]

// Headers 字符串（JSON 格式）
const editHeadersStr = computed({
  get: () => JSON.stringify(editData.value.requestHeaders, null, 2),
  set: (value) => {
    try {
      editData.value.requestHeaders = JSON.parse(value)
    } catch {
      // 解析失败，保持原样
    }
  },
})

// 状态码样式类
const statusClass = computed(() => {
  if (!replayResult.value?.statusCode) return ''
  const code = replayResult.value.statusCode
  if (code >= 200 && code < 300) return 'status-2xx'
  if (code >= 300 && code < 400) return 'status-3xx'
  if (code >= 400 && code < 500) return 'status-4xx'
  if (code >= 500) return 'status-5xx'
  return ''
})

// 监听请求变化，更新编辑数据
watch(() => props.request, (request) => {
  if (request) {
    editData.value = {
      method: request.method,
      url: request.url,
      requestHeaders: { ...request.requestHeaders },
      requestBody: request.requestBody,
    }
    // 重置结果
    replayResult.value = null
    replayError.value = ''
    activeTab.value = 'request'
  }
}, { immediate: true })

// 监听 visible 变化
watch(() => props.visible, (visible) => {
  if (visible && props.request) {
    editData.value = {
      method: props.request.method,
      url: props.request.url,
      requestHeaders: { ...props.request.requestHeaders },
      requestBody: props.request.requestBody,
    }
    replayResult.value = null
    replayError.value = ''
    activeTab.value = 'request'
  }
})

// 格式化响应头
function formatHeaders(headers?: HttpHeaders): string {
  if (!headers) return '无'
  return JSON.stringify(headers, null, 2)
}

// 格式化响应体
function formatBody(body?: string): string {
  if (!body) return '无'
  try {
    // 尝试格式化 JSON
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    // 非 JSON，直接返回
    return body
  }
}

// 发送请求
async function handleSend() {
  if (isReplaying.value) return

  isReplaying.value = true
  replayResult.value = null
  replayError.value = ''

  try {
    const result = await ipc.request.replay({
      method: editData.value.method,
      url: editData.value.url,
      requestHeaders: editData.value.requestHeaders,
      requestBody: editData.value.requestBody,
    })

    if (result.success) {
      replayResult.value = result
      activeTab.value = 'result'
      emit('toast', `重发成功: ${result.statusCode} (${result.duration}ms)`, 'success')
    } else {
      replayError.value = result.error || '重发失败'
      activeTab.value = 'result'
      emit('toast', `重发失败: ${result.error}`, 'error')
    }
  } catch (error: any) {
    replayError.value = error.message || '重发失败'
    activeTab.value = 'result'
    emit('toast', `重发失败: ${error.message}`, 'error')
  } finally {
    isReplaying.value = false
  }
}

// 关闭弹窗
function handleClose() {
  emit('close')
}
</script>

<style scoped>
.replay-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

.replay-dialog {
  background: var(--bg-primary, #1a1a1a);
  border: 1px solid var(--border-color, #333);
  border-radius: 12px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.replay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #333);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  font-size: 20px;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.btn-close {
  background: none;
  border: none;
  color: var(--text-secondary, #aaa);
  font-size: 24px;
  cursor: pointer;
  padding: 0 4px;
}

.btn-close:hover {
  color: var(--text-primary, #fff);
}

.edit-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-color, #333);
  padding: 0 20px;
}

.tab-btn {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  padding: 12px 20px;
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text-primary, #fff);
}

.tab-btn.active {
  color: var(--accent-color, #4a9eff);
  border-bottom-color: var(--accent-color, #4a9eff);
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.field-group {
  margin-bottom: 16px;
}

.field-label {
  display: block;
  color: var(--text-secondary, #888);
  font-size: 13px;
  margin-bottom: 6px;
}

.field-input,
.field-select {
  width: 100%;
  background: var(--bg-secondary, #222);
  border: 1px solid var(--border-color, #444);
  color: var(--text-primary, #fff);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-family: monospace;
}

.field-input:focus,
.field-select:focus,
.field-textarea:focus {
  outline: none;
  border-color: var(--accent-color, #4a9eff);
}

.field-textarea {
  width: 100%;
  background: var(--bg-secondary, #222);
  border: 1px solid var(--border-color, #444);
  color: var(--text-primary, #fff);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: monospace;
  resize: vertical;
  min-height: 100px;
}

.body-textarea {
  min-height: 200px;
}

/* 结果展示 */
.result-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg-secondary, #222);
  border-radius: 8px;
}

.status-code {
  font-size: 32px;
  font-weight: 700;
  font-family: monospace;
}

.status-duration {
  font-size: 16px;
  color: var(--text-secondary, #888);
}

.status-2xx .status-code {
  color: #4caf50;
}

.status-3xx .status-code {
  color: #ff9800;
}

.status-4xx .status-code {
  color: #f44336;
}

.status-5xx .status-code {
  color: #9c27b0;
}

.result-pre {
  background: var(--bg-secondary, #222);
  border: 1px solid var(--border-color, #444);
  border-radius: 6px;
  padding: 12px;
  font-size: 13px;
  font-family: monospace;
  color: var(--text-primary, #fff);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.body-pre {
  max-height: 400px;
}

/* 加载状态 */
.result-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 40px;
  color: var(--text-secondary, #888);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color, #333);
  border-top-color: var(--accent-color, #4a9eff);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 错误状态 */
.result-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  background: var(--danger-bg, #3a1111);
  border-radius: 8px;
  color: var(--danger-color, #ff4444);
}

.error-icon {
  font-size: 20px;
}

.error-message {
  font-size: 14px;
}

/* 操作栏 */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #333);
  background: var(--bg-secondary, #222);
}

.btn {
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-tertiary, #333);
  border: 1px solid var(--border-color, #444);
  color: var(--text-primary, #fff);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-quaternary, #444);
}

.btn-primary {
  background: var(--accent-color, #4a9eff);
  border: 1px solid var(--accent-color, #4a9eff);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #6ab4ff);
}

/* 暗色主题变量 */
:root {
  --bg-primary: #1a1a1a;
  --bg-secondary: #222;
  --bg-tertiary: #2a2a2a;
  --bg-quaternary: #333;
  --border-color: #333;
  --text-primary: #fff;
  --text-secondary: #888;
  --text-tertiary: #666;
  --accent-color: #4a9eff;
  --accent-hover: #6ab4ff;
  --danger-color: #ff4444;
  --danger-bg: #3a1111;
  --danger-hover: #ff6666;
  --warning-color: #ff9800;
}
</style>
