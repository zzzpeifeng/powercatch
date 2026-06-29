/**
 * WebSocket 消息处理器
 * 拦截 WS/WSS 连接的帧级别消息
 */

import type { WebSocketMessage, WebSocketConnection, WebSocketMessageType } from '../../src/services/types'
import { v4 as uuidv4 } from 'uuid'

/**
 * WebSocket 连接跟踪器
 */
class WebSocketTracker {
  private connections = new Map<string, WebSocketConnection>()
  private messages = new Map<string, WebSocketMessage[]>()
  private readonly MAX_MESSAGES = 1000

  /**
   * 记录 WebSocket 升级
   * @param requestId 请求 ID
   * @param url WebSocket URL
   */
  onUpgrade(requestId: string, url: string): void {
    const connection: WebSocketConnection = {
      requestId,
      url,
      protocol: url.startsWith('wss://') ? 'wss://' : 'ws://',
      upgradeTime: new Date().toISOString(),
      messageCount: 0,
      clientToServerCount: 0,
      serverToClientCount: 0,
      totalBytes: 0,
    }
    this.connections.set(requestId, connection)
    this.messages.set(requestId, [])
  }

  /**
   * 记录消息
   * @param requestId 请求 ID
   * @param direction 消息方向
   * @param data 消息数据
   * @returns WebSocketMessage 对象
   */
  onMessage(requestId: string, direction: 'client-to-server' | 'server-to-client', data: Buffer): WebSocketMessage {
    const messages = this.messages.get(requestId) || []
    const connection = this.connections.get(requestId)
    
    const message: WebSocketMessage = {
      id: uuidv4(),
      requestId,
      direction,
      type: this.detectMessageType(data),
      content: this.tryDecodeContent(data),
      size: data.length,
      timestamp: new Date().toISOString(),
      frameIndex: messages.length + 1,
    }
    
    // 如果是二进制消息，存储 Base64 编码
    if (message.type === 'binary' && !message.content) {
      message.binaryContent = data.toString('base64')
    }
    
    messages.push(message)
    
    // 限制内存中的消息数量（最多 1000 条）
    if (messages.length > this.MAX_MESSAGES) {
      messages.shift() // 移除最旧的消息
    }
    
    this.messages.set(requestId, messages)
    
    // 更新连接统计
    if (connection) {
      connection.messageCount++
      connection.totalBytes += data.length
      if (direction === 'client-to-server') {
        connection.clientToServerCount++
      } else {
        connection.serverToClientCount++
      }
    }
    
    return message
  }

  /**
   * 记录连接关闭
   * @param requestId 请求 ID
   * @param reason 关闭原因
   */
  onClose(requestId: string, reason?: string): void {
    const connection = this.connections.get(requestId)
    if (connection) {
      connection.closeTime = new Date().toISOString()
      connection.closeReason = reason || undefined
    }
  }

  /**
   * 获取连接信息
   * @param requestId 请求 ID
   * @returns WebSocketConnection 或 undefined
   */
  getConnection(requestId: string): WebSocketConnection | undefined {
    return this.connections.get(requestId)
  }

  /**
   * 获取消息列表
   * @param requestId 请求 ID
   * @returns WebSocketMessage 数组
   */
  getMessages(requestId: string): WebSocketMessage[] {
    return this.messages.get(requestId) || []
  }

  /**
   * 检测消息类型（基于内容特征）
   * @param data 消息数据
   * @returns 消息类型
   */
  private detectMessageType(data: Buffer): WebSocketMessageType {
    // 尝试 UTF-8 解码
    try {
      const text = data.toString('utf-8')
      // 检查是否包含替换字符（解码失败标记）
      if (!text.includes('\uFFFD')) {
        // 检查是否包含过多控制字符（< 0x20，排除 \t, \n, \r）
        const controlCharCount = text.split('').filter(c => {
          const code = c.charCodeAt(0)
          return code < 0x20 && ![0x09, 0x0A, 0x0D].includes(code)
        }).length
        
        const controlRatio = controlCharCount / text.length
        // 控制字符 < 10% 认为是文本
        if (controlRatio < 0.1) {
          return 'text'
        }
      }
    } catch {
      // 解码失败，说明是二进制数据
    }
    
    return 'binary'
  }

  /**
   * 尝试解码内容
   * @param data 消息数据
   * @returns 解码后的文本或 undefined
   */
  private tryDecodeContent(data: Buffer): string | undefined {
    try {
      const text = data.toString('utf-8')
      // 检查是否包含替换字符（解码失败标记）
      if (!text.includes('\uFFFD')) {
        // 检查是否包含过多控制字符（< 0x20，排除 \t, \n, \r）
        const controlCharCount = text.split('').filter(c => {
          const code = c.charCodeAt(0)
          return code < 0x20 && ![0x09, 0x0A, 0x0D].includes(code)
        }).length
        
        const controlRatio = controlCharCount / text.length
        // 控制字符 < 10% 认为是文本
        if (controlRatio < 0.1) {
          return text
        }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * 清理指定连接的数据（可选，用于释放内存）
   * @param requestId 请求 ID
   */
  cleanup(requestId: string): void {
    this.connections.delete(requestId)
    this.messages.delete(requestId)
  }
}

/** 导出单例 */
export const wsTracker = new WebSocketTracker()
