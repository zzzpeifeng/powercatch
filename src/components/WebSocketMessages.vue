<template>
  <div class="flex flex-col h-full bg-[var(--color-bg)] text-[var(--color-text)]">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 p-3 border-b border-[var(--color-border)]">
      <div class="flex items-center gap-2 flex-1">
        <!-- 方向过滤 -->
        <select
          :value="webSocketStore.filterDirection"
          @change="webSocketStore.setFilterDirection($event.target.value as any)"
          class="px-2 py-1 text-sm border border-[var(--color-border)] rounded bg-[var(--color-surface)]"
        >
          <option value="all">所有方向</option>
          <option value="client-to-server">↑ 客户端→服务器</option>
          <option value="server-to-client">↓ 服务器→客户端</option>
        </select>

        <!-- 类型过滤 -->
        <select
          :value="webSocketStore.filterType"
          @change="webSocketStore.setFilterType($event.target.value as any)"
          class="px-2 py-1 text-sm border border-[var(--color-border)] rounded bg-[var(--color-surface)]"
        >
          <option value="all">所有类型</option>
          <option value="text">文本</option>
          <option value="binary">二进制</option>
          <option value="ping">Ping</option>
          <option value="pong">Pong</option>
          <option value="close">关闭</option>
        </select>

        <!-- 搜索 -->
        <input
          v-model="webSocketStore.searchQuery"
          @input="webSocketStore.setSearchQuery(($event.target as HTMLInputElement).value)"
          type="text"
          placeholder="搜索消息内容..."
          class="flex-1 px-3 py-1 text-sm border border-[var(--color-border)] rounded bg-[var(--color-surface)]"
        />

        <!-- 清空过滤 -->
        <button
          v-if="hasActiveFilters"
          @click="webSocketStore.clearFilters()"
          class="px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
        >
          清空过滤
        </button>
      </div>
    </div>

    <!-- 统计信息 -->
    <div class="flex items-center gap-4 px-3 py-2 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
      <span>消息总数: {{ webSocketStore.messageCount }}</span>
      <span>↑ 客户端: {{ webSocketStore.clientToServerCount }}</span>
      <span>↓ 服务器: {{ webSocketStore.serverToClientCount }}</span>
      <span>总字节: {{ formatBytes(webSocketStore.totalBytes) }}</span>
      <span v-if="webSocketStore.currentConnection">
        时长: {{ formatDuration(webSocketStore.connectionDuration) }}
      </span>
    </div>

    <!-- 消息列表 -->
    <div class="flex-1 overflow-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
          <tr>
            <th class="px-3 py-2 text-left font-medium">#</th>
            <th class="px-3 py-2 text-left font-medium">方向</th>
            <th class="px-3 py-2 text-left font-medium">类型</th>
            <th class="px-3 py-2 text-left font-medium">大小</th>
            <th class="px-3 py-2 text-left font-medium">时间</th>
            <th class="px-3 py-2 text-left font-medium">内容预览</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="msg in webSocketStore.filteredMessages"
            :key="msg.id"
            @click="selectedMessage = msg"
            class="border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] cursor-pointer"
            :class="{ 'bg-[var(--color-primary)]/10': selectedMessage?.id === msg.id }"
          >
            <td class="px-3 py-2 text-[var(--color-text-secondary)]">{{ msg.frameIndex }}</td>
            <td class="px-3 py-2">
              <span
                :class="msg.direction === 'client-to-server' ? 'text-blue-500' : 'text-green-500'"
              >
                {{ msg.direction === 'client-to-server' ? '↑' : '↓' }}
                {{ msg.direction === 'client-to-server' ? 'C→S' : 'S→C' }}
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                class="px-2 py-0.5 rounded text-xs"
                :class="getTypeClass(msg.type)"
              >
                {{ msg.type }}
              </span>
            </td>
            <td class="px-3 py-2 text-[var(--color-text-secondary)]">{{ formatBytes(msg.size) }}</td>
            <td class="px-3 py-2 text-[var(--color-text-secondary)]">{{ formatTime(msg.timestamp) }}</td>
            <td class="px-3 py-2 text-[var(--color-text-secondary)] truncate max-w-xs">
              {{ getContentPreview(msg) }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 空状态 -->
      <div
        v-if="webSocketStore.filteredMessages.length === 0"
        class="flex items-center justify-center h-32 text-[var(--color-text-secondary)]"
      >
        {{ webSocketStore.messageCount === 0 ? '暂无 WebSocket 消息' : '没有匹配的消息' }}
      </div>
    </div>

    <!-- 消息详情 -->
    <div v-if="selectedMessage" class="border-t border-[var(--color-border)]" style="height: 40%;">
      <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <span class="text-sm font-medium">消息详情 #{{ selectedMessage.frameIndex }}</span>
        <button
          @click="selectedMessage = null"
          class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
        >
          ✕
        </button>
      </div>
      <div class="overflow-auto h-full">
        <!-- 文本消息 -->
        <pre
          v-if="selectedMessage.type === 'text' && selectedMessage.content"
          class="p-3 text-sm font-mono whitespace-pre-wrap"
        >{{ selectedMessage.content }}</pre>

        <!-- 二进制消息 - Hex 查看器 -->
        <div
          v-else-if="selectedMessage.type === 'binary' && selectedMessage.binaryContent"
          class="h-full"
        >
          <HexViewer :data="selectedMessage.binaryContent" />
        </div>

        <!-- 其他类型 -->
        <div v-else class="p-3 text-sm text-[var(--color-text-secondary)]">
          无法显示此消息类型 ({{ selectedMessage.type }})
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useWebSocketStore } from '../stores/websocket-store'
import type { WebSocketMessage } from '../services/types'
import HexViewer from './HexViewer.vue'

const props = defineProps<{
  requestId: string
}>()

const webSocketStore = useWebSocketStore()
const selectedMessage = ref<WebSocketMessage | null>(null)

// 监听 requestId 变化，加载对应的 WebSocket 连接
watch(() => props.requestId, (newId) => {
  if (newId) {
    webSocketStore.loadConnection(newId)
  }
}, { immediate: true })

const hasActiveFilters = computed(() => {
  return (
    webSocketStore.filterDirection !== 'all' ||
    webSocketStore.filterType !== 'all' ||
    webSocketStore.searchQuery !== ''
  )
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  return Math.floor(ms / 60000) + 'min'
}

function getTypeClass(type: string): string {
  switch (type) {
    case 'text': return 'bg-blue-100 text-blue-800'
    case 'binary': return 'bg-purple-100 text-purple-800'
    case 'ping': return 'bg-yellow-100 text-yellow-800'
    case 'pong': return 'bg-green-100 text-green-800'
    case 'close': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function getContentPreview(msg: WebSocketMessage): string {
  if (msg.type === 'text' && msg.content) {
    return msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '')
  }
  if (msg.type === 'binary') {
    return `[二进制 ${formatBytes(msg.size)}]`
  }
  return `[${msg.type}]`
}
</script>
