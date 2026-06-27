<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="cookie-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <h3 class="panel-title">Cookie 管理器</h3>
        <div class="header-actions">
          <button class="btn-icon" @click="handleAddCookie" title="添加 Cookie">+</button>
          <button class="btn-icon" @click="handleImportJar" title="导入 Cookie Jar">导入</button>
          <button class="btn-icon" @click="handleExportJar" title="导出 Cookie Jar">导出</button>
          <button class="btn-icon" @click="handleClose" title="关闭">&times;</button>
        </div>
      </div>

      <!-- 主体内容 -->
      <div class="panel-body">
        <!-- 左侧域名列表 -->
        <div class="domain-sidebar">
          <div class="sidebar-header">
            <span class="sidebar-title">域名</span>
            <button class="btn-text danger" @click="handleClearAll" title="清空所有 Cookie">清空</button>
          </div>
          <div class="domain-list">
            <div
              v-if="allDomains.length === 0"
              class="empty-domain"
            >
              暂无 Cookie
            </div>
            <div
              v-for="domain in allDomains"
              :key="domain"
              :class="['domain-item', { active: selectedDomain === domain }]"
              @click="handleSelectDomain(domain)"
            >
              <span class="domain-name">{{ domain }}</span>
              <span class="domain-count">{{ getDomainCookieCount(domain) }}</span>
              <button
                class="btn-icon small domain-delete"
                @click.stop="handleClearDomain(domain)"
                title="清空域名 Cookie"
              >&times;</button>
            </div>
          </div>
        </div>

        <!-- 右侧 Cookie 列表 -->
        <div class="cookie-content">
          <div class="content-header">
            <span class="content-title">
              {{ selectedDomain || '全部 Cookie' }}
              <span class="cookie-total">({{ displayCookies.length }})</span>
            </span>
          </div>

          <div class="cookie-list">
            <div v-if="displayCookies.length === 0" class="empty-state">
              <p>{{ selectedDomain ? '该域名下暂无 Cookie' : '暂无 Cookie' }}</p>
              <p class="hint">点击右上角 + 添加 Cookie，或通过代理抓取自动收集</p>
            </div>

            <div
              v-for="cookie in displayCookies"
              :key="`${cookie.domain}:${cookie.path}:${cookie.name}`"
              class="cookie-item"
            >
              <div class="cookie-header">
                <span class="cookie-name">{{ cookie.name }}</span>
                <span class="cookie-domain-tag">{{ cookie.domain }}</span>
                <div class="cookie-actions">
                  <button class="btn-icon small" @click="handleEditCookie(cookie)" title="编辑">编辑</button>
                  <button class="btn-icon small" @click="handleDeleteCookie(cookie)" title="删除">删除</button>
                </div>
              </div>
              <div class="cookie-details">
                <div class="detail-row">
                  <span class="detail-label">值：</span>
                  <span class="detail-value">{{ cookie.value }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">路径：</span>
                  <span class="detail-value">{{ cookie.path }}</span>
                </div>
                <div v-if="cookie.expires" class="detail-row">
                  <span class="detail-label">过期：</span>
                  <span class="detail-value">{{ formatDate(cookie.expires) }}</span>
                </div>
                <div class="cookie-flags">
                  <span v-if="cookie.httpOnly" class="flag">HttpOnly</span>
                  <span v-if="cookie.secure" class="flag">Secure</span>
                  <span v-if="cookie.sameSite" class="flag">SameSite={{ cookie.sameSite }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 添加/编辑 Cookie 弹窗 -->
      <div v-if="showForm" class="cookie-form-overlay" @click.self="showForm = false">
        <div class="cookie-form">
          <h4>{{ editingCookie ? '编辑 Cookie' : '添加 Cookie' }}</h4>

          <div class="form-group">
            <label>名称</label>
            <input v-model="formData.name" placeholder="Cookie 名称" :disabled="!!editingCookie" />
          </div>

          <div class="form-group">
            <label>值</label>
            <input v-model="formData.value" placeholder="Cookie 值" />
          </div>

          <div class="form-group">
            <label>域名</label>
            <input v-model="formData.domain" placeholder="example.com" :disabled="!!editingCookie" />
          </div>

          <div class="form-group">
            <label>路径</label>
            <input v-model="formData.path" placeholder="/" :disabled="!!editingCookie" />
          </div>

          <div class="form-group">
            <label>过期时间（可选）</label>
            <input v-model="formData.expires" type="datetime-local" />
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="formData.httpOnly" />
              HttpOnly
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="formData.secure" />
              Secure
            </label>
          </div>

          <div class="form-group">
            <label>SameSite</label>
            <select v-model="formData.sameSite">
              <option value="">未设置</option>
              <option value="Strict">Strict</option>
              <option value="Lax">Lax</option>
              <option value="None">None</option>
            </select>
          </div>

          <div v-if="formErrors.length > 0" class="form-errors">
            <p v-for="(err, i) in formErrors" :key="i">{{ err }}</p>
          </div>

          <div class="form-actions">
            <button class="btn btn-secondary" @click="showForm = false">取消</button>
            <button class="btn btn-primary" @click="handleSaveCookie">
              {{ editingCookie ? '保存' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useCookieStore } from '../stores/cookie-store'
import { ipc } from '../services/ipc'
import type { Cookie, CookieJar } from '../services/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const cookieStore = useCookieStore()

// 域名列表
const allDomains = computed(() => cookieStore.domains)
const selectedDomain = computed(() => cookieStore.selectedDomain)

// 显示的 Cookie 列表
const displayCookies = computed(() => cookieStore.filteredCookies)

// 表单状态
const showForm = ref(false)
const editingCookie = ref<Cookie | null>(null)
const formErrors = ref<string[]>([])
const formData = ref({
  name: '',
  value: '',
  domain: '',
  path: '/',
  expires: '',
  httpOnly: false,
  secure: false,
  sameSite: '' as '' | 'Strict' | 'Lax' | 'None',
})

// 初始化加载
onMounted(async () => {
  if (!cookieStore.loaded) {
    await cookieStore.loadCookies()
  }
})

// 获取域名 Cookie 数量
function getDomainCookieCount(domain: string): number {
  return cookieStore.cookies.filter(c => c.domain === domain).length
}

// 格式化日期
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleString('zh-CN')
  } catch {
    return dateStr
  }
}

// 选择域名
function handleSelectDomain(domain: string) {
  cookieStore.selectDomain(selectedDomain.value === domain ? null : domain)
}

// 添加 Cookie
function handleAddCookie() {
  editingCookie.value = null
  formData.value = {
    name: '',
    value: '',
    domain: selectedDomain.value || '',
    path: '/',
    expires: '',
    httpOnly: false,
    secure: false,
    sameSite: '',
  }
  formErrors.value = []
  showForm.value = true
}

// 编辑 Cookie
function handleEditCookie(cookie: Cookie) {
  editingCookie.value = cookie
  // 将 ISO 日期转换为 datetime-local 格式
  let expiresLocal = ''
  if (cookie.expires) {
    try {
      const d = new Date(cookie.expires)
      if (!isNaN(d.getTime())) {
        expiresLocal = d.toISOString().slice(0, 16)
      }
    } catch { /* ignore */ }
  }
  formData.value = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: expiresLocal,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite || '',
  }
  formErrors.value = []
  showForm.value = true
}

// 保存 Cookie
async function handleSaveCookie() {
  formErrors.value = []

  // 验证
  if (!formData.value.name.trim()) {
    formErrors.value.push('Cookie 名称不能为空')
    return
  }
  if (!formData.value.domain.trim()) {
    formErrors.value.push('域名不能为空')
    return
  }

  const cookie: Cookie = {
    name: formData.value.name.trim(),
    value: formData.value.value,
    domain: formData.value.domain.trim(),
    path: formData.value.path || '/',
    expires: formData.value.expires ? new Date(formData.value.expires).toISOString() : undefined,
    httpOnly: formData.value.httpOnly,
    secure: formData.value.secure,
    sameSite: formData.value.sameSite || undefined,
    createdAt: editingCookie.value?.createdAt || new Date().toISOString(),
  }

  if (editingCookie.value) {
    // 更新
    await cookieStore.updateCookie(
      editingCookie.value.domain,
      editingCookie.value.path,
      editingCookie.value.name,
      cookie
    )
  } else {
    // 添加
    await cookieStore.addCookie(cookie)
  }

  showForm.value = false
}

// 删除 Cookie
async function handleDeleteCookie(cookie: Cookie) {
  if (confirm(`确定要删除 Cookie "${cookie.name}" 吗？`)) {
    await cookieStore.deleteCookie(cookie.domain, cookie.path, cookie.name)
  }
}

// 清空域名 Cookie
async function handleClearDomain(domain: string) {
  if (confirm(`确定要清空域名 "${domain}" 下的所有 Cookie 吗？`)) {
    await cookieStore.clearDomain(domain)
  }
}

// 清空所有 Cookie
async function handleClearAll() {
  if (confirm('确定要清空所有 Cookie 吗？此操作不可撤销。')) {
    await cookieStore.clearAll()
  }
}

// 导入 Cookie Jar
async function handleImportJar() {
  try {
    // 创建文件输入元素
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      const text = await file.text()
      const jar: CookieJar = JSON.parse(text)
      
      if (!jar.cookies || !Array.isArray(jar.cookies)) {
        alert('无效的 Cookie Jar 文件格式')
        return
      }
      
      await cookieStore.importJar(jar)
      alert(`成功导入 ${jar.cookies.length} 个 Cookie`)
    }
    
    input.click()
  } catch (error: any) {
    alert(`导入失败: ${error.message}`)
  }
}

// 导出 Cookie Jar
function handleExportJar() {
  try {
    const jar = cookieStore.exportJar()
    const json = JSON.stringify(jar, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cookies-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error: any) {
    alert(`导出失败: ${error.message}`)
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

.cookie-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 900px;
  max-height: 75vh;
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
  font-size: 14px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 4px;
  transition: all 0.15s;
}

.btn-icon:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.btn-icon.small {
  font-size: 12px;
  padding: 2px 6px;
}

.panel-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧域名列表 */
.domain-sidebar {
  width: 220px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.btn-text {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 12px;
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

.domain-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.empty-domain {
  text-align: center;
  padding: 20px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.domain-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 2px;
}

.domain-item:hover {
  background: var(--color-bg);
}

.domain-item.active {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
}

.domain-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.domain-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  padding: 1px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.domain-delete {
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.domain-item:hover .domain-delete {
  opacity: 1;
}

/* 右侧 Cookie 列表 */
.cookie-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.content-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.cookie-total {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: normal;
}

.cookie-list {
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

.cookie-item {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
}

.cookie-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.cookie-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  font-family: monospace;
}

.cookie-domain-tag {
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.cookie-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.cookie-item:hover .cookie-actions {
  opacity: 1;
}

.cookie-details {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.detail-row {
  display: flex;
  margin-bottom: 4px;
}

.detail-label {
  min-width: 40px;
  flex-shrink: 0;
}

.detail-value {
  font-family: monospace;
  color: var(--color-primary);
  word-break: break-all;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cookie-flags {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.flag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  color: var(--color-warning);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}

/* 表单弹窗 */
.cookie-form-overlay {
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

.cookie-form {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
}

.cookie-form h4 {
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
  box-sizing: border-box;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.checkbox-group {
  display: flex;
  gap: 24px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}

.checkbox-label input {
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
