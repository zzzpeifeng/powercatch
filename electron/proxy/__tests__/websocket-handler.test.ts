/**
 * WebSocket 消息处理器单元测试
 * 测试 WebSocketTracker 类的所有功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { wsTracker } from '../websocket-handler'
import type { WebSocketMessage } from '../../../src/services/types'

// Mock uuid module
vi.mock('uuid', () => ({
  v4: () => `mock-uuid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
}))

describe('WebSocketTracker', () => {
  const requestId = 'test-req-001'
  const wsUrl = 'wss://example.com/socket'

  beforeEach(() => {
    // 每个测试前清理数据
    wsTracker.cleanup(requestId)
  })

  describe('onUpgrade', () => {
    it('应该正确记录 WebSocket 升级', () => {
      wsTracker.onUpgrade(requestId, wsUrl)

      const connection = wsTracker.getConnection(requestId)
      expect(connection).toBeDefined()
      expect(connection?.requestId).toBe(requestId)
      expect(connection?.url).toBe(wsUrl)
      expect(connection?.protocol).toBe('wss://')
      expect(connection?.messageCount).toBe(0)
      expect(connection?.clientToServerCount).toBe(0)
      expect(connection?.serverToClientCount).toBe(0)
      expect(connection?.totalBytes).toBe(0)
      expect(connection?.upgradeTime).toBeDefined()
    })

    it('应该正确识别 ws:// 协议', () => {
      wsTracker.onUpgrade(requestId, 'ws://example.com/socket')

      const connection = wsTracker.getConnection(requestId)
      expect(connection?.protocol).toBe('ws://')
    })
  })

  describe('onMessage', () => {
    beforeEach(() => {
      wsTracker.onUpgrade(requestId, wsUrl)
    })

    it('应该正确记录文本消息（客户端→服务器）', () => {
      const textData = Buffer.from('Hello, WebSocket!', 'utf-8')
      const message = wsTracker.onMessage(requestId, 'client-to-server', textData)

      expect(message).toBeDefined()
      expect(message.id).toBeDefined()
      expect(message.requestId).toBe(requestId)
      expect(message.direction).toBe('client-to-server')
      expect(message.type).toBe('text')
      expect(message.content).toBe('Hello, WebSocket!')
      expect(message.size).toBe(textData.length)
      expect(message.frameIndex).toBe(1)
      expect(message.timestamp).toBeDefined()
    })

    it('应该正确记录文本消息（服务器→客户端）', () => {
      const textData = Buffer.from('{"type":"message","data":"hello"}', 'utf-8')
      const message = wsTracker.onMessage(requestId, 'server-to-client', textData)

      expect(message.direction).toBe('server-to-client')
      expect(message.type).toBe('text')
      expect(message.content).toBe('{"type":"message","data":"hello"}')
      expect(message.frameIndex).toBe(1)
    })

    it('应该正确识别二进制消息', () => {
      // 创建包含无效 UTF-8 字节的 Buffer
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE])
      const message = wsTracker.onMessage(requestId, 'server-to-client', binaryData)

      expect(message.type).toBe('binary')
      expect(message.content).toBeUndefined()
      expect(message.binaryContent).toBeDefined()
      expect(message.binaryContent).toBe(binaryData.toString('base64'))
    })

    it('应该正确计算帧序号', () => {
      const msg1 = wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('msg1'))
      const msg2 = wsTracker.onMessage(requestId, 'server-to-client', Buffer.from('msg2'))
      const msg3 = wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('msg3'))

      expect(msg1.frameIndex).toBe(1)
      expect(msg2.frameIndex).toBe(2)
      expect(msg3.frameIndex).toBe(3)
    })

    it('应该更新连接统计信息', () => {
      wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('msg1'))
      wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('msg2'))
      wsTracker.onMessage(requestId, 'server-to-client', Buffer.from('response'))

      const connection = wsTracker.getConnection(requestId)
      expect(connection?.messageCount).toBe(3)
      expect(connection?.clientToServerCount).toBe(2)
      expect(connection?.serverToClientCount).toBe(1)
      expect(connection?.totalBytes).toBe(16) // 'msg1'(4) + 'msg2'(4) + 'response'(8)
    })

    it('应该处理空消息', () => {
      const emptyData = Buffer.from('')
      const message = wsTracker.onMessage(requestId, 'client-to-server', emptyData)

      expect(message).toBeDefined()
      expect(message.size).toBe(0)
    })

    it('应该处理包含中文的 UTF-8 文本', () => {
      const chineseText = '你好，WebSocket！'
      const textData = Buffer.from(chineseText, 'utf-8')
      const message = wsTracker.onMessage(requestId, 'client-to-server', textData)

      expect(message.type).toBe('text')
      expect(message.content).toBe(chineseText)
    })

    it('应该处理包含特殊字符的 JSON', () => {
      const jsonText = '{"emoji":"😀","quote":"He said \\"Hello\\""}'
      const textData = Buffer.from(jsonText, 'utf-8')
      const message = wsTracker.onMessage(requestId, 'server-to-client', textData)

      expect(message.type).toBe('text')
      expect(message.content).toBe(jsonText)
    })
  })

  describe('onClose', () => {
    beforeEach(() => {
      wsTracker.onUpgrade(requestId, wsUrl)
    })

    it('应该正确记录连接关闭', () => {
      const reason = 'Normal closure'
      wsTracker.onClose(requestId, reason)

      const connection = wsTracker.getConnection(requestId)
      expect(connection?.closeTime).toBeDefined()
      expect(connection?.closeReason).toBe(reason)
    })

    it('应该处理无原因的关闭', () => {
      wsTracker.onClose(requestId)

      const connection = wsTracker.getConnection(requestId)
      expect(connection?.closeTime).toBeDefined()
      expect(connection?.closeReason).toBeUndefined()
    })
  })

  describe('getConnection', () => {
    it('应该返回 undefined（如果连接不存在）', () => {
      const connection = wsTracker.getConnection('non-existent-id')
      expect(connection).toBeUndefined()
    })

    it('应该返回连接信息（如果连接存在）', () => {
      wsTracker.onUpgrade(requestId, wsUrl)

      const connection = wsTracker.getConnection(requestId)
      expect(connection).toBeDefined()
      expect(connection?.requestId).toBe(requestId)
    })
  })

  describe('getMessages', () => {
    beforeEach(() => {
      wsTracker.onUpgrade(requestId, wsUrl)
    })

    it('应该返回空数组（如果没有消息）', () => {
      const messages = wsTracker.getMessages(requestId)
      expect(messages).toEqual([])
    })

    it('应该返回所有消息（按时间顺序）', () => {
      wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('msg1'))
      wsTracker.onMessage(requestId, 'server-to-client', Buffer.from('msg2'))
      wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('msg3'))

      const messages = wsTracker.getMessages(requestId)
      expect(messages.length).toBe(3)
      expect(messages[0].content).toBe('msg1')
      expect(messages[1].content).toBe('msg2')
      expect(messages[2].content).toBe('msg3')
    })

    it('应该返回空数组（如果连接不存在）', () => {
      const messages = wsTracker.getMessages('non-existent-id')
      expect(messages).toEqual([])
    })
  })

  describe('消息数量限制（内存管理）', () => {
    beforeEach(() => {
      wsTracker.onUpgrade(requestId, wsUrl)
    })

    it('应该自动移除最旧的消息（当超过 1000 条）', () => {
      // 添加 1001 条消息
      for (let i = 0; i < 1001; i++) {
        wsTracker.onMessage(requestId, 'client-to-server', Buffer.from(`message-${i}`))
      }

      const messages = wsTracker.getMessages(requestId)
      expect(messages.length).toBe(1000)
      // 最旧的消息应该被移除，所以第一条应该是 'message-1'（不是 'message-0'）
      expect(messages[0].content).toBe('message-1')
      expect(messages[999].content).toBe('message-1000')
    })
  })

  describe('cleanup', () => {
    it('应该清理指定连接的所有数据', () => {
      wsTracker.onUpgrade(requestId, wsUrl)
      wsTracker.onMessage(requestId, 'client-to-server', Buffer.from('test'))

      // 验证数据存在
      expect(wsTracker.getConnection(requestId)).toBeDefined()
      expect(wsTracker.getMessages(requestId).length).toBe(1)

      // 清理
      wsTracker.cleanup(requestId)

      // 验证数据已清理
      expect(wsTracker.getConnection(requestId)).toBeUndefined()
      expect(wsTracker.getMessages(requestId).length).toBe(0)
    })
  })

  describe('消息类型检测', () => {
    beforeEach(() => {
      wsTracker.onUpgrade(requestId, wsUrl)
    })

    it('应该识别纯 ASCII 文本为 text', () => {
      const data = Buffer.from('Hello World', 'utf-8')
      const message = wsTracker.onMessage(requestId, 'client-to-server', data)
      expect(message.type).toBe('text')
    })

    it('应该识别 valid UTF-8 为 text', () => {
      const data = Buffer.from('Hello 世界 🌍', 'utf-8')
      const message = wsTracker.onMessage(requestId, 'client-to-server', data)
      expect(message.type).toBe('text')
    })

    it('应该识别随机二进制数据为 binary', () => {
      // 生成随机二进制数据（可能包含无效 UTF-8 序列）
      const data = Buffer.from([0x80, 0x81, 0x82, 0xFF, 0xFE, 0x00])
      const message = wsTracker.onMessage(requestId, 'server-to-client', data)
      expect(message.type).toBe('binary')
    })

    it('应该为二进制消息存储 Base64 编码', () => {
      const data = Buffer.from([0x01, 0x02, 0x03])
      const message = wsTracker.onMessage(requestId, 'server-to-client', data)

      expect(message.type).toBe('binary')
      expect(message.binaryContent).toBe('AQID')
    })
  })
})
