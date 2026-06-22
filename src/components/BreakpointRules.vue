<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="breakpoint-rules-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h3 class="panel-title">断点规则</h3>
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
        <p>暂无断点规则</p>
        <p class="hint">点击右上角 + 添加规则，或在请求列表中右键快速添加</p>
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
          <span class="rule-stage">{{ stageLabel(rule.stage) }}</span>
        </div>

        <div class="rule-details">
          <div class="detail-row">
            <span class="detail-label">URL：</span>
            <span class="detail-value">{{ rule.match.urlPattern }}</span>
          </div>
          <div class="detail-row" v-if="rule.match.methods.length > 0">
            <span class="detail-label">方法：</span>
            <span class="detail-value">{{ rule.match.methods.join(', ') }}</span>
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
        <h4>{{ editingRule ? '编辑规则' : '添加规则' }}</h4>

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
          <label>HTTP 方法</label>
          <div class="methods-grid">
            <label v-for="m in methods" :key="m" class="method-checkbox">
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
          <label>拦截阶段</label>
          <select v-model="formData.stage">
            <option value="request">仅请求</option>
            <option value="response">仅响应</option>
            <option value="both">请求和响应</option>
          </select>
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
import { useBreakpointStore } from '../stores/breakpoint-store'
import type { BreakpointRule, HttpMethod } from '../services/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const breakpointStore = useBreakpointStore()

// 规则列表
const rules = computed(() => breakpointStore.rules)

// HTTP 方法列表
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

// 表单状态
const showForm = ref(false)
const editingRule = ref<BreakpointRule | null>(null)
const formErrors = ref<string[]>([])
const formData = ref({
  name: '',
  urlPattern: '',
  methods: [] as HttpMethod[],
  stage: 'request' as 'request' | 'response' | 'both',
})

// 阶段标签
function stageLabel(stage: string): string {
  switch (stage) {
    case 'request': return '请求'
    case 'response': return '响应'
    case 'both': return '双向'
    default: return stage
  }
}

// 添加规则
function handleAddRule() {
  editingRule.value = null
  formData.value = {
    name: '',
    urlPattern: '',
    methods: [],
    stage: 'request',
  }
  formErrors.value = []
  showForm.value = true
}

// 编辑规则
function handleEdit(rule: BreakpointRule) {
  editingRule.value = rule
  formData.value = {
    name: rule.name,
    urlPattern: rule.match.urlPattern,
    methods: [...rule.match.methods],
    stage: rule.stage,
  }
  formErrors.value = []
  showForm.value = true
}

// 保存规则
async function handleSaveRule() {
  formErrors.value = []

  if (editingRule.value) {
    // 更新
    const result = await breakpointStore.updateRule(editingRule.value.id, {
      name: formData.value.name,
      match: {
        urlPattern: formData.value.urlPattern,
        methods: formData.value.methods,
      },
      stage: formData.value.stage,
    })
    if (!result.success) {
      formErrors.value = result.errors
      return
    }
  } else {
    // 添加
    const result = await breakpointStore.addRule({
      name: formData.value.name,
      enabled: true,
      match: {
        urlPattern: formData.value.urlPattern,
        methods: formData.value.methods,
      },
      stage: formData.value.stage,
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
    await breakpointStore.removeRule(ruleId)
  }
}

// 切换启用状态
async function handleToggle(ruleId: string) {
  await breakpointStore.toggleRule(ruleId)
}

// 全部启用
async function handleEnableAll() {
  await breakpointStore.enableAllRules()
}

// 全部禁用
async function handleDisableAll() {
  await breakpointStore.disableAllRules()
}

// 清空
async function handleClearAll() {
  if (confirm('确定要清空所有规则吗？')) {
    await breakpointStore.clearAllRules()
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

.breakpoint-rules-panel {
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

.rule-stage {
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
  min-width: 50px;
}

.detail-value {
  font-family: monospace;
  color: var(--color-primary);
  word-break: break-all;
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
  width: 480px;
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
  gap: 4px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}

.method-checkbox input {
  width: auto;
  margin: 0;
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
