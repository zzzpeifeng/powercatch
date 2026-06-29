/**
 * WebSocket 消息状态管理
 * 管理 WebSocket 连接和消息的显示
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WebSocketMessage, WebSocketConnection, WebSocketMessageDirection, WebSocketMessageType } from '../services/types'
import { ipc } from '../services/ipc'

/** 内存中最多保存的消息数 */
const MESSAGE_LIMIT = 1000

export const useWebSocketStore = defineStore('websocket', () => {
  // ===== State =====

  /** 连接列表 */
  const connections = ref<WebSocketConnection[]>([])

  /** 当前选中的请求 ID */
  const currentRequestId = ref<string | null>(null)

  /** 当前连接的消息列表 */
  const messages = ref<WebSocketMessage[]>([])

  /** 是否已加载 */
  const loaded = ref<boolean>(false)

  // 过滤状态
  const filterDirection = ref<'all' | WebSocketMessageDirection>('all')
  const filterType = ref<'all' | WebSocketMessageType>('all')
  const searchQuery = ref<string>('')

  // ===== Getters =====

  /** 当前连接信息 */
  const currentConnection = computed(() => {
    if (!currentRequestId.value) return null
    return connections.value.find(c => c.requestId === currentRequestId.value) || null
  })

  /** 消息总数 */
  const messageCount = computed(() => messages.value.length)

  /** 过滤后的消息列表（计算属性实现） */
  const filteredMessages = computed(() => {
    let result = messages.value

    // 按方向过滤
    if (filterDirection.value !== 'all') {
      result = result.filter(m => m.direction === filterDirection.value)
    }

    // 按类型过滤
    if (filterType.value !== 'all') {
      result = result.filter(m => m.type === filterType.value)
    }

    // 搜索消息内容
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(m => {
        if (m.content) {
          return m.content.toLowerCase().includes(query)
        }
        return false
      })
    }

    return result
  })

  /** 客户端→服务器消息数 */
  const clientToServerCount = computed(() => {
    return messages.value.filter(m => m.direction === 'client-to-server').length
  })

  /** 服务器→客户端消息数 */
  const serverToClientCount = computed(() => {
    return messages.value.filter(m => m.direction === 'server-to-client').length
  })

  /** 总字节数 */
  const totalBytes = computed(() => {
    return messages.value.reduce((sum, m) => sum + m.size, 0)
  })

  /** 连接时长（毫秒） */
  const connectionDuration = computed(() => {
    const conn = currentConnection.value
    if (!conn) return 0
    const start = new Date(conn.upgradeTime).getTime()
    const end = conn.closeTime ? new Date(conn.closeTime).getTime() : Date.now()
    return end - start
  })

  // ===== Actions =====

  /**
   * 加载指定请求的连接和消息
   * @param requestId 请求 ID
   */
  function loadConnection(requestId: string): void {
    currentRequestId.value = requestId
    
    // 从内存中加载消息（或从 session 恢复）
    const conn = connections.value.find(c => c.requestId === requestId)
    
    if (conn) {
      // 这里可以从主进程请求消息列表
      // 暂时使用空数组，等待主进程推送
      messages.value = []
    } else {
      messages.value = []
    }
    
    loaded.value = true
  }

  /**
   * 添加消息
   * @param message WebSocket 消息
   */
  function addMessage(message: WebSocketMessage): void {
    messages.value.push(message)

    // 限制内存中的消息数量
    if (messages.value.length > MESSAGE_LIMIT) {
      messages.value.shift() // 移除最旧的消息
    }

    // 更新连接信息
    const connIdx = connections.value.findIndex(c => c.requestId === message.requestId)
    if (connIdx >= 0) {
      const conn = connections.value[connIdx]
      conn.messageCount++
      conn.totalBytes += message.size
      if (message.direction === 'client-to-server') {
        conn.clientToServerCount++
      } else {
        conn.serverToClientCount++
      }
    }
  }

  /**
   * 更新连接信息
   * @param connection WebSocket 连接信息
   */
  function updateConnection(connection: WebSocketConnection): void {
    const idx = connections.value.findIndex(c => c.requestId === connection.requestId)
    if (idx >= 0) {
      connections.value[idx] = connection
    } else {
      connections.value.push(connection)
    }
  }

  /**
   * 连接关闭
   * @param requestId 请求 ID
   * @param reason 关闭原因
   */
  function closeConnection(requestId: string, reason?: string): void {
    const conn = connections.value.find(c => c.requestId === requestId)
    if (conn) {
      conn.closeTime = new Date().toISOString()
      conn.closeReason = reason || undefined
    }
  }

  /**
   * 设置方向过滤
   * @param direction 方向或 'all'
   */
  function setFilterDirection(direction: 'all' | WebSocketMessageDirection): void {
    filterDirection.value = direction
  }

  /**
   * 设置类型过滤
   * @param type 类型或 'all'
   */
  function setFilterType(type: 'all' | WebSocketMessageType): void {
    filterType.value = type
  }

  /**
   * 设置搜索关键词
   * @param query 搜索关键词
   */
  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  /**
   * 清空所有过滤条件
   */
  function clearFilters(): void {
    filterDirection.value = 'all'
    filterType.value = 'all'
    searchQuery.value = ''
  }

  /**
   * 选中连接
   * @param requestId 请求 ID
   */
  function selectConnection(requestId: string): void {
    currentRequestId.value = requestId
  }

  /**
   * 清空所有数据
   */
  function clearAll(): void {
    connections.value = []
    messages.value = []
    currentRequestId.value = null
    loaded.value = false
    clearFilters()
  }

  // ===== 订阅主进程事件 =====

  let unsubMessageAdded: (() => void) | null = null
  let unsubConnectionClosed: (() => void) | null = null

  if (typeof window !== 'undefined') {
    // 订阅 WebSocket 消息推送
    unsubMessageAdded = ipc.websocket.onMessageAdded((message: WebSocketMessage) => {
      addMessage(message)
    })

    // 订阅 WebSocket 连接关闭事件
    unsubConnectionClosed = ipc.websocket.onConnectionClosed((data: { requestId: string; reason?: string }) => {
      closeConnection(data.requestId, data.reason)
    })
  }

  return {
    // State
    connections,
    currentRequestId,
    messages,
    loaded,
    filterDirection,
    filterType,
    searchQuery,

    // Getters
    currentConnection,
    messageCount,
    filteredMessages,
    clientToServerCount,
    serverToClientCount,
    totalBytes,
    connectionDuration,

    // Actions
    loadConnection,
    addMessage,
    updateConnection,
    closeConnection,
    setFilterDirection,
    setFilterType,
    setSearchQuery,
    clearFilters,
    selectConnection,
    clearAll,

    // 清理订阅（组件卸载时调用）
    destroy: () => {
      if (unsubMessageAdded) unsubMessageAdded()
      if (unsubConnectionClosed) unsubConnectionClosed()
    },
  }
})
