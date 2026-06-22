<template>
  <Teleport to="body">
    <div v-if="currentSession" class="breakpoint-overlay" @click.self="handleOverlayClick">
      <div class="breakpoint-dialog">
        <!-- 头部 -->
        <div class="breakpoint-header">
          <div class="header-info">
            <span class="header-icon">⏸</span>
            <span class="header-title">断点拦截</span>
            <span class="header-badge" v-if="pendingCount > 1">
              {{ currentIndex + 1 }} / {{ pendingCount }}
            </span>
          </div>
          <div class="header-actions">
            <button class="btn-skip" @click="handleSkip" title="跳过（直接放行）">
              跳过
            </button>
            <button class="btn-close" @click="handleClose">&times;</button>
          </div>
        </div>

        <!-- 拦截信息 -->
        <div class="intercept-info">
          <div class="info-row">
            <span class="info-label">规则：</span>
            <span class="info-value">{{ ruleName }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">阶段：</span>
            <span class="info-value">{{ stageLabel }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">URL：</span>
            <span class="info-value url">{{ currentSession.editable.url }}</span>
          </div>
        </div>

        <!-- 编辑区 -->
        <div class="edit-area">
          <!-- Tab 切换 -->
          <div class="tab-bar">
            <button
              v-for="tab in availableTabs"
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
              <div class="url-input-wrapper">
                <span class="url-protocol">{{ urlProtocol }}</span>
                <input
                  v-model="editUrlPath"
                  class="field-input url-input"
                  placeholder="path + query"
                />
              </div>
              <div class="field-hint">只能修改 path 和 query string，不能修改 host</div>
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
              <label class="field-label">
                Body
                <span v-if="isBinaryBody" class="binary-badge">二进制</span>
                <span v-if="isBodyTooLarge" class="size-badge">过大</span>
              </label>
              <textarea
                v-if="!isBinaryBody && !isBodyTooLarge"
                v-model="editData.requestBody"
                class="field-textarea body-textarea"
                rows="10"
                placeholder="请求体内容"
              ></textarea>
              <div v-else class="body-readonly">
                <p v-if="isBinaryBody">二进制数据，不支持编辑</p>
                <p v-if="isBodyTooLarge">Body 超过 100KB，不支持编辑</p>
              </div>
            </div>
          </div>

          <!-- 响应 Tab -->
          <div v-if="activeTab === 'response'" class="tab-content">
            <div class="field-group">
              <label class="field-label">Status Code</label>
              <input
                v-model.number="editData.statusCode"
                type="number"
                class="field-input"
                min="100"
                max="599"
              />
            </div>

            <div class="field-group">
              <label class="field-label">Response Headers</label>
              <textarea
                v-model="editResponseHeadersStr"
                class="field-textarea"
                rows="6"
                placeholder="JSON 格式的响应 headers"
              ></textarea>
            </div>

            <div class="field-group">
              <label class="field-label">
                Response Body
                <span v-if="isBinaryResponseBody" class="binary-badge">二进制</span>
                <span v-if="isResponseBodyTooLarge" class="size-badge">过大</span>
              </label>
              <textarea
                v-if="!isBinaryResponseBody && !isResponseBodyTooLarge"
                v-model="editData.responseBody"
                class="field-textarea body-textarea"
                rows="10"
                placeholder="响应体内容"
              ></textarea>
              <div v-else class="body-readonly">
                <p v-if="isBinaryResponseBody">二进制数据，不支持编辑</p>
                <p v-if="isResponseBodyTooLarge">Body 超过 100KB，不支持编辑</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="action-bar">
          <button class="btn btn-secondary" @click="handleRestore">
            恢复原始
          </button>
          <div class="action-bar-right">
            <button class="btn btn-danger" @click="handleAbort">
              丢弃
            </button>
            <button class="btn btn-primary" @click="handleResume">
              放行
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBreakpointStore } from '../stores/breakpoint-store'
import { ipc } from '../services/ipc'
import type { HttpMethod, HttpHeaders, InterceptSession } from '../services/types'

const breakpointStore = useBreakpointStore()

// 当前会话
const currentSession = computed(() => breakpointStore.currentSession)
const pendingCount = computed(() => breakpointStore.pendingSessionsCount)
const currentIndex = computed(() => breakpointStore.currentSessionIndex)

// 编辑数据
const editData = ref({
  method: 'GET' as HttpMethod,
  url: '',
  requestHeaders: {} as HttpHeaders,
  requestBody: '',
  statusCode: 200,
  responseHeaders: {} as HttpHeaders,
  responseBody: '',
})

// 当前激活的 tab
const activeTab = ref<string>('request')

// 可用的 HTTP 方法
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

// 规则名称
const ruleName = computed(() => {
  if (!currentSession.value) return ''
  const rule = breakpointStore.rules.find(r => r.id === currentSession.value?.ruleId)
  return rule?.name || '未知规则'
})

// 阶段标签
const stageLabel = computed(() => {
  if (!currentSession.value) return ''
  return currentSession.value.stage === 'request' ? '请求阶段' : '响应阶段'
})

// 可用的 tabs
const availableTabs = computed(() => {
  if (!currentSession.value) return []
  const tabs = [{ key: 'request', label: '请求' }]
  if (currentSession.value.stage === 'response') {
    tabs.push({ key: 'response', label: '响应' })
  }
  return tabs
})

// URL 协议部分（只读）
const urlProtocol = computed(() => {
  try {
    const url = new URL(editData.value.url)
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
})

// URL path 部分（可编辑）
const editUrlPath = computed({
  get: () => {
    try {
      const url = new URL(editData.value.url)
      return url.pathname + url.search
    } catch {
      return editData.value.url
    }
  },
  set: (value) => {
    try {
      const url = new URL(editData.value.url)
      editData.value.url = `${url.protocol}//${url.host}${value}`
    } catch {
      editData.value.url = value
    }
  },
})

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

// 响应 Headers 字符串
const editResponseHeadersStr = computed({
  get: () => JSON.stringify(editData.value.responseHeaders, null, 2),
  set: (value) => {
    try {
      editData.value.responseHeaders = JSON.parse(value)
    } catch {
      // 解析失败，保持原样
    }
  },
})

// 是否为二进制 body
const isBinaryBody = computed(() => {
  return editData.value.requestBody.startsWith('[Base64:')
})

// Body 是否过大
const isBodyTooLarge = computed(() => {
  return editData.value.requestBody.startsWith('[Body too large:')
})

// 是否为二进制响应 body
const isBinaryResponseBody = computed(() => {
  return (editData.value.responseBody || '').startsWith('[Base64:')
})

// 响应 Body 是否过大
const isResponseBodyTooLarge = computed(() => {
  return (editData.value.responseBody || '').startsWith('[Body too large:')
})

// 监听会话变化，更新编辑数据
watch(currentSession, (session) => {
  if (session) {
    editData.value = {
      method: session.editable.method,
      url: session.editable.url,
      requestHeaders: { ...session.editable.requestHeaders },
      requestBody: session.editable.requestBody,
      statusCode: session.editable.statusCode || 200,
      responseHeaders: session.editable.responseHeaders ? { ...session.editable.responseHeaders } : {},
      responseBody: session.editable.responseBody || '',
    }
    // 根据阶段自动选择 tab
    activeTab.value = session.stage === 'response' ? 'response' : 'request'
  }
}, { immediate: true })

// 恢复原始数据
function handleRestore() {
  if (currentSession.value) {
    breakpointStore.restoreOriginal(currentSession.value.id)
    editData.value = {
      method: currentSession.value.original.method,
      url: currentSession.value.original.url,
      requestHeaders: { ...currentSession.value.original.requestHeaders },
      requestBody: currentSession.value.original.requestBody,
      statusCode: currentSession.value.original.statusCode || 200,
      responseHeaders: currentSession.value.original.responseHeaders ? { ...currentSession.value.original.responseHeaders } : {},
      responseBody: currentSession.value.original.responseBody || '',
    }
  }
}

// 放行
async function handleResume() {
  if (!currentSession.value) return

  const session = currentSession.value
  const modified = {
    method: editData.value.method,
    url: editData.value.url,
    requestHeaders: editData.value.requestHeaders,
    requestBody: editData.value.requestBody,
    statusCode: editData.value.statusCode,
    responseHeaders: editData.value.responseHeaders,
    responseBody: editData.value.responseBody,
  }

  // 通过 IPC 通知主进程
  await ipc.breakpoint.resume({
    sessionId: session.id,
    action: 'resume',
    modified,
  })

  // 更新 store
  breakpointStore.resumeSession(session.id, modified)
}

// 丢弃
async function handleAbort() {
  if (!currentSession.value) return

  const session = currentSession.value

  // 通过 IPC 通知主进程
  await ipc.breakpoint.abort(session.id)

  // 更新 store
  breakpointStore.abortSession(session.id)
}

// 跳过（直接放行，不编辑）
async function handleSkip() {
  if (!currentSession.value) return
  await handleResume()
}

// 关闭（不处理，保持拦截状态）
function handleClose() {
  // 可以选择关闭弹窗但不放行
  // 这里暂时不实现，因为断点需要用户明确操作
}

// 点击遮罩
function handleOverlayClick() {
  // 不关闭，断点需要用户明确操作
}
</script>

<style scoped>
.breakpoint-overlay {
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

.breakpoint-dialog {
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

.breakpoint-header {
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

.header-badge {
  background: var(--accent-color, #4a9eff);
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-skip {
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-color, #444);
  color: var(--text-secondary, #aaa);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.btn-skip:hover {
  background: var(--bg-tertiary, #333);
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

.intercept-info {
  padding: 16px 20px;
  background: var(--bg-secondary, #222);
  border-bottom: 1px solid var(--border-color, #333);
}

.info-row {
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  color: var(--text-secondary, #888);
  font-size: 13px;
  min-width: 60px;
}

.info-value {
  color: var(--text-primary, #fff);
  font-size: 13px;
  word-break: break-all;
}

.info-value.url {
  font-family: monospace;
  color: var(--accent-color, #4a9eff);
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

.binary-badge,
.size-badge {
  background: var(--warning-color, #ff9800);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-left: 8px;
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

.url-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--bg-secondary, #222);
  border: 1px solid var(--border-color, #444);
  border-radius: 6px;
  overflow: hidden;
}

.url-protocol {
  background: var(--bg-tertiary, #333);
  color: var(--text-secondary, #888);
  padding: 10px 12px;
  font-size: 13px;
  font-family: monospace;
  border-right: 1px solid var(--border-color, #444);
}

.url-input {
  border: none;
  border-radius: 0;
}

.field-hint {
  color: var(--text-tertiary, #666);
  font-size: 12px;
  margin-top: 4px;
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

.body-readonly {
  background: var(--bg-secondary, #222);
  border: 1px solid var(--border-color, #444);
  border-radius: 6px;
  padding: 20px;
  text-align: center;
  color: var(--text-secondary, #888);
}

.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #333);
  background: var(--bg-secondary, #222);
}

.action-bar-right {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: var(--bg-tertiary, #333);
  border: 1px solid var(--border-color, #444);
  color: var(--text-primary, #fff);
}

.btn-secondary:hover {
  background: var(--bg-quaternary, #444);
}

.btn-danger {
  background: var(--danger-color, #ff4444);
  border: 1px solid var(--danger-color, #ff4444);
  color: white;
}

.btn-danger:hover {
  background: var(--danger-hover, #ff6666);
}

.btn-primary {
  background: var(--accent-color, #4a9eff);
  border: 1px solid var(--accent-color, #4a9eff);
  color: white;
}

.btn-primary:hover {
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
  --danger-hover: #ff6666;
  --warning-color: #ff9800;
}
</style>
