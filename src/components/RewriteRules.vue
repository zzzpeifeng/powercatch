<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="rewrite-rules-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <h3 class="panel-title">Rewrite Rules 规则</h3>
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
          <p>暂无 Rewrite Rules 规则</p>
          <p class="hint">点击右上角 + 添加规则，自动修改匹配请求的 URL/Header/Body/Status</p>
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
              <span class="detail-label">重写：</span>
              <span class="detail-value rewrite-summary">
                <span v-if="rule.rewrite.url" class="rewrite-badge url">URL</span>
                <span v-if="rule.rewrite.requestHeaders" class="rewrite-badge header">请求头</span>
                <span v-if="rule.rewrite.responseHeaders" class="rewrite-badge header">响应头</span>
                <span v-if="rule.rewrite.requestBody" class="rewrite-badge body">请求体</span>
                <span v-if="rule.rewrite.responseBody" class="rewrite-badge body">响应体</span>
                <span v-if="rule.rewrite.statusCode" class="rewrite-badge status">{{ rule.rewrite.statusCode }}</span>
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
          <h4>{{ editingRule ? '编辑规则' : '添加 Rewrite Rules 规则' }}</h4>

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

          <!-- 重写配置 -->
          <div class="form-group">
            <label>重写配置</label>
            <div class="rewrite-config">
              <!-- URL 重写 -->
              <div class="config-section">
                <label class="config-toggle">
                  <input type="checkbox" v-model="formData.enableUrl" />
                  <span>URL 重写</span>
                </label>
                <div v-if="formData.enableUrl" class="config-content">
                  <div class="config-row">
                    <label class="config-label">Pattern（正则）</label>
                    <input v-model="formData.urlPattern_regex" placeholder="/old-api/" class="config-input" />
                  </div>
                  <div class="config-row">
                    <label class="config-label">Replacement</label>
                    <input v-model="formData.urlReplacement" placeholder="/new-api/" class="config-input" />
                  </div>
                </div>
              </div>

              <!-- 请求头修改 -->
              <div class="config-section">
                <label class="config-toggle">
                  <input type="checkbox" v-model="formData.enableRequestHeaders" />
                  <span>请求头修改</span>
                </label>
                <div v-if="formData.enableRequestHeaders" class="config-content">
                  <div class="sub-section">
                    <label class="sub-label">添加</label>
                    <div v-for="(header, index) in formData.requestHeadersAdd" :key="'add-' + index" class="header-row">
                      <input v-model="header.key" placeholder="Key" class="header-key" />
                      <input v-model="header.value" placeholder="Value" class="header-value" />
                      <button class="btn-icon small" @click="formData.requestHeadersAdd.splice(index, 1)" title="删除">×</button>
                    </div>
                    <button class="btn-text" @click="formData.requestHeadersAdd.push({ key: '', value: '' })">+ 添加</button>
                  </div>
                  <div class="sub-section">
                    <label class="sub-label">删除</label>
                    <div v-for="(header, index) in formData.requestHeadersRemove" :key="'remove-' + index" class="header-row">
                      <input v-model="formData.requestHeadersRemove[index]" placeholder="Header Name" class="header-key" />
                      <button class="btn-icon small" @click="formData.requestHeadersRemove.splice(index, 1)" title="删除">×</button>
                    </div>
                    <button class="btn-text" @click="formData.requestHeadersRemove.push('')">+ 添加</button>
                  </div>
                  <div class="sub-section">
                    <label class="sub-label">修改（覆盖）</label>
                    <div v-for="(header, index) in formData.requestHeadersModify" :key="'modify-' + index" class="header-row">
                      <input v-model="header.key" placeholder="Key" class="header-key" />
                      <input v-model="header.value" placeholder="Value" class="header-value" />
                      <button class="btn-icon small" @click="formData.requestHeadersModify.splice(index, 1)" title="删除">×</button>
                    </div>
                    <button class="btn-text" @click="formData.requestHeadersModify.push({ key: '', value: '' })">+ 添加</button>
                  </div>
                </div>
              </div>

              <!-- 响应头修改 -->
              <div class="config-section">
                <label class="config-toggle">
                  <input type="checkbox" v-model="formData.enableResponseHeaders" />
                  <span>响应头修改</span>
                </label>
                <div v-if="formData.enableResponseHeaders" class="config-content">
                  <div class="sub-section">
                    <label class="sub-label">添加</label>
                    <div v-for="(header, index) in formData.responseHeadersAdd" :key="'add-' + index" class="header-row">
                      <input v-model="header.key" placeholder="Key" class="header-key" />
                      <input v-model="header.value" placeholder="Value" class="header-value" />
                      <button class="btn-icon small" @click="formData.responseHeadersAdd.splice(index, 1)" title="删除">×</button>
                    </div>
                    <button class="btn-text" @click="formData.responseHeadersAdd.push({ key: '', value: '' })">+ 添加</button>
                  </div>
                  <div class="sub-section">
                    <label class="sub-label">删除</label>
                    <div v-for="(header, index) in formData.responseHeadersRemove" :key="'remove-' + index" class="header-row">
                      <input v-model="formData.responseHeadersRemove[index]" placeholder="Header Name" class="header-key" />
                      <button class="btn-icon small" @click="formData.responseHeadersRemove.splice(index, 1)" title="删除">×</button>
                    </div>
                    <button class="btn-text" @click="formData.responseHeadersRemove.push('')">+ 添加</button>
                  </div>
                  <div class="sub-section">
                    <label class="sub-label">修改（覆盖）</label>
                    <div v-for="(header, index) in formData.responseHeadersModify" :key="'modify-' + index" class="header-row">
                      <input v-model="header.key" placeholder="Key" class="header-key" />
                      <input v-model="header.value" placeholder="Value" class="header-value" />
                      <button class="btn-icon small" @click="formData.responseHeadersModify.splice(index, 1)" title="删除">×</button>
                    </div>
                    <button class="btn-text" @click="formData.responseHeadersModify.push({ key: '', value: '' })">+ 添加</button>
                  </div>
                </div>
              </div>

              <!-- 请求体修改 -->
              <div class="config-section">
                <label class="config-toggle">
                  <input type="checkbox" v-model="formData.enableRequestBody" />
                  <span>请求体修改</span>
                </label>
                <div v-if="formData.enableRequestBody" class="config-content">
                  <div class="config-row">
                    <label class="config-label">模式</label>
                    <div class="radio-group">
                      <label><input type="radio" value="replace" v-model="formData.requestBodyMode" /> 替换匹配</label>
                      <label><input type="radio" value="full" v-model="formData.requestBodyMode" /> 完整替换</label>
                    </div>
                  </div>
                  <div v-if="formData.requestBodyMode === 'replace'" class="config-row">
                    <label class="config-label">Pattern</label>
                    <input v-model="formData.requestBodyPattern" placeholder="匹配的文本" class="config-input" />
                  </div>
                  <div class="config-row">
                    <label class="config-label">{{ formData.requestBodyMode === 'full' ? '完整替换内容' : 'Replacement' }}</label>
                    <textarea v-model="formData.requestBodyReplacement" placeholder="替换内容" class="body-editor" rows="3"></textarea>
                  </div>
                </div>
              </div>

              <!-- 响应体修改 -->
              <div class="config-section">
                <label class="config-toggle">
                  <input type="checkbox" v-model="formData.enableResponseBody" />
                  <span>响应体修改</span>
                </label>
                <div v-if="formData.enableResponseBody" class="config-content">
                  <div class="config-row">
                    <label class="config-label">模式</label>
                    <div class="radio-group">
                      <label><input type="radio" value="replace" v-model="formData.responseBodyMode" /> 替换匹配</label>
                      <label><input type="radio" value="full" v-model="formData.responseBodyMode" /> 完整替换</label>
                    </div>
                  </div>
                  <div v-if="formData.responseBodyMode === 'replace'" class="config-row">
                    <label class="config-label">Pattern</label>
                    <input v-model="formData.responseBodyPattern" placeholder="匹配的文本" class="config-input" />
                  </div>
                  <div class="config-row">
                    <label class="config-label">{{ formData.responseBodyMode === 'full' ? '完整替换内容' : 'Replacement' }}</label>
                    <textarea v-model="formData.responseBodyReplacement" placeholder="替换内容" class="body-editor" rows="3"></textarea>
                  </div>
                </div>
              </div>

              <!-- 状态码覆盖 -->
              <div class="config-section">
                <label class="config-toggle">
                  <input type="checkbox" v-model="formData.enableStatusCode" />
                  <span>状态码覆盖</span>
                </label>
                <div v-if="formData.enableStatusCode" class="config-content">
                  <div class="config-row">
                    <label class="config-label">Status Code</label>
                    <input v-model.number="formData.statusCode" type="number" min="100" max="599" class="config-input" />
                  </div>
                </div>
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
import { useRewriteRulesStore } from '../stores/rewrite-rules-store'
import type { RewriteRule, HttpMethod } from '../services/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const rewriteRulesStore = useRewriteRulesStore()

// 规则列表
const rules = computed(() => rewriteRulesStore.rules)

// HTTP 方法列表
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

// 表单状态
const showForm = ref(false)
const editingRule = ref<RewriteRule | null>(null)
const formErrors = ref<string[]>([])
const formData = ref({
  name: '',
  urlPattern: '',
  methods: [] as HttpMethod[],
  // URL 重写
  enableUrl: false,
  urlPattern_regex: '',
  urlReplacement: '',
  // 请求头修改
  enableRequestHeaders: false,
  requestHeadersAdd: [] as Array<{ key: string; value: string }>,
  requestHeadersRemove: [] as string[],
  requestHeadersModify: [] as Array<{ key: string; value: string }>,
  // 响应头修改
  enableResponseHeaders: false,
  responseHeadersAdd: [] as Array<{ key: string; value: string }>,
  responseHeadersRemove: [] as string[],
  responseHeadersModify: [] as Array<{ key: string; value: string }>,
  // 请求体修改
  enableRequestBody: false,
  requestBodyMode: 'replace' as 'replace' | 'full',
  requestBodyPattern: '',
  requestBodyReplacement: '',
  // 响应体修改
  enableResponseBody: false,
  responseBodyMode: 'replace' as 'replace' | 'full',
  responseBodyPattern: '',
  responseBodyReplacement: '',
  // 状态码覆盖
  enableStatusCode: false,
  statusCode: 200,
})

// 数组转对象（过滤空值）
function arrayToObject(arr: Array<{ key: string; value: string }>): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const item of arr) {
    if (item.key.trim()) {
      obj[item.key.trim()] = item.value
    }
  }
  return obj
}

// 对象转数组
function objectToArray(obj: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(obj).map(([key, value]) => ({ key, value }))
}

// 添加规则
function handleAddRule() {
  editingRule.value = null
  formData.value = {
    name: '',
    urlPattern: '',
    methods: [],
    enableUrl: false,
    urlPattern_regex: '',
    urlReplacement: '',
    enableRequestHeaders: false,
    requestHeadersAdd: [],
    requestHeadersRemove: [],
    requestHeadersModify: [],
    enableResponseHeaders: false,
    responseHeadersAdd: [],
    responseHeadersRemove: [],
    responseHeadersModify: [],
    enableRequestBody: false,
    requestBodyMode: 'replace',
    requestBodyPattern: '',
    requestBodyReplacement: '',
    enableResponseBody: false,
    responseBodyMode: 'replace',
    responseBodyPattern: '',
    responseBodyReplacement: '',
    enableStatusCode: false,
    statusCode: 200,
  }
  formErrors.value = []
  showForm.value = true
}

// 编辑规则
function handleEdit(rule: RewriteRule) {
  editingRule.value = rule
  formData.value = {
    name: rule.name,
    urlPattern: rule.match.urlPattern,
    methods: [...rule.match.methods],
    // URL 重写
    enableUrl: !!rule.rewrite.url,
    urlPattern_regex: rule.rewrite.url?.pattern || '',
    urlReplacement: rule.rewrite.url?.replacement || '',
    // 请求头修改
    enableRequestHeaders: !!rule.rewrite.requestHeaders,
    requestHeadersAdd: rule.rewrite.requestHeaders?.add ? objectToArray(rule.rewrite.requestHeaders.add) : [],
    requestHeadersRemove: rule.rewrite.requestHeaders?.remove ? [...rule.rewrite.requestHeaders.remove] : [],
    requestHeadersModify: rule.rewrite.requestHeaders?.modify ? objectToArray(rule.rewrite.requestHeaders.modify) : [],
    // 响应头修改
    enableResponseHeaders: !!rule.rewrite.responseHeaders,
    responseHeadersAdd: rule.rewrite.responseHeaders?.add ? objectToArray(rule.rewrite.responseHeaders.add) : [],
    responseHeadersRemove: rule.rewrite.responseHeaders?.remove ? [...rule.rewrite.responseHeaders.remove] : [],
    responseHeadersModify: rule.rewrite.responseHeaders?.modify ? objectToArray(rule.rewrite.responseHeaders.modify) : [],
    // 请求体修改
    enableRequestBody: !!rule.rewrite.requestBody,
    requestBodyMode: rule.rewrite.requestBody?.fullReplace ? 'full' : 'replace',
    requestBodyPattern: rule.rewrite.requestBody?.pattern || '',
    requestBodyReplacement: rule.rewrite.requestBody?.fullReplace || rule.rewrite.requestBody?.replacement || '',
    // 响应体修改
    enableResponseBody: !!rule.rewrite.responseBody,
    responseBodyMode: rule.rewrite.responseBody?.fullReplace ? 'full' : 'replace',
    responseBodyPattern: rule.rewrite.responseBody?.pattern || '',
    responseBodyReplacement: rule.rewrite.responseBody?.fullReplace || rule.rewrite.responseBody?.replacement || '',
    // 状态码覆盖
    enableStatusCode: !!rule.rewrite.statusCode,
    statusCode: rule.rewrite.statusCode || 200,
  }
  formErrors.value = []
  showForm.value = true
}

// 构建 rewrite 对象
function buildRewrite(): RewriteRule['rewrite'] {
  const rewrite: RewriteRule['rewrite'] = {}

  if (formData.value.enableUrl) {
    rewrite.url = {
      pattern: formData.value.urlPattern_regex,
      replacement: formData.value.urlReplacement,
    }
  }

  if (formData.value.enableRequestHeaders) {
    const add = arrayToObject(formData.value.requestHeadersAdd)
    const remove = formData.value.requestHeadersRemove.filter(h => h.trim())
    const modify = arrayToObject(formData.value.requestHeadersModify)
    if (Object.keys(add).length > 0 || remove.length > 0 || Object.keys(modify).length > 0) {
      rewrite.requestHeaders = { add, remove, modify }
    }
  }

  if (formData.value.enableResponseHeaders) {
    const add = arrayToObject(formData.value.responseHeadersAdd)
    const remove = formData.value.responseHeadersRemove.filter(h => h.trim())
    const modify = arrayToObject(formData.value.responseHeadersModify)
    if (Object.keys(add).length > 0 || remove.length > 0 || Object.keys(modify).length > 0) {
      rewrite.responseHeaders = { add, remove, modify }
    }
  }

  if (formData.value.enableRequestBody) {
    if (formData.value.requestBodyMode === 'full') {
      rewrite.requestBody = { fullReplace: formData.value.requestBodyReplacement }
    } else {
      rewrite.requestBody = {
        pattern: formData.value.requestBodyPattern,
        replacement: formData.value.requestBodyReplacement,
      }
    }
  }

  if (formData.value.enableResponseBody) {
    if (formData.value.responseBodyMode === 'full') {
      rewrite.responseBody = { fullReplace: formData.value.responseBodyReplacement }
    } else {
      rewrite.responseBody = {
        pattern: formData.value.responseBodyPattern,
        replacement: formData.value.responseBodyReplacement,
      }
    }
  }

  if (formData.value.enableStatusCode) {
    rewrite.statusCode = formData.value.statusCode
  }

  return rewrite
}

// 保存规则
async function handleSaveRule() {
  formErrors.value = []

  const rewrite = buildRewrite()

  if (editingRule.value) {
    // 更新
    const result = await rewriteRulesStore.updateRule(editingRule.value.id, {
      name: formData.value.name,
      match: {
        urlPattern: formData.value.urlPattern,
        methods: formData.value.methods,
      },
      rewrite,
    })
    if (!result.success) {
      formErrors.value = result.errors
      return
    }
  } else {
    // 添加
    const result = await rewriteRulesStore.addRule({
      name: formData.value.name,
      enabled: true,
      match: {
        urlPattern: formData.value.urlPattern,
        methods: formData.value.methods,
      },
      rewrite,
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
    await rewriteRulesStore.removeRule(ruleId)
  }
}

// 切换启用状态
async function handleToggle(ruleId: string) {
  await rewriteRulesStore.toggleRule(ruleId)
}

// 全部启用
async function handleEnableAll() {
  await rewriteRulesStore.enableAllRules()
}

// 全部禁用
async function handleDisableAll() {
  await rewriteRulesStore.disableAllRules()
}

// 清空
async function handleClearAll() {
  if (confirm('确定要清空所有 Rewrite Rules 规则吗？')) {
    await rewriteRulesStore.clearAllRules()
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

.rewrite-rules-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 720px;
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

.rewrite-summary {
  flex-wrap: wrap;
}

.rewrite-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.rewrite-badge.url {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
}

.rewrite-badge.header {
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  color: var(--color-success);
  border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
}

.rewrite-badge.body {
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  color: var(--color-warning);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}

.rewrite-badge.status {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
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
  width: 600px;
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

/* 重写配置 */
.rewrite-config {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
}

.config-section {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.config-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.config-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  margin-bottom: 8px;
}

.config-toggle input {
  width: auto;
  margin: 0;
}

.config-content {
  padding-left: 24px;
}

.config-row {
  margin-bottom: 8px;
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
  width: 100%;
}

.radio-group {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.radio-group label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  margin-bottom: 0;
}

.radio-group input {
  width: auto;
  margin: 0;
}

.sub-section {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--color-border);
}

.sub-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.sub-label {
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
  font-weight: 500;
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
  width: 140px;
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
