<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="auto-responder-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <h3 class="panel-title">Auto Responder 规则</h3>
        <div class="header-actions">
          <button class="btn-icon" @click="handleAddRule" title="添加规则">
            +
          </button>
          <button class="btn-icon" @click="handleClose" title="关闭">
            &times;
          </button>
        </div>
      </div>

      <!-- 快捷操作 -->
      <div class="quick-actions">
        <button class="btn-text" @click="handleEnableAll">全部启用</button>
        <button class="btn-text" @click="handleDisableAll">全部禁用</button>
        <button class="btn-text danger" @click="handleClearAll">清空</button>
      </div>

      <!-- 规则列表 -->
      <div class="rules-list">
        <div v-if="rules.length === 0" class="empty-state">
          <p>暂无 Auto Responder 规则</p>
          <p class="hint">点击右上角 + 添加规则，直接返回预设响应，不请求服务器</p>
        </div>

        <div
          v-for="rule in rules"
          :key="rule.id"
          :class="['rule-item', { disabled: !rule.enabled }]"
        >
          <div class="rule-header">
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="rule.enabled"
                @change="handleToggle(rule.id)"
              />
              <span class="toggle-slider"></span>
            </label>
            <span class="rule-name">{{ rule.name }}</span>
            <span v-if="rule.match.methods.length > 0" class="method-badges">
              <span v-for="m in rule.match.methods" :key="m" class="method-badge">{{ m }}</span>
            </span>
          </div>

          <div class="rule-details">
            <div class="detail-row">
              <span class="detail-label">URL：</span>
              <span class="detail-value">{{ rule.match.urlPattern }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">响应：</span>
              <span class="detail-value">
                <span class="status-badge" :class="getStatusClass(rule.response.statusCode)">{{ rule.response.statusCode }}</span>
                <span v-if="rule.response.delay > 0" class="delay-badge">⏱️ {{ rule.response.delay }}ms</span>
                <span class="body-preview">{{ getBodyPreview(rule.response.body) }}</span>
              </span>
            </div>
          </div>

          <div class="rule-actions">
            <button class="btn-icon small" @click="handleEdit(rule)" title="编辑">
              ✏️
            </button>
            <button class="btn-icon small" @click="handleDelete(rule.id)" title="删除">
              🗑️
            </button>
          </div>
        </div>
      </div>

      <!-- 添加/编辑规则弹窗 -->
      <div v-if="showForm" class="rule-form-overlay" @click.self="showForm = false">
        <div class="rule-form">
          <h4>{{ editingRule ? '编辑规则' : '添加 Auto Responder 规则' }}</h4>

          <div class="form-group">
            <label>规则名称</label>
            <input v-model="formData.name" placeholder="输入规则名称" />
          </div>

          <div class="form-group">
            <label>URL 匹配模式</label>
            <input v-model="formData.urlPattern" placeholder="*api.example.com/v1*" />
            <div class="hint">支持 * 通配符，如 *shopline.com/api*</div>
          </div>

          <div class="form-group">
            <label>HTTP 方法（可选）</label>
            <div class="methods-grid">
              <label v-for="m in methods" :key="m" :class="['method-checkbox', { checked: formData.methods.includes(m) }]">
                <input
                  type="checkbox"
                  :value="m"
                  v-model="formData.methods"
                />
                {{ m }}
              </label>
            </div>
            <div class="hint">不选择表示匹配所有方法</div>
          </div>

          <div class="form-group">
            <label>响应配置</label>
            <div class="response-config">
              <div class="config-row">
                <label class="config-label">状态码</label>
                <input v-model.number="formData.statusCode" type="number" min="100" max="599" class="config-input" />
              </div>

              <div class="config-row">
                <label class="config-label">延迟 (ms)</label>
                <input v-model.number="formData.delay" type="number" min="0" class="config-input" />
              </div>

              <div class="config-row">
                <label class="config-label">Headers</label>
                <div class="headers-editor">
                  <div v-for="(header, index) in formData.headers" :key="index" class="header-row">
                    <input v-model="header.key" placeholder="Key" class="header-key" />
                    <input v-model="header.value" placeholder="Value" class="header-value" />
                    <button class="btn-icon small" @click="removeHeader(index)" title="删除">×</button>
                  </div>
                  <button class="btn-text" @click="addHeader">+ 添加 Header</button>
                </div>
              </div>

              <div class="config-row">
                <label class="config-label">Body</label>
                <textarea v-model="formData.body" placeholder="响应体内容" class="body-editor" rows="6"></textarea>
              </div>
            </div>
          </div>

          <div v-if="formErrors.length > 0" class="form-errors">
            <p v-for="(err, i) in formErrors" :key="i">{{ err }}</p>
          </div>

          <div class="form-actions">
            <button class="btn btn-secondary" @click="showForm = false">取消</button>
            <button class="btn btn-primary" @click="handleSaveRule">
              {{ editingRule ? '保存' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAutoResponderStore } from '../stores/auto-responder-store'
import type { AutoResponderRule, HttpMethod } from '../services/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const autoResponderStore = useAutoResponderStore()

// 规则列表
const rules = computed(() => autoResponderStore.rules)

// HTTP 方法列表
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

// 表单状态
const showForm = ref(false)
const editingRule = ref<AutoResponderRule | null>(null)
const formErrors = ref<string[]>([])
const formData = ref({
  name: '',
  urlPattern: '',
  methods: [] as HttpMethod[],
  statusCode: 200,
  delay: 0,
  headers: [] as Array<{ key: string; value: string }>,
  body: '',
})

// 获取状态码样式类
function getStatusClass(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return 'status-2xx'
  if (statusCode >= 300 && statusCode < 400) return 'status-3xx'
  if (statusCode >= 400 && statusCode < 500) return 'status-4xx'
  if (statusCode >= 500) return 'status-5xx'
  return ''
}

// 获取 Body 预览
function getBodyPreview(body: string): string {
  if (!body) return ''
  const preview = body.substring(0, 50)
  return preview.length < body.length ? preview + '...' : preview
}

// 添加 Header
function addHeader() {
  formData.value.headers.push({ key: '', value: '' })
}

// 删除 Header
function removeHeader(index: number) {
  formData.value.headers.splice(index, 1)
}

// 添加规则
function handleAddRule() {
  editingRule.value = null
  formData.value = {
    name: '',
    urlPattern: '',
    methods: [],
    statusCode: 200,
    delay: 0,
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    body: '',
  }
  formErrors.value = []
  showForm.value = true
}

// 编辑规则
function handleEdit(rule: AutoResponderRule) {
  editingRule.value = rule
  // 将 headers 对象转换为数组格式
  const headersArray = Object.entries(rule.response.headers).map(([key, value]) => ({ key, value }))
  formData.value = {
    name: rule.name,
    urlPattern: rule.match.urlPattern,
    methods: [...rule.match.methods],
    statusCode: rule.response.statusCode,
    delay: rule.response.delay,
    headers: headersArray.length > 0 ? headersArray : [{ key: 'Content-Type', value: 'application/json' }],
    body: rule.response.body,
  }
  formErrors.value = []
  showForm.value = true
}

// 保存规则
async function handleSaveRule() {
  formErrors.value = []

  // 将 headers 数组转换为对象格式
  const headersObject: Record<string, string> = {}
  for (const header of formData.value.headers) {
    if (header.key.trim()) {
      headersObject[header.key.trim()] = header.value
    }
  }

  if (editingRule.value) {
    // 更新
    const result = await autoResponderStore.updateRule(editingRule.value.id, {
      name: formData.value.name,
      match: {
        urlPattern: formData.value.urlPattern,
        methods: formData.value.methods,
      },
      response: {
        statusCode: formData.value.statusCode,
        headers: headersObject,
        body: formData.value.body,
        delay: formData.value.delay,
      },
    })
    if (!result.success) {
      formErrors.value = result.errors
      return
    }
  } else {
    // 添加
    const result = await autoResponderStore.addRule({
      name: formData.value.name,
      enabled: true,
      match: {
        urlPattern: formData.value.urlPattern,
        methods: formData.value.methods,
      },
      response: {
        statusCode: formData.value.statusCode,
        headers: headersObject,
        body: formData.value.body,
        delay: formData.value.delay,
      },
    })
    if (!result.success) {
      formErrors.value = result.errors
      return
    }
  }

  showForm.value = false
}

// 删除规则
async function handleDelete(ruleId: string) {
  if (confirm('确定要删除这条规则吗？')) {
    await autoResponderStore.removeRule(ruleId)
  }
}

// 切换启用状态
async function handleToggle(ruleId: string) {
  await autoResponderStore.toggleRule(ruleId)
}

// 全部启用
async function handleEnableAll() {
  await autoResponderStore.enableAllRules()
}

// 全部禁用
async function handleDisableAll() {
  await autoResponderStore.disableAllRules()
}

// 清空
async function handleClearAll() {
  if (confirm('确定要清空所有 Auto Responder 规则吗？')) {
    await autoResponderStore.clearAllRules()
  }
}

// 关闭
function handleClose() {
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  backdrop-filter: blur(2px);
}

.auto-responder-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 640px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s;
}

.btn-icon:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.btn-icon.small {
  font-size: 14px;
  padding: 4px;
}

.quick-actions {
  display: flex;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
}

.btn-text {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.15s;
}

.btn-text:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.btn-text.danger {
  color: var(--color-danger);
}

.rules-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
}

.empty-state .hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.6;
}

.rule-item {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 8px;
  transition: opacity 0.15s;
}

.rule-item.disabled {
  opacity: 0.5;
}

.rule-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  transition: 0.3s;
  border-radius: 20px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: var(--color-primary);
}

input:checked + .toggle-slider:before {
  transform: translateX(16px);
}

.rule-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.method-badges {
  display: flex;
  gap: 4px;
}

.method-badge {
  background: var(--color-bg);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  border: 1px solid var(--color-border);
}

.rule-details {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}

.detail-row {
  display: flex;
  margin-bottom: 4px;
}

.detail-label {
  min-width: 40px;
}

.detail-value {
  font-family: monospace;
  color: var(--color-primary);
  word-break: break-all;
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status-2xx {
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  color: var(--color-success);
  border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
}

.status-3xx {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
}

.status-4xx {
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  color: var(--color-warning);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}

.status-5xx {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
}

.delay-badge {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.body-preview {
  font-size: 11px;
  color: var(--color-text-secondary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

/* 表单弹窗 */
.rule-form-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.rule-form {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 520px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
}

.rule-form h4 {
  margin: 0 0 20px 0;
  font-size: 18px;
  color: var(--color-text);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  color: var(--color-text-secondary);
  font-size: 13px;
  margin-bottom: 6px;
}

.form-group input,
.form-group select {
  width: 100%;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.15s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.hint {
  color: var(--color-text-secondary);
  opacity: 0.7;
  font-size: 12px;
  margin-top: 4px;
}

.methods-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.method-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  transition: all 0.15s;
}

.method-checkbox.checked {
  color: var(--color-text);
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.method-checkbox input {
  width: auto;
  margin: 0;
  display: none;
}

.response-config {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
}

.config-row {
  margin-bottom: 12px;
}

.config-row:last-child {
  margin-bottom: 0;
}

.config-label {
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.config-input {
  width: 120px;
}

.headers-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.header-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.header-key {
  width: 120px;
  flex-shrink: 0;
}

.header-value {
  flex: 1;
}

.body-editor {
  width: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: monospace;
  resize: vertical;
  transition: border-color 0.15s;
}

.body-editor:focus {
  outline: none;
  border-color: var(--color-primary);
}

.form-errors {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  border: 1px solid var(--color-danger);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
}

.form-errors p {
  margin: 0;
  color: var(--color-danger);
  font-size: 13px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-border);
}

.btn-primary {
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  color: white;
}

.btn-primary:hover {
  background: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
}
</style>
