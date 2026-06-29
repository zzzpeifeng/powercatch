/**
 * WebSocket Store 单元测试
 * 测试 Pinia store 的状态管理逻辑
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWebSocketStore } from '../websocket-store'
import type { WebSocketMessage, WebSocketConnection } from '../../../src/services/types'

// Mock the IPC module
vi.mock('../../../src/services/ipc', () => ({
  ipc: {
    websocket: {
      onMessageAdded: vi.fn(() => () => {}), // returns unsubscribe function
      onConnectionClosed: vi.fn(() => () => {}),
    },
  },
}))

describe('WebSocket Store', () => {
  let store: ReturnType<typeof useWebSocketStore>

  beforeEach(() => {
    // Create a fresh Pinia instance for each test
    setActivePinia(createPinia())
    store = useWebSocketStore()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始状态', () => {
    it('应该有正确的初始值', () => {
      expect(store.connections).toEqual([])
      expect(store.currentRequestId).toBeNull()
      expect(store.messages).toEqual([])
      expect(store.loaded).toBe(false)
      expect(store.filterDirection).toBe('all')
      expect(store.filterType).toBe('all')
      expect(store.searchQuery).toBe('')
    })
  })

  describe('loadConnection', () => {
    it('应该设置 currentRequestId', () => {
      store.loadConnection('test-req-001')

      expect(store.currentRequestId).toBe('test-req-001')
      expect(store.loaded).toBe(true)
    })

    it('应该清空消息列表（如果连接不存在）', () => {
      store.messages = [
        { id: 'msg-1', requestId: 'old-req', direction: 'client-to-server', type: 'text', content: 'old', size: 4, timestamp: new Date().toISOString(), frameIndex: 1 }
      ]

      store.loadConnection('new-req-001')

      expect(store.messages).toEqual([])
    })
  })

  describe('addMessage', () => {
    beforeEach(() => {
      store.loadConnection('test-req-001')
    })

    it('应该添加消息到列表', () => {
      const message: WebSocketMessage = {
        id: 'msg-001',
        requestId: 'test-req-001',
        direction: 'client-to-server',
        type: 'text',
        content: 'Hello',
        size: 5,
        timestamp: new Date().toISOString(),
        frameIndex: 1,
      }

      store.addMessage(message)

      expect(store.messages.length).toBe(1)
      expect(store.messages[0].id).toBe('msg-001')
      expect(store.messages[0].content).toBe('Hello')
    })

    it('应该更新连接统计（如果连接存在）', () => {
      // 先添加连接
      const connection: WebSocketConnection = {
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: new Date().toISOString(),
        messageCount: 0,
        clientToServerCount: 0,
        serverToClientCount: 0,
        totalBytes: 0,
      }
      store.updateConnection(connection)

      const message: WebSocketMessage = {
        id: 'msg-001',
        requestId: 'test-req-001',
        direction: 'client-to-server',
        type: 'text',
        content: 'Hello',
        size: 5,
        timestamp: new Date().toISOString(),
        frameIndex: 1,
      }

      store.addMessage(message)

      const conn = store.connections.find(c => c.requestId === 'test-req-001')
      expect(conn?.messageCount).toBe(1)
      expect(conn?.clientToServerCount).toBe(1)
      expect(conn?.totalBytes).toBe(5)
    })

    it('应该限制消息数量（最多 1000 条）', () => {
      // 添加 1001 条消息
      for (let i = 0; i < 1001; i++) {
        const message: WebSocketMessage = {
          id: `msg-${i}`,
          requestId: 'test-req-001',
          direction: 'client-to-server',
          type: 'text',
          content: `message-${i}`,
          size: 10,
          timestamp: new Date().toISOString(),
          frameIndex: i + 1,
        }
        store.addMessage(message)
      }

      expect(store.messages.length).toBe(1000)
      // 最旧的消息应该被移除
      expect(store.messages[0].id).toBe('msg-1')
      expect(store.messages[999].id).toBe('msg-1000')
    })
  })

  describe('updateConnection', () => {
    it('应该添加新连接', () => {
      const connection: WebSocketConnection = {
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: new Date().toISOString(),
        messageCount: 0,
        clientToServerCount: 0,
        serverToClientCount: 0,
        totalBytes: 0,
      }

      store.updateConnection(connection)

      expect(store.connections.length).toBe(1)
      expect(store.connections[0].requestId).toBe('test-req-001')
    })

    it('应该更新已存在的连接', () => {
      const connection: WebSocketConnection = {
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: new Date().toISOString(),
        messageCount: 0,
        clientToServerCount: 0,
        serverToClientCount: 0,
        totalBytes: 0,
      }

      store.updateConnection(connection)

      // 更新连接
      const updatedConnection = { ...connection, messageCount: 5, totalBytes: 1024 }
      store.updateConnection(updatedConnection)

      expect(store.connections.length).toBe(1) // 仍然是 1 条
      expect(store.connections[0].messageCount).toBe(5)
      expect(store.connections[0].totalBytes).toBe(1024)
    })
  })

  describe('closeConnection', () => {
    beforeEach(() => {
      const connection: WebSocketConnection = {
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: new Date().toISOString(),
        messageCount: 0,
        clientToServerCount: 0,
        serverToClientCount: 0,
        totalBytes: 0,
      }
      store.updateConnection(connection)
    })

    it('应该记录连接关闭时间', () => {
      store.closeConnection('test-req-001')

      const conn = store.connections.find(c => c.requestId === 'test-req-001')
      expect(conn?.closeTime).toBeDefined()
    })

    it('应该记录关闭原因', () => {
      store.closeConnection('test-req-001', 'Normal closure')

      const conn = store.connections.find(c => c.requestId === 'test-req-001')
      expect(conn?.closeReason).toBe('Normal closure')
    })

    it('应该处理不存在的连接', () => {
      // 不应该抛出错误
      expect(() => {
        store.closeConnection('non-existent-id')
      }).not.toThrow()
    })
  })

  describe('过滤功能', () => {
    beforeEach(() => {
      store.loadConnection('test-req-001')

      // 添加测试消息
      const messages: WebSocketMessage[] = [
        {
          id: 'msg-001',
          requestId: 'test-req-001',
          direction: 'client-to-server',
          type: 'text',
          content: 'Hello Server',
          size: 13,
          timestamp: new Date().toISOString(),
          frameIndex: 1,
        },
        {
          id: 'msg-002',
          requestId: 'test-req-001',
          direction: 'server-to-client',
          type: 'text',
          content: 'Hello Client',
          size: 13,
          timestamp: new Date().toISOString(),
          frameIndex: 2,
        },
        {
          id: 'msg-003',
          requestId: 'test-req-001',
          direction: 'client-to-server',
          type: 'binary',
          size: 64,
          timestamp: new Date().toISOString(),
          frameIndex: 3,
        },
      ]

      messages.forEach(msg => store.addMessage(msg))
    })

    describe('setFilterDirection', () => {
      it('应该按方向过滤（client-to-server）', () => {
        store.setFilterDirection('client-to-server')

        expect(store.filteredMessages.length).toBe(2)
        expect(store.filteredMessages[0].direction).toBe('client-to-server')
        expect(store.filteredMessages[1].direction).toBe('client-to-server')
      })

      it('应该按方向过滤（server-to-client）', () => {
        store.setFilterDirection('server-to-client')

        expect(store.filteredMessages.length).toBe(1)
        expect(store.filteredMessages[0].direction).toBe('server-to-client')
      })

      it('应该显示所有消息（all）', () => {
        store.setFilterDirection('client-to-server')
        store.setFilterDirection('all')

        expect(store.filteredMessages.length).toBe(3)
      })
    })

    describe('setFilterType', () => {
      it('应该按类型过滤（text）', () => {
        store.setFilterType('text')

        expect(store.filteredMessages.length).toBe(2)
        expect(store.filteredMessages[0].type).toBe('text')
        expect(store.filteredMessages[1].type).toBe('text')
      })

      it('应该按类型过滤（binary）', () => {
        store.setFilterType('binary')

        expect(store.filteredMessages.length).toBe(1)
        expect(store.filteredMessages[0].type).toBe('binary')
      })
    })

    describe('setSearchQuery', () => {
      it('应该搜索消息内容', () => {
        store.setSearchQuery('Server')

        expect(store.filteredMessages.length).toBe(1)
        expect(store.filteredMessages[0].content).toContain('Server')
      })

      it('应该不区分大小写', () => {
        store.setSearchQuery('server')

        expect(store.filteredMessages.length).toBe(1)
        expect(store.filteredMessages[0].content).toContain('Server')
      })

      it('应该返回所有消息（空查询）', () => {
        store.setSearchQuery('Server')
        store.setSearchQuery('')

        expect(store.filteredMessages.length).toBe(3)
      })
    })

    describe('clearFilters', () => {
      it('应该清空所有过滤条件', () => {
        store.setFilterDirection('client-to-server')
        store.setFilterType('text')
        store.setSearchQuery('test')

        store.clearFilters()

        expect(store.filterDirection).toBe('all')
        expect(store.filterType).toBe('all')
        expect(store.searchQuery).toBe('')
      })
    })
  })

  describe('computed getters', () => {
    beforeEach(() => {
      store.loadConnection('test-req-001')

      // 添加测试消息
      const messages: WebSocketMessage[] = [
        {
          id: 'msg-001',
          requestId: 'test-req-001',
          direction: 'client-to-server',
          type: 'text',
          content: 'Hello',
          size: 5,
          timestamp: new Date().toISOString(),
          frameIndex: 1,
        },
        {
          id: 'msg-002',
          requestId: 'test-req-001',
          direction: 'server-to-client',
          type: 'text',
          content: 'World',
          size: 5,
          timestamp: new Date().toISOString(),
          frameIndex: 2,
        },
        {
          id: 'msg-003',
          requestId: 'test-req-001',
          direction: 'client-to-server',
          type: 'binary',
          size: 100,
          timestamp: new Date().toISOString(),
          frameIndex: 3,
        },
      ]

      messages.forEach(msg => store.addMessage(msg))
    })

    it('应该正确计算 messageCount', () => {
      expect(store.messageCount).toBe(3)
    })

    it('应该正确计算 clientToServerCount', () => {
      expect(store.clientToServerCount).toBe(2)
    })

    it('应该正确计算 serverToClientCount', () => {
      expect(store.serverToClientCount).toBe(1)
    })

    it('应该正确计算 totalBytes', () => {
      expect(store.totalBytes).toBe(110) // 5 + 5 + 100
    })

    it('应该正确计算 connectionDuration（连接未关闭）', () => {
      const connection: WebSocketConnection = {
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        messageCount: 3,
        clientToServerCount: 2,
        serverToClientCount: 1,
        totalBytes: 110,
      }
      store.updateConnection(connection)

      const duration = store.connectionDuration
      expect(duration).toBeGreaterThan(4000) // 应该大约 5000ms
      expect(duration).toBeLessThan(6000)
    })

    it('应该正确计算 connectionDuration（连接已关闭）', () => {
      const startTime = new Date(Date.now() - 10000).toISOString() // 10 seconds ago
      const closeTime = new Date(Date.now() - 3000).toISOString() // 3 seconds ago

      const connection: WebSocketConnection = {
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: startTime,
        closeTime: closeTime,
        messageCount: 3,
        clientToServerCount: 2,
        serverToClientCount: 1,
        totalBytes: 110,
      }
      store.updateConnection(connection)

      const duration = store.connectionDuration
      expect(duration).toBe(7000) // 10000 - 3000 = 7000ms
    })
  })

  describe('selectConnection', () => {
    it('应该设置 currentRequestId', () => {
      store.selectConnection('test-req-001')

      expect(store.currentRequestId).toBe('test-req-001')
    })
  })

  describe('clearAll', () => {
    it('应该清空所有数据', () => {
      // 先添加一些数据
      store.updateConnection({
        requestId: 'test-req-001',
        url: 'wss://example.com',
        protocol: 'wss://',
        upgradeTime: new Date().toISOString(),
        messageCount: 1,
        clientToServerCount: 1,
        serverToClientCount: 0,
        totalBytes: 100,
      })
      store.addMessage({
        id: 'msg-001',
        requestId: 'test-req-001',
        direction: 'client-to-server',
        type: 'text',
        content: 'test',
        size: 4,
        timestamp: new Date().toISOString(),
        frameIndex: 1,
      })
      store.setFilterDirection('client-to-server')

      // 清空
      store.clearAll()

      expect(store.connections).toEqual([])
      expect(store.messages).toEqual([])
      expect(store.currentRequestId).toBeNull()
      expect(store.loaded).toBe(false)
      expect(store.filterDirection).toBe('all')
      expect(store.filterType).toBe('all')
      expect(store.searchQuery).toBe('')
    })
  })
})
