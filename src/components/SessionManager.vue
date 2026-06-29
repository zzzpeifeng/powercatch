<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="session-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <h3 class="panel-title">
          <span>💾</span>
          <span>会话管理</span>
          <span class="session-count">{{ sessions.length }} 个会话</span>
        </h3>
        <div class="header-actions">
          <button class="btn btn-primary btn-sm" @click="showSaveDialog = true">
            + 保存当前会话
          </button>
          <button class="btn-icon" @click="handleClose" title="关闭">
            &times;
          </button>
        </div>
      </div>

      <!-- 搜索 -->
      <div class="search-bar">
        <input
          v-model="searchQuery"
          class="input"
          placeholder="搜索会话名称..."
        />
      </div>

      <!-- 会话列表 -->
      <div class="sessions-list">
        <div v-if="filteredSessions.length === 0" class="empty-state">
          <p>暂无保存的会话</p>
          <p class="hint">点击右上角「保存当前会话」保存当前抓包数据</p>
        </div>

        <div
          v-for="session in filteredSessions"
          :key="session.id"
          class="session-item"
        >
          <span class="session-icon">📁</span>
          <div class="session-info">
            <div class="session-name">{{ session.name }}</div>
            <div class="session-meta">
              <span>{{ session.requestCount }} 个请求</span>
              <span>{{ formatDate(session.startTime) }} - {{ formatDate(session.endTime) }}</span>
            </div>
          </div>
          <div class="session-actions">
            <button class="btn btn-secondary btn-sm" @click="handleLoad(session)">
              加载
            </button>
            <button class="btn-icon" @click="startRename(session)" title="重命名">
              ✏️
            </button>
            <button class="btn-icon danger" @click="handleDelete(session)" title="删除">
              🗑️
            </button>
          </div>
        </div>
      </div>

      <!-- 保存弹窗 -->
      <div v-if="showSaveDialog" class="save-dialog-overlay" @click.self="showSaveDialog = false">
        <div class="save-dialog">
          <h4>💾 保存当前会话</h4>
          <div class="form-group">
            <label>会话名称</label>
            <input
              v-model="saveName"
              class="input"
              placeholder="输入会话名称，如：登录流程调试"
              @keyup.enter="handleSave"
            />
          </div>
          <div class="dialog-info">
            <div class="info-row">
              <span class="info-label">请求数量</span>
              <span>{{ currentRequestCount }} 个</span>
            </div>
            <div class="info-row">
              <span class="info-label">时间范围</span>
              <span>{{ currentTimeRange }}</span>
            </div>
          </div>
          <div class="dialog-actions">
            <button class="btn btn-secondary" @click="showSaveDialog = false">取消</button>
            <button class="btn btn-primary" @click="handleSave" :disabled="!saveName.trim()">保存</button>
          </div>
        </div>
      </div>

      <!-- 重命名弹窗 -->
      <div v-if="renamingSession" class="save-dialog-overlay" @click.self="renamingSession = null">
        <div class="save-dialog">
          <h4>✏️ 重命名会话</h4>
          <div class="form-group">
            <label>新名称</label>
            <input
              v-model="newName"
              class="input"
              placeholder="输入新名称"
              @keyup.enter="handleRename"
            />
          </div>
          <div class="dialog-actions">
            <button class="btn btn-secondary" @click="renamingSession = null">取消</button>
            <button class="btn btn-primary" @click="handleRename" :disabled="!newName.trim()">确定</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRequestStore } from '../stores/request-store'
import type { CaptureSession } from '../services/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const requestStore = useRequestStore()

// 搜索
const searchQuery = ref('')

// 保存弹窗
const showSaveDialog = ref(false)
const saveName = ref('')

// 重命名
const renamingSession = ref<CaptureSession | null>(null)
const newName = ref('')

// 会话列表
const sessions = computed(() => requestStore.sessions)

// 过滤后的会话
const filteredSessions = computed(() => {
  if (!searchQuery.value.trim()) return sessions.value
  const query = searchQuery.value.toLowerCase()
  return sessions.value.filter(s => s.name.toLowerCase().includes(query))
})

// 当前请求数量
const currentRequestCount = computed(() => requestStore.requests.length)

// 当前时间范围
const currentTimeRange = computed(() => {
  const reqs = requestStore.requests
  if (reqs.length === 0) return '无数据'
  const start = new Date(reqs[0].capturedAt)
  const end = new Date(reqs[reqs.length - 1].capturedAt)
  return `${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`
})

// 格式化日期
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
  } catch {
    return dateStr
  }
}

// 关闭
function handleClose(): void {
  emit('close')
}

// 保存会话
async function handleSave(): Promise<void> {
  if (!saveName.value.trim()) return
  await requestStore.saveCurrentSession(saveName.value.trim())
  showSaveDialog.value = false
  saveName.value = ''
}

// 加载会话
async function handleLoad(session: CaptureSession): Promise<void> {
  if (confirm(`确定加载会话「${session.name}」？当前未保存的请求将会丢失。`)) {
    await requestStore.loadSession(session.id)
    handleClose()
  }
}

// 删除会话
async function handleDelete(session: CaptureSession): Promise<void> {
  if (confirm(`确定删除会话「${session.name}」？`)) {
    await requestStore.deleteSession(session.id)
  }
}

// 开始重命名
function startRename(session: CaptureSession): void {
  renamingSession.value = session
  newName.value = session.name
}

// 执行重命名
async function handleRename(): Promise<void> {
  if (!renamingSession.value || !newName.value.trim()) return
  await requestStore.renameSession(renamingSession.value.id, newName.value.trim())
  renamingSession.value = null
  newName.value = ''
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.session-panel {
  background: var(--color-surface, #2d2d2d);
  border-radius: 12px;
  width: 600px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border, #3d3d3d);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.session-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-secondary, #999);
  margin-left: 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-bar {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border, #3d3d3d);
}

.input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border, #3d3d3d);
  background: var(--color-bg, #1a1a1a);
  color: var(--color-text, #f0f0f0);
  font-size: 13px;
  outline: none;
}

.input:focus {
  border-color: var(--color-primary, #60a5fa);
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary, #999);
}

.empty-state .hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.7;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--color-border, #3d3d3d);
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.15s;
}

.session-item:hover {
  border-color: var(--color-primary, #60a5fa);
  background: rgba(96, 165, 250, 0.05);
}

.session-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-name {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 2px;
}

.session-meta {
  font-size: 12px;
  color: var(--color-text-secondary, #999);
  display: flex;
  gap: 12px;
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
}

.btn-primary {
  background: var(--color-primary, #60a5fa);
  color: white;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text-secondary, #999);
  border: 1px solid var(--color-border, #3d3d3d);
}

.btn-secondary:hover {
  background: var(--color-bg, #1a1a1a);
  color: var(--color-text, #f0f0f0);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.btn-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #999);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 14px;
}

.btn-icon:hover {
  background: var(--color-bg, #1a1a1a);
  color: var(--color-text, #f0f0f0);
}

.btn-icon.danger:hover {
  color: var(--color-danger, #f87171);
}

/* 保存弹窗 */
.save-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 110;
}

.save-dialog {
  background: var(--color-surface, #2d2d2d);
  border-radius: 12px;
  padding: 24px;
  width: 400px;
  max-width: 90vw;
}

.save-dialog h4 {
  margin-bottom: 16px;
  font-size: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--color-text-secondary, #999);
}

.dialog-info {
  background: var(--color-bg, #1a1a1a);
  border: 1px solid var(--color-border, #3d3d3d);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}

.info-label {
  color: var(--color-text-secondary, #999);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
