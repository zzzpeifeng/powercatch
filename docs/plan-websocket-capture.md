# #15 WebSocket 抓包 - 技术方案

> **状态**: Plan v1.1（用户决策更新版）  
> **工作量评估**: 中（约 3-4 人天）  
> **依赖**: 无  
> **优先级**: P1（中价值 - 差异化特色）  
> **评审日期**: 2026-06-29  
> **用户决策**:
> - ✅ http-mitm-proxy 支持 WebSocket（已验证）
> - ✅ 消息存储策略：方案 B（限制内存中的消息数量）
> - ✅ 二进制消息显示：方案 A（Hex 查看器）
> - ✅ 消息过滤：实现基本过滤（按方向 + 类型）

---

## 1. 功能概述

### 1.1 核心能力

**WebSocket 抓包**允许捕获 WS/WSS 连接的帧级别消息，包括：
- 文本帧（Text Frame）
- 二进制帧（Binary Frame）
- 控制帧（Ping/Pong/Close）
- 支持帧方向（客户端→服务器 / 服务器→客户端）

### 1.2 典型使用场景

1. **实时通信调试**
   - 查看 WebSocket 连接的全量消息
   - 分析消息内容（JSON/文本/二进制）
   - 调试实时通信协议

2. **性能分析**
   - 统计消息频率
   - 分析消息大小分布
   - 检测心跳包间隔

3. **安全审计**
   - 检查 WebSocket 消息内容
   - 验证加密/编码是否正确
   - 检测异常消息模式

---

## 2. 数据模型

### 2.1 WebSocket 消息接口

```typescript
// src/services/types.ts

/**
 * WebSocket 消息方向
 */
export type WebSocketMessageDirection = 'client-to-server' | 'server-to-client'

/**
 * WebSocket 消息类型
 */
export type WebSocketMessageType = 'text' | 'binary' | 'ping' | 'pong' | 'close' | 'unknown'

/**
 * WebSocket 消息
 */
export interface WebSocketMessage {
  /** 消息 ID */
  id: string
  /** 所属请求 ID（关联到 CaptureRequest） */
  requestId: string
  /** 消息方向 */
  direction: WebSocketMessageDirection
  /** 消息类型 */
  type: WebSocketMessageType
  /** 消息内容（文本） */
  content?: string
  /** 消息内容（二进制，Base64 编码） */
  binaryContent?: string
  /** 消息大小（字节） */
  size: number
  /** 时间戳 */
  timestamp: string
  /** 是否压缩 */
  compressed?: boolean
  /** 帧序号（同一连接内递增） */
  frameIndex: number
}

/**
 * WebSocket 连接信息
 */
export interface WebSocketConnection {
  /** 请求 ID */
  requestId: string
  /** WebSocket URL */
  url: string
  /** 协议（ws:// 或 wss://） */
  protocol: string
  /** 升级时间 */
  upgradeTime: string
  /** 关闭时间 */
  closeTime?: string
  /** 关闭原因 */
  closeReason?: string
  /** 消息总数 */
  messageCount: number
  /** 客户端→服务器消息数 */
  clientToServerCount: number
  /** 服务器→客户端消息数 */
  serverToClientCount: number
  /** 总字节数 */
  totalBytes: number
}
```

### 2.2 CaptureRequest 中的 WebSocket 标记

```typescript
// 在 CaptureRequest 中添加字段

export interface CaptureRequest {
  // ... 已有字段
  
  /** 是否是 WebSocket 请求 */
  isWebSocket?: boolean
  
  /** WebSocket 连接信息（如果是 WS 请求） */
  webSocketConnection?: WebSocketConnection
  
  /** WebSocket 消息列表（如果是 WS 请求） */
  webSocketMessages?: WebSocketMessage[]
}
```

---

## 3. 技术方案

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│              WebSocket 抓包架构                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐      ┌──────────────┐             │
│  │   mitm-      │      │   WebSocket  │             │
│  │   server.ts   │ ───► │   Handler    │             │
│  │   (代理层)    │      │   (处理器)    │             │
│  └──────────────┘      └──────────────┘             │
│         │                      │                          │
│         ▼                      ▼                          │
│  ┌──────────────┐      ┌──────────────┐             │
│  │   SQLite      │      │   Pinia       │             │
│  │   (持久化)    │      │   Store       │             │
│  └──────────────┘      └──────────────┘             │
│                                  │                     │
│                                  ▼                     │
│                        ┌──────────────┐                 │
│                        │ WebSocket-   │                 │
│                        │ Messages.vue  │                 │
│                        │   (消息列表)   │                 │
│                        └──────────────┘                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 WebSocket 拦截器

**文件**: `electron/proxy/websocket-handler.ts`（新增）

```typescript
/**
 * WebSocket 消息处理器
 * 拦截 WS/WSS 连接的帧级别消息
 */

import type { WebSocketMessage, WebSocketConnection } from '../../src/services/types'
import { v4 as uuidv4 } from 'uuid'

/**
 * WebSocket 连接跟踪器
 */
class WebSocketTracker {
  private connections = new Map<string, WebSocketConnection>()
  private messages = new Map<string, WebSocketMessage[]>()

  /**
   * 记录 WebSocket 升级
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
    
    messages.push(message)
    this.messages.set(requestId, messages)
    
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
   */
  onClose(requestId: string, reason?: string): void {
    const connection = this.connections.get(requestId)
    if (connection) {
      connection.closeTime = new Date().toISOString()
      connection.closeReason = reason
    }
  }

  /**
   * 获取连接信息
   */
  getConnection(requestId: string): WebSocketConnection | undefined {
    return this.connections.get(requestId)
  }

  /**
   * 获取消息列表
   */
  getMessages(requestId: string): WebSocketMessage[] {
    return this.messages.get(requestId) || []
  }

  /**
   * 检测消息类型（基于内容特征）
   */
  private detectMessageType(data: Buffer): WebSocketMessageType {
    // 尝试 UTF-8 解码
    try {
      const text = data.toString('utf-8')
      // 检查是否是有效的 UTF-8 文本（不包含替换字符）
      if (!text.includes('\uFFFD')) {
        return 'text'
      }
    } catch {
      // 解码失败，说明是二进制数据
    }
    
    return 'binary'
  }

  /**
   * 尝试解码内容
   */
  private tryDecodeContent(data: Buffer): string | undefined {
    try {
      const text = data.toString('utf-8')
      // 检查是否是有效的 UTF-8 文本
      if (/^[\x00-\x7F\xC0-\xFD]*$/.test(text)) {
        return text
      }
      return undefined
    } catch {
      return undefined
    }
  }
}

export const wsTracker = new WebSocketTracker()
```

### 3.3 代理层集成

**文件**: `electron/proxy/mitm-server.ts`（修改）

**WebSocket 连接拦截**：

```typescript
// 在 mitm-server.ts 中添加

import { wsTracker } from './websocket-handler'
import { BrowserWindow } from 'electron'
import type { WebSocketMessage } from '../../src/services/types'

// WebSocket 连接建立
proxy.onWebSocketConnection((ctx, callback) => {
  const requestId = ctx.clientToProxyWebSocket.upgradeReq.requestId
  const url = ctx.clientToProxyWebSocket.upgradeReq.url || ''
  
  // 记录 WebSocket 升级
  wsTracker.onUpgrade(requestId, url)
  
  // 标记请求为 WebSocket
  const captureRequest = requestStore.get(requestId)
  if (captureRequest) {
    captureRequest.isWebSocket = true
  }
  
  return callback()
})

// 客户端发送消息（客户端→服务器）
proxy.onWebSocketSend((ctx, message, flags, callback) => {
  const requestId = ctx.clientToProxyWebSocket.upgradeReq.requestId
  
  // 记录消息
  const wsMessage = wsTracker.onMessage(requestId, 'client-to-server', message)
  
  // 限制内存中的消息数量（最多 1000 条）
  const messages = wsTracker.getMessages(requestId)
  if (messages.length > 1000) {
    messages.shift() // 移除最旧的消息
  }
  
  // 推送消息到渲染进程
  sendWebSocketMessageToRenderer(wsMessage)
  
  return callback()
})

// 服务端返回消息（服务器→客户端）
proxy.onWebSocketMessage((ctx, message, flags, callback) => {
  const requestId = ctx.clientToProxyWebSocket.upgradeReq.requestId
  
  // 记录消息
  const wsMessage = wsTracker.onMessage(requestId, 'server-to-client', message)
  
  // 限制内存中的消息数量（最多 1000 条）
  const messages = wsTracker.getMessages(requestId)
  if (messages.length > 1000) {
    messages.shift() // 移除最旧的消息
  }
  
  // 推送消息到渲染进程
  sendWebSocketMessageToRenderer(wsMessage)
  
  return callback()
})

// WebSocket 连接关闭
proxy.onWebSocketClose((ctx, code, message, callback) => {
  const requestId = ctx.clientToProxyWebSocket.upgradeReq.requestId
  
  // 记录关闭
  wsTracker.onClose(requestId, message?.toString())
  
  // 推送连接关闭事件到渲染进程
  sendWebSocketConnectionClosedToRenderer(requestId, message?.toString())
  
  return callback()
})

/**
 * 推送 WebSocket 消息到渲染进程
 */
function sendWebSocketMessageToRenderer(message: WebSocketMessage): void {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('websocket:message-added', message)
    }
  })
}

/**
 * 推送 WebSocket 连接关闭事件到渲染进程
 */
function sendWebSocketConnectionClosedToRenderer(requestId: string, reason?: string): void {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('websocket:connection-closed', { requestId, reason })
    }
  })
}
```

**⚠️ 关键设计决策**：
- 使用 `http-mitm-proxy` 的 `onWebSocketConnection`/`onWebSocketSend`/`onWebSocketMessage`/`onWebSocketClose` 事件
- `onWebSocketSend`：客户端发送的消息（客户端→服务器）
- `onWebSocketMessage`：服务端返回的消息（服务器→客户端）
- 消息内容存储在内存中（限制最多 1000 条，避免性能问题）
- 消息内容尝试 UTF-8 解码，成功则为文本，失败则为二进制
- 控制帧（Ping/Pong/Close）由 `onWebSocketClose` 事件处理
- 主进程通过 `websocket:message-added` 事件推送消息到渲染进程（实时更新 UI）

**⚠️ 控制帧处理说明**：
- `onWebSocketSend`/`onWebSocketMessage` 事件**可能不包含控制帧**（Ping/Pong）
- 需要验证 http-mitm-proxy 是否提供控制帧事件
- 如不支持，v1.0 暂不显示控制帧，后续版本优化

### 3.4 状态管理

**文件**: `src/stores/websocket-store.ts`（新增）

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WebSocketMessage, WebSocketConnection } from '../services/types'

export const useWebSocketStore = defineStore('websocket', () => {
  // State
  const connections = ref<WebSocketConnection[]>([])
  const currentRequestId = ref<string | null>(null)
  const messages = ref<WebSocketMessage[]>([])
  const loaded = ref<boolean>(false)
  const messageLimit = 1000 // 内存中最多保存 1000 条消息
  
  // 过滤状态
  const filterDirection = ref<'all' | 'client-to-server' | 'server-to-client'>('all')
  const filterType = ref<'all' | 'text' | 'binary' | 'ping' | 'pong' | 'close'>('all')
  const searchQuery = ref<string>('')

  // Getters
  const currentConnection = computed(() => {
    if (!currentRequestId.value) return null
    return connections.value.find(c => c.requestId === currentRequestId.value) || null
  })

  const messageCount = computed(() => messages.value.length)
  
  // 过滤后的消息列表（计算属性实现）
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
  
  const clientToServerMessages = computed(() => {
    return messages.value.filter(m => m.direction === 'client-to-server')
  })
  
  const serverToClientMessages = computed(() => {
    return messages.value.filter(m => m.direction === 'server-to-client')
  })

  // Actions
  function loadConnection(requestId: string): void {
    currentRequestId.value = requestId
    const connection = connections.value.find(c => c.requestId === requestId)
    
    // 从内存中加载消息（或从 session 恢复）
    if (connection) {
      messages.value = connection.messages || []
    }
  }

  function addMessage(message: WebSocketMessage): void {
    messages.value.push(message)
    
    // 限制内存中的消息数量
    if (messages.value.length > messageLimit) {
      messages.value.shift() // 移除最旧的消息
    }
    
    // 更新连接信息
    const connection = connections.value.find(c => c.requestId === message.requestId)
    if (connection) {
      connection.messageCount++
      connection.totalBytes += message.size
      if (message.direction === 'client-to-server') {
        connection.clientToServerCount++
      } else {
        connection.serverToClientCount++
      }
    }
  }

  function setFilter(direction?: 'all' | 'client-to-server' | 'server-to-client', type?: 'all' | 'text' | 'binary' | 'ping' | 'pong' | 'close'): void {
    if (direction !== undefined) {
      filterDirection.value = direction
    }
    if (type !== undefined) {
      filterType.value = type
    }
  }
  
  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  function selectConnection(requestId: string): void {
    currentRequestId.value = requestId
  }

  return {
    connections, currentRequestId, messages, loaded,
    currentConnection, messageCount, filteredMessages,
    clientToServerMessages, serverToClientMessages,
    filterDirection, filterType, searchQuery,
    loadConnection, addMessage, setFilter, setSearchQuery, selectConnection,
  }
})
```

### 3.5 UI 组件

**文件**: `src/components/WebSocketMessages.vue`（新增）

主要功能：

1. **消息列表**
   - 显示所有 WebSocket 消息
   - 按时间顺序排序
   - 显示消息方向（↑客户端→服务器 / ↓服务器→客户端）
   - 显示消息类型（Text/Binary/Ping/Pong/Close）
   - 显示消息大小
   - 显示时间戳

2. **消息详情**
   - 文本内容：语法高亮显示（JSON/XML/纯文本）
   - 二进制内容：**Hex 查看器**（类似 Wireshark）
   - 控制帧：显示详细信息

3. **过滤和搜索**
   - 按方向过滤（客户端→服务器 / 服务器→客户端 / 全部）
   - 按类型过滤（Text / Binary / Ping / Pong / Close / 全部）
   - 搜索消息内容（仅文本消息）

4. **统计信息**
   - 消息总数
   - 客户端→服务器消息数
   - 服务器→客户端消息数
   - 总字节数
   - 连接时长
   - 内存中消息数 / 限制（如 500 / 1000）

**Hex 查看器功能**：
- 左侧：Hex  dump（16 字节/行，显示偏移量 + Hex 值）
- 右侧：ASCII 显示（不可打印字符显示为 `.`）
- 支持大文件（虚拟滚动，只渲染可见区域）
- 支持复制选中的字节

**Hex 查看器实现方案**：
- 详见 `docs/hex-viewer-implementation.md`（虚拟滚动 + 性能优化）

**UI 入口**：
- 在 `RequestDetail.vue` 中添加 WebSocket 标签页
- 仅在 `isWebSocket` 为 `true` 时显示

---

## 4. IPC 通道

### 4.1 通道定义

```typescript
// src/services/types.ts

export const IPC_CHANNELS = {
  // ... 已有通道
  
  // WebSocket 抓包（简化版）
  WEBSOCKET_MESSAGE_ADDED: 'websocket:message-added',
  WEBSOCKET_CONNECTION_CLOSED: 'websocket:connection-closed',
} as const
```

**设计决策**：
- 不再需要 `get-connection`/`get-messages` IPC（消息存储在内存中）
- 主进程通过 `websocket:message-added` 事件推送消息到渲染进程
- 渲染进程通过 `websocket-store` 管理消息状态（限制 1000 条）

---

## 5. 数据库设计（可选）

> **设计决策**：WebSocket 消息存储在内存中（限制 1000 条），仅在保存会话时持久化到数据库。

### 5.1 websocket_connections 表（可选）

```sql
-- 仅在保存会话时创建
CREATE TABLE IF NOT EXISTS websocket_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  protocol TEXT NOT NULL,
  upgrade_time TEXT NOT NULL,
  close_time TEXT,
  close_reason TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  client_to_server_count INTEGER NOT NULL DEFAULT 0,
  server_to_client_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);
```

### 5.2 websocket_messages 表（可选）

```sql
-- 仅在保存会话时创建
CREATE TABLE IF NOT EXISTS websocket_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  binary_content TEXT,
  size INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0,
  frame_index INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES websocket_connections(request_id) ON DELETE CASCADE
);
```

**持久化策略**：
- 内存中限制 1000 条消息（实时捕获）
- 保存会话时，将内存中的消息写入数据库
- 恢复会话时，从数据库加载消息到内存。
- 不保存会话时，关闭应用后消息丢失（类似 Chrome DevTools）

---

## 6. 实现任务分解

### T1: 数据模型 + WebSocket 处理器（1 天）

**文件**:
- `src/services/types.ts`（新增 WebSocketMessage/WebSocketConnection 接口 + IPC 通道）
- `electron/proxy/websocket-handler.ts`（新增，WebSocket 消息处理器）
- `src/stores/websocket-store.ts`（新增，状态管理）

**验收标准**:
- ✅ WebSocketMessage/WebSocketConnection 接口定义正确
- ✅ WebSocket 处理器功能完整（跟踪连接、记录消息、检测类型）
- ✅ Store 包含完整的状态管理逻辑（含过滤）

---

### T2: 代理层集成（1 天）

**文件**:
- `electron/proxy/mitm-server.ts`（添加 WebSocket 升级拦截 + 消息拦截 + 关闭拦截 + 推送事件）

**验收标准**:
- ✅ WebSocket 升级检测正常
- ✅ 消息拦截正常（文本 + 二进制）
- ✅ 连接关闭检测正常
- ✅ 消息推送到渲染进程正常（`websocket:message-added`）
- ✅ 连接关闭事件推送正常（`websocket:connection-closed`）

---

### T3: UI 组件（1 天）

**文件**:
- `src/components/WebSocketMessages.vue`（新增，WebSocket 消息列表 UI）
- `src/components/HexViewer.vue`（新增，Hex 查看器）
- `src/components/RequestDetail.vue`（添加 WebSocket 标签页）

**验收标准**:
- ✅ 消息列表显示正常（方向/类型/大小/时间戳）
- ✅ 消息详情显示正常（文本语法高亮 / 二进制 Hex 查看）
- ✅ 过滤和搜索功能正常（按方向 + 类型 + 内容搜索）
- ✅ 统计信息显示正常
- ✅ Hex 查看器功能完整（Hex dump + ASCII + 虚拟滚动）
- ✅ UI 风格与现有组件一致
- ✅ 仅在 `isWebSocket` 为 `true` 时显示

---

### T4: 入口集成 + 测试（0.5 天）

**文件**:
- `src/components/RequestList.vue`（添加 WebSocket 标识）
- `src/components/RequestDetail.vue`（添加 WebSocket 入口）
- 测试文件

**验收标准**:
- ✅ RequestList 显示 WebSocket 标识（如 🔌 图标）
- ✅ 点击 WebSocket 请求打开消息列表
- ✅ 功能测试通过

---

### T5: 可选功能（会话保存/恢复支持）（0.5 天，后续版本）

**文件**:
- `electron/db/migrations.ts`（新增 websocket_connections/messages 表）
- `electron/db/sqlite.ts`（新增 CRUD 函数）
- `src/services/session-service.ts`（修改，保存会话时持久化 WebSocket 消息）

**验收标准**:
- ✅ 保存会话时，WebSocket 消息写入数据库
- ✅ 恢复会话时，WebSocket 消息从数据库加载到内存
- ✅ 不保存会话时，关闭应用后消息丢失（符合预期）

**注意**：T5 是可选功能，v1.0 可以不实现，后续版本再添加。

## 7. 测试计划

### 7.1 功能测试

| 测试场景 | 预期结果 |
|---------|---------|
| WebSocket 升级检测 | 正确检测 WS/WSS 升级 |
| 文本消息捕获 | 正确捕获文本帧 |
| 二进制消息捕获 | 正确捕获二进制帧 |
| 消息方向识别 | 正确识别客户端→服务器 / 服务器→客户端 |
| 消息推送到渲染进程 | 主进程推送消息，UI 实时更新 |
| 消息列表显示 | 消息列表正确显示 |
| 消息详情显示（文本） | 文本内容语法高亮显示 |
| 消息详情显示（二进制） | Hex 查看器正确显示 |
| 连接关闭检测 | 正确检测连接关闭 |
| 消息过滤（方向） | 按方向过滤正常 |
| 消息过滤（类型） | 按类型过滤正常 |
| 消息搜索 | 搜索消息内容正常 |

### 7.2 边界测试

| 测试场景 | 预期结果 |
|---------|---------|
| 大消息（>1MB） | 正确捕获，不崩溃 |
| 高频消息（>1000 条/秒） | 性能可接受，不丢消息 |
| 异常消息格式 | 正确识别为 binary 类型 |
| 连接异常关闭 | 正确记录关闭原因 |
| 内存限制（>1000 条） | 自动移除最旧的消息 |

### 7.3 性能测试

| 测试场景 | 预期结果 |
|---------|---------|
| Hex 查看器（大文件） | 虚拟滚动正常，不卡顿 |
| 消息列表（1000 条） | 滚动流畅，不卡顿 |
| 消息推送（高频） | UI 更新流畅，不阻塞 |

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| http-mitm-proxy 不支持 WebSocket | 极低 | 高 | **已验证**：http-mitm-proxy 支持 WebSocket（onWebSocketConnection/Send/Message/Close） |
| 消息量过大导致性能问题 | 中 | 中 | 限制内存中的消息数量（最多 1000 条） |
| 二进制消息显示不友好 | 高 | 低 | 提供 Hex 查看器（类似 Wireshark） |
| 控制帧不支持 | 中 | 低 | v1.0 暂不显示控制帧，后续版本优化 |
| 消息推送性能问题 | 低 | 中 | 使用 Electron IPC 事件推送，渲染进程异步更新 |
| Hex 查看器性能问题 | 中 | 中 | 使用虚拟滚动，只渲染可见区域 |

---

## 9. 已解决问题

~~1. **http-mitm-proxy 是否支持 WebSocket 代理？**~~  
✅ **已解决**：http-mitm-proxy 支持 WebSocket（提供 `onWebSocketConnection`/`onWebSocketSend`/`onWebSocketMessage`/`onWebSocketClose` 事件）

~~2. **消息存储策略？**~~  
✅ **已解决**：使用方案 B（限制内存中的消息数量，最多 1000 条）

~~3. **二进制消息显示？**~~  
✅ **已解决**：使用方案 A（Hex 查看器，类似 Wireshark）

~~4. **是否需要消息过滤？**~~  
✅ **已解决**：v1.0 实现基本过滤（按方向 + 类型 + 内容搜索）

---

## 10. 总结

#15 WebSocket 抓包是一个**中工作量、中价值**的功能，可以：

1. **捕获 WebSocket 消息**：捕获文本和二进制消息（客户端→服务器 / 服务器→客户端）
2. **显示消息列表**：按时间顺序，显示方向/类型/大小/时间戳
3. **查看消息详情**：文本内容语法高亮 / 二进制内容 Hex 查看器
4. **过滤和搜索**：按方向/类型过滤，搜索消息内容
5. **统计信息**：消息总数/方向分布/总字节数/连接时长/内存使用

**预计工作量**：3-4 人天  
**依赖**：无  
**优先级**：P1（中价值 - 差异化特色）  

**技术挑战**：
- 处理大消息和高频消息的性能问题（限制内存 1000 条）
- 提供友好的二进制消息显示（Hex 查看器 + 虚拟滚动）
- 实时推送消息到渲染进程（Electron IPC 事件）

**差异化价值**：
- Charles **不支持** WebSocket 抓包（或支持有限）
- Postman 有 WebSocket 调试能力，但 PowerCatch 可以做得更深入（帧级别捕获 + Hex 查看器）
- 这是 **PowerCatch 的差异化特色功能**，对标 Postman 的 WebSocket 调试能力

**v1.0 范围**：
- ✅ 捕获文本和二进制消息
- ✅ 显示消息列表和详情
- ✅ 过滤和搜索
- ✅ Hex 查看器
- ❌ 控制帧捕获（Ping/Pong/Close）- 后续版本支持
- ❌ 会话保存/恢复支持（数据库持久化）- 后续版本支持

---
