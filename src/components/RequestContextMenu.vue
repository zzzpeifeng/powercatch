<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu-overlay"
      @click="handleClose"
      @contextmenu.prevent="handleClose"
    >
      <div
        class="context-menu"
        :style="menuStyle"
        @click.stop
      >
        <!-- 添加断点 -->
        <div
          class="menu-item has-submenu"
          @mouseenter="showSubmenu = true"
          @mouseleave="showSubmenu = false"
        >
          <span class="menu-icon">🎯</span>
          <span class="menu-label">为此请求添加断点</span>
          <span class="menu-arrow">▶</span>

          <!-- 子菜单 -->
          <div
            v-if="showSubmenu"
            class="submenu"
            :style="submenuStyle"
          >
            <div class="menu-item" @click="handleAddBreakpoint('request')">
              <span class="menu-label">拦截请求</span>
            </div>
            <div class="menu-item" @click="handleAddBreakpoint('response')">
              <span class="menu-label">拦截响应</span>
            </div>
            <div class="menu-item" @click="handleAddBreakpoint('both')">
              <span class="menu-label">拦截请求和响应</span>
            </div>
          </div>
        </div>

        <div class="menu-divider"></div>

        <!-- AI 代码分析 -->
        <div class="menu-item" @click="handleAiAnalysis">
          <span class="menu-icon">🤖</span>
          <span class="menu-label">AI 代码分析</span>
        </div>

        <div class="menu-divider"></div>

        <!-- 重发请求 -->
        <div class="menu-item" @click="handleReplay">
          <span class="menu-icon">🔄</span>
          <span class="menu-label">重发请求</span>
        </div>

        <!-- 编辑后重发 -->
        <div class="menu-item" @click="handleEditAndReplay">
          <span class="menu-icon">✏️</span>
          <span class="menu-label">编辑后重发</span>
        </div>

        <div class="menu-divider"></div>

        <!-- 复制 URL -->
        <div class="menu-item" @click="handleCopyUrl">
          <span class="menu-icon">📋</span>
          <span class="menu-label">复制 URL</span>
        </div>

        <!-- 复制为 cURL -->
        <div class="menu-item" @click="handleCopyCurl">
          <span class="menu-icon">📋</span>
          <span class="menu-label">复制为 cURL</span>
        </div>

        <div class="menu-divider"></div>

        <!-- 导出为 -->
        <div
          class="menu-item has-submenu"
          @mouseenter="showExportSubmenu = true"
          @mouseleave="showExportSubmenu = false"
        >
          <span class="menu-icon">📤</span>
          <span class="menu-label">导出为</span>
          <span class="menu-arrow">▶</span>

          <!-- 导出子菜单 -->
          <div
            v-if="showExportSubmenu"
            class="submenu"
            :style="submenuStyle"
          >
            <div class="menu-item" @click="handleExportCurl">
              <span class="menu-label">cURL 命令</span>
            </div>
            <div class="menu-item" @click="handleExportPostman">
              <span class="menu-label">Postman Collection</span>
            </div>
            <div class="menu-item" @click="handleExportJmeter">
              <span class="menu-label">JMeter 脚本</span>
            </div>
            <div class="menu-item" @click="handleExportFetch">
              <span class="menu-label">fetch (JavaScript)</span>
            </div>
            <div class="menu-item" @click="handleExportPython">
              <span class="menu-label">Python requests</span>
            </div>
          </div>
        </div>

        <div class="menu-divider"></div>

        <!-- 删除此请求 -->
        <div class="menu-item danger" @click="handleDelete">
          <span class="menu-icon">🗑️</span>
          <span class="menu-label">删除此请求</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBreakpointStore } from '../stores/breakpoint-store'
import { useRequestStore } from '../stores/request-store'
import { useAiAnalysisStore } from '../stores/ai-analysis-store'
import { generateCurl } from '../utils/curl-generator'
import {
  exportPostmanCollection,
  exportJmeterScript,
  exportFetchCode,
  exportPythonRequests,
} from '../services/export-service'
import type { CaptureRequest } from '../services/types'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  request: CaptureRequest | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: string): void
  (e: 'replay', request: CaptureRequest): void
  (e: 'edit-and-replay', request: CaptureRequest): void
}>()

const breakpointStore = useBreakpointStore()
const requestStore = useRequestStore()
const router = useRouter()
const aiAnalysisStore = useAiAnalysisStore()

// 子菜单状态
const showSubmenu = ref(false)
const showExportSubmenu = ref(false)

// 菜单样式（处理边界检测）
const menuStyle = computed(() => {
  const menuWidth = 220
  const menuHeight = 300
  const padding = 10

  let x = props.x
  let y = props.y

  // 右溢出 → 左移
  if (x + menuWidth > window.innerWidth - padding) {
    x = window.innerWidth - menuWidth - padding
  }

  // 下溢出 → 上移
  if (y + menuHeight > window.innerHeight - padding) {
    y = window.innerHeight - menuHeight - padding
  }

  return {
    left: `${x}px`,
    top: `${y}px`,
  }
})

// 子菜单样式
const submenuStyle = computed(() => {
  return {
    left: '100%',
    top: '0',
  }
})

// 添加断点
async function handleAddBreakpoint(stage: 'request' | 'response' | 'both') {
  if (!props.request) return

  const result = await breakpointStore.addBreakpointFromRequest(props.request, stage)
  if (result.success) {
    emit('toast', '断点规则已添加', 'success')
  } else {
    emit('toast', result.errors.join(', '), 'error')
  }

  handleClose()
  }

  // AI 代码分析
  async function handleAiAnalysis() {
    if (!props.request) return
    // 通过 query 参数把请求信息传给 AiAnalysisView
    await router.push({
      path: '/ai-analysis',
      query: {
        method: props.request.method,
        url: props.request.url,
        path: props.request.url.replace(/^https?:\/\/[^/]+/, '') || '/',
        requestBody: props.request.requestBody || undefined,
        requestHeaders: props.request.requestHeaders ? JSON.stringify(props.request.requestHeaders) : undefined,
      },
    })
    handleClose()
  }

  // 重发请求
async function handleReplay() {
  if (!props.request) return
  emit('replay', props.request)
  handleClose()
}

// 编辑后重发
async function handleEditAndReplay() {
  if (!props.request) return
  emit('edit-and-replay', props.request)
  handleClose()
}

// 复制 URL
async function handleCopyUrl() {
  if (!props.request) return

  try {
    await navigator.clipboard.writeText(props.request.url)
    emit('toast', 'URL 已复制', 'success')
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = props.request.url
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    emit('toast', 'URL 已复制', 'success')
  }

  handleClose()
}

// 复制为 cURL
async function handleCopyCurl() {
  if (!props.request) return

  const curl = generateCurl(props.request)

  try {
    await navigator.clipboard.writeText(curl)
    emit('toast', 'cURL 命令已复制', 'success')
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = curl
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    emit('toast', 'cURL 命令已复制', 'success')
  }

  handleClose()
}

// 导出为 cURL 文件
async function handleExportCurl() {
  if (!props.request) return
  const curl = generateCurl(props.request)
  try {
    await navigator.clipboard.writeText(curl)
    emit('toast', 'cURL 命令已复制到剪贴板', 'success')
  } catch {
    emit('toast', '导出失败', 'error')
  }
  handleClose()
}

// 导出为 Postman Collection
function handleExportPostman() {
  if (!props.request) return
  exportPostmanCollection([props.request])
  emit('toast', 'Postman Collection 已下载', 'success')
  handleClose()
}

// 导出为 JMeter 脚本
function handleExportJmeter() {
  if (!props.request) return
  exportJmeterScript([props.request])
  emit('toast', 'JMeter 脚本已下载', 'success')
  handleClose()
}

// 导出为 fetch 代码
async function handleExportFetch() {
  if (!props.request) return
  const success = await exportFetchCode(props.request)
  if (success) {
    emit('toast', 'fetch 代码已复制到剪贴板', 'success')
  } else {
    emit('toast', '导出失败', 'error')
  }
  handleClose()
}

// 导出为 Python requests 代码
async function handleExportPython() {
  if (!props.request) return
  const success = await exportPythonRequests(props.request)
  if (success) {
    emit('toast', 'Python requests 代码已复制到剪贴板', 'success')
  } else {
    emit('toast', '导出失败', 'error')
  }
  handleClose()
}

// 删除请求
function handleDelete() {
  if (!props.request) return

  requestStore.removeRequest(props.request.id)
  emit('toast', '请求已删除', 'info')

  handleClose()
}

// 关闭菜单
function handleClose() {
  emit('close')
}

// ESC 键关闭
watch(() => props.visible, (val) => {
  if (val) {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
        document.removeEventListener('keydown', handleEsc)
      }
    }
    document.addEventListener('keydown', handleEsc)
  }
})
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9998;
}

.context-menu {
  position: fixed;
  background: var(--bg-primary, #1a1a1a);
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  padding: 4px;
  min-width: 200px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-primary, #fff);
  font-size: 13px;
  position: relative;
}

.menu-item:hover {
  background: var(--bg-secondary, #222);
}

.menu-item.danger {
  color: var(--danger-color, #ff4444);
}

.menu-item.danger:hover {
  background: var(--danger-bg, #3a1111);
}

.menu-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}

.menu-label {
  flex: 1;
}

.menu-arrow {
  font-size: 10px;
  color: var(--text-secondary, #888);
}

.menu-divider {
  height: 1px;
  background: var(--border-color, #333);
  margin: 4px 8px;
}

.has-submenu {
  position: relative;
}

.submenu {
  position: absolute;
  background: var(--bg-primary, #1a1a1a);
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
}

/* 暗色主题变量 */
:root {
  --bg-primary: #1a1a1a;
  --bg-secondary: #222;
  --border-color: #333;
  --text-primary: #fff;
  --text-secondary: #888;
  --danger-color: #ff4444;
  --danger-bg: #3a1111;
}
</style>
