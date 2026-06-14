<template>
  <div class="ssl-error-view">
    <div class="view-header">
      <h1 class="view-title">SSL 错误诊断</h1>
      <div class="header-actions">
        <button class="btn-secondary" @click="handleRefresh">刷新</button>
        <button class="btn-secondary" @click="handleExportReport">导出报告</button>
        <button class="btn-danger" @click="handleClear">清空</button>
      </div>
    </div>

    <div class="card p-4 mb-4">
      <h2 class="text-lg font-semibold mb-3">错误摘要</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="stat-card"><div class="stat-value">{{ summary.totalErrors }}</div><div class="stat-label">总错误</div></div>
        <div class="stat-card"><div class="stat-value">{{ summary.uniqueDomains }}</div><div class="stat-label">涉及域名</div></div>
        <div class="stat-card"><div class="stat-value text-yellow-600">{{ summary.pinnedDomainErrors }}</div><div class="stat-label">证书固定(可忽略)</div></div>
        <div class="stat-card"><div class="stat-value text-red-600">{{ summary.totalErrors - summary.pinnedDomainErrors }}</div><div class="stat-label">待处理</div></div>
      </div>
    </div>

    <div class="card p-4 mb-4" v-if="Object.keys(summary.errorsByType).length > 0">
      <h2 class="text-lg font-semibold mb-3">错误类型</h2>
      <div v-for="(count, type) in summary.errorsByType" :key="type" class="flex items-center gap-3 mb-2">
        <span class="w-32 text-xs">{{ formatType(type) }}</span>
        <div class="flex-1 bg-gray-200 rounded h-2 overflow-hidden">
          <div class="h-full bg-blue-500 rounded" :style="{ width: getBarWidth(Number(count)) + '%' }"></div>
        </div>
        <span class="w-16 text-xs text-right">{{ count }}次</span>
      </div>
    </div>

    <div class="card p-4" v-if="summary.topErrorDomains.length > 0">
      <h2 class="text-lg font-semibold mb-3">错误最多域名</h2>
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th class="text-left py-1">域名</th><th class="text-left py-1">次数</th><th class="text-left py-1">说明</th></tr></thead>
        <tbody>
          <tr v-for="(item, idx) in summary.topErrorDomains" :key="idx" class="border-b">
            <td class="py-1 font-mono text-xs">{{ item.domain }}</td>
            <td class="py-1">{{ item.count }}</td>
            <td class="py-1 text-xs text-gray-500">{{ isPinned(item.domain) ? '证书固定' : '需检查' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="card p-8 text-center text-gray-400">暂无SSL错误记录</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ipc } from '../services/ipc'

const summary = ref({
  totalErrors: 0,
  uniqueDomains: 0,
  topErrorDomains: [] as Array<{ domain: string; count: number }>,
  errorsByType: {} as Record<string, number>,
  pinnedDomainErrors: 0,
})

let timer: number | null = null

onMounted(() => {
  loadData()
  timer = window.setInterval(() => loadData(), 10000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function loadData() {
  try {
    const res = await ipc.ssl.getStats()
    summary.value = res
  } catch (e: any) { console.error(e) }
}

function handleRefresh() { loadData() }

async function handleExportReport() {
  try {
    const text = await ipc.ssl.getReport()
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ssl-${Date.now()}.txt`; a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) { console.error(e) }
}

async function handleClear() {
  if (!confirm('确定清空？')) return
  await ipc.ssl.clear()
  loadData()
}

function formatType(t: string): string {
  const m: Record<string, string> = {
    CERTIFICATE_PINNING: '证书固定',
    CERTIFICATE_UNTRUSTED: '证书不受信任',
    CONNECTION_RESET: '连接重置',
  }
  return m[t] || t
}

function isPinned(domain: string): boolean {
  return ['google.com','apple.com','facebook.com','twitter.com','amazon.com'].some(p => domain.endsWith(p))
}

function getBarWidth(count: number): number {
  const vals = Object.values(summary.value.errorsByType) as number[]
  const max = Math.max(...vals, 0)
  return max === 0 ? 0 : (count / max) * 100
}
</script>
