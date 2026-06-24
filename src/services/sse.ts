/**
 * SSE (Server-Sent Events) 连接管理服务
 * 严格遵循 SSE 规范，实现可靠的连接管理
 *
 * 功能：
 * 1. 正确实现 EventSource 生命周期管理
 * 2. 区分错误类型并处理
 * 3. 实现资源清理逻辑（避免内存泄漏）
 * 4. 实现降级策略（SSE 失败 → IPC 轮询）
 * 5. 使用 requestAnimationFrame 节流 UI 更新
 */
import type { AnalysisLogEntry, AIDeepAnalysisResult } from './types'

/** SSE 事件类型 */
export interface SSEMessage {
  type: 'connected' | 'log' | 'progress' | 'agent_thinking' | 'agent_tool_call' | 'agent_tool_result' | 'heartbeat' | 'done' | 'error' | 'disconnect'
  data: any
  timestamp?: number
}

/** SSE 连接状态 */
export type SSEConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

/** SSE 服务配置 */
interface SSEServiceConfig {
  /** SSE 服务器 URL */
  url: string
  /** 重连最大重试次数（默认 5 次） */
  maxRetries?: number
  /** 重连延迟（毫秒，默认 3000） */
  retryDelay?: number
  /** 是否启用自动重连（默认 true） */
  autoReconnect?: boolean
}

/** 默认配置 */
const DEFAULT_CONFIG: SSEServiceConfig = {
  url: '',
  maxRetries: 5,
  retryDelay: 3000,
  autoReconnect: true,
}

/**
 * SSE 连接管理服务类
 */
export class SSEService {
  /** 配置 */
  private config: SSEServiceConfig

  /** EventSource 实例 */
  private eventSource: EventSource | null = null

  /** 连接状态 */
  private _state: SSEConnectionState = 'disconnected'

  /** 错误对象 */
  private _error: Error | null = null

  /** 重试计数器 */
  private retryCount = 0

  /** 事件监听器集合 */
  private listeners: Array<{ event: string; handler: EventListener }> = []

  /** 消息处理器映射 */
  private messageHandlers: Map<string, (data: any) => void> = new Map()

  /** 待处理的 UI 更新（用于节流） */
  private pendingUpdates: SSEMessage[] = []

  /** requestAnimationFrame ID */
  private rafId: number | null = null

  /** IPC 轮询降级定时器 */
  private pollingInterval: number | null = null

  /** 最后日志 ID（用于 IPC 轮询） */
  private lastLogId = 0

  /** 是否启用 IPC 轮询降级 */
  private fallbackToPolling = false

  /** 状态变化回调 */
  public onStateChange?: (state: SSEConnectionState, error?: Error | null) => void

  /** 消息接收回调 */
  public onMessage?: (message: SSEMessage) => void

  /** 日志接收回调 */
  public onLog?: (log: AnalysisLogEntry) => void

  /** 进度更新回调 */
  public onProgress?: (progress: { phase: string; message: string; extra?: any }) => void

  /** AI 思考过程回调 */
  public onAgentThinking?: (content: string) => void

  /** AI 工具调用回调 */
  public onAgentToolCall?: (tool: string, args?: any) => void

  /** AI 工具结果回调 */
  public onAgentToolResult?: (tool: string, result: any) => void

  /** 分析完成回调 */
  public onDone?: (result: AIDeepAnalysisResult) => void

  /** 分析错误回调 */
  public onError?: (message: string) => void

  /**
   * 构造函数
   * @param config SSE 服务配置
   */
  constructor(config: Partial<SSEServiceConfig> & { url: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 获取当前连接状态
   */
  get state(): SSEConnectionState {
    return this._state
  }

  /**
   * 获取当前错误
   */
  get error(): Error | null {
    return this._error
  }

  /**
   * 是否已连接
   */
  get isConnected(): boolean {
    return this._state === 'connected'
  }

  /** 连接超时定时器 */
  private connectTimeout: number | null = null

  /**
   * 连接 SSE 服务器
   */
  connect(): void {
    if (this.eventSource) {
      console.warn('[SSEService] 已连接，先断开')
      this.disconnect()
    }

    this._state = 'connecting'
    this._error = null
    this.notifyStateChange()

    try {
      console.log(`[SSEService] 正在连接: ${this.config.url}`)

      // ⚠️ 关键：EventSource 不支持配置代理，会被系统代理拦截
      // 解决方案：通过 fetch + ReadableStream 实现 SSE，或使用 IPC 代理
      // 当前方案：添加连接超时检测，超时后降级到 IPC 轮询
      this.eventSource = new EventSource(this.config.url)

      // 设置连接超时（10秒没收到 open 事件就认为失败）
      this.connectTimeout = window.setTimeout(() => {
        if (this._state === 'connecting') {
          console.warn('[SSEService] 连接超时（10秒），降级到 IPC 轮询')
          this.fallbackToPollingMode()
        }
      }, 10000)

      // 注册事件监听器
      this.registerEventListeners()
    } catch (err) {
      this._error = err instanceof Error ? err : new Error(String(err))
      this._state = 'error'
      this.notifyStateChange()
      console.error('[SSEService] 连接失败:', this._error.message)

      // 尝试降级到 IPC 轮询
      this.fallbackToPollingMode()
    }
  }

  /**
   * 断开 SSE 连接
   */
  disconnect(): void {
    // 清除连接超时定时器
    if (this.connectTimeout !== null) {
      clearTimeout(this.connectTimeout)
      this.connectTimeout = null
    }

    // 停止 IPC 轮询
    this.stopPolling()

    // 清理 EventSource
    if (this.eventSource) {
      console.log('[SSEService] 正在断开连接...')

      // 移除所有事件监听器
      this.unregisterEventListeners()

      // 关闭连接
      this.eventSource.close()
      this.eventSource = null
    }

    // 清理 requestAnimationFrame
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    // 清空待处理的更新
    this.pendingUpdates = []

    // 更新状态
    this._state = 'disconnected'
    this.retryCount = 0
    this.fallbackToPolling = false
    this.notifyStateChange()
  }

  /**
   * 注册事件监听器
   */
  private registerEventListeners(): void {
    if (!this.eventSource) {
      return
    }

    const es = this.eventSource

      // open 事件：连接建立
      const openHandler: EventListener = (event) => {
        console.log('[SSEService] 连接已建立')

        // 清除连接超时定时器
        if (this.connectTimeout !== null) {
          clearTimeout(this.connectTimeout)
          this.connectTimeout = null
        }

        this._state = 'connected'
        this._error = null
        this.retryCount = 0
        this.notifyStateChange()
      }
    es.addEventListener('open', openHandler)
    this.listeners.push({ event: 'open', handler: openHandler })

    // message 事件：收到消息
    const messageHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage(data)
      } catch (err) {
        console.error('[SSEService] 数据解析错误:', err)
        // 降级策略：跳过本条消息，继续处理
      }
    }
    es.addEventListener('message', messageHandler)
    this.listeners.push({ event: 'message', handler: messageHandler })

    // error 事件：连接错误
    const errorHandler: EventListener = (event) => {
      console.error('[SSEService] 连接错误:', event)

      // 区分错误类型
      if (es.readyState === EventSource.CLOSED) {
        console.log('[SSEService] 连接已关闭（正常）')
        this._state = 'disconnected'
        this.notifyStateChange()
      } else if (es.readyState === EventSource.CONNECTING) {
        console.log('[SSEService] 正在重连...')
        this._state = 'reconnecting'
        this._error = new Error('连接中断，正在重连...')
        this.notifyStateChange()

        // 如果重连次数过多，切换到 IPC 轮询降级模式
        this.retryCount++
        if (this.retryCount > (this.config.maxRetries || 5)) {
          console.warn('[SSEService] 重连次数过多，切换到 IPC 轮询降级模式')
          this.fallbackToPollingMode()
        }
      } else {
        this._state = 'error'
        this._error = new Error('SSE 连接异常')
        this.notifyStateChange()
      }
    }
    es.addEventListener('error', errorHandler)
    this.listeners.push({ event: 'error', handler: errorHandler })

    // 注册自定义事件处理器
    this.registerMessageHandlers()
  }

  /**
   * 注册 SSE 消息处理器
   */
  private registerMessageHandlers(): void {
    if (!this.eventSource) {
      return
    }

    const es = this.eventSource

    // connected 事件
    const connectedHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'connected', data })
      } catch (err) {
        console.error('[SSEService] connected 事件解析错误:', err)
      }
    }
    es.addEventListener('connected', connectedHandler)
    this.listeners.push({ event: 'connected', handler: connectedHandler })

    // log 事件
    const logHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'log', data })
      } catch (err) {
        console.error('[SSEService] log 事件解析错误:', err)
      }
    }
    es.addEventListener('log', logHandler)
    this.listeners.push({ event: 'log', handler: logHandler })

    // progress 事件
    const progressHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'progress', data })
      } catch (err) {
        console.error('[SSEService] progress 事件解析错误:', err)
      }
    }
    es.addEventListener('progress', progressHandler)
    this.listeners.push({ event: 'progress', handler: progressHandler })

    // agent_thinking 事件
    const thinkingHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'agent_thinking', data })
      } catch (err) {
        console.error('[SSEService] agent_thinking 事件解析错误:', err)
      }
    }
    es.addEventListener('agent_thinking', thinkingHandler)
    this.listeners.push({ event: 'agent_thinking', handler: thinkingHandler })

    // agent_tool_call 事件
    const toolCallHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'agent_tool_call', data })
      } catch (err) {
        console.error('[SSEService] agent_tool_call 事件解析错误:', err)
      }
    }
    es.addEventListener('agent_tool_call', toolCallHandler)
    this.listeners.push({ event: 'agent_tool_call', handler: toolCallHandler })

    // agent_tool_result 事件
    const toolResultHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'agent_tool_result', data })
      } catch (err) {
        console.error('[SSEService] agent_tool_result 事件解析错误:', err)
      }
    }
    es.addEventListener('agent_tool_result', toolResultHandler)
    this.listeners.push({ event: 'agent_tool_result', handler: toolResultHandler })

    // heartbeat 事件
    const heartbeatHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'heartbeat', data })
      } catch (err) {
        console.error('[SSEService] heartbeat 事件解析错误:', err)
      }
    }
    es.addEventListener('heartbeat', heartbeatHandler)
    this.listeners.push({ event: 'heartbeat', handler: heartbeatHandler })

    // done 事件
    const doneHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'done', data })
      } catch (err) {
        console.error('[SSEService] done 事件解析错误:', err)
      }
    }
    es.addEventListener('done', doneHandler)
    this.listeners.push({ event: 'done', handler: doneHandler })

    // error 事件
    const errorEventHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'error', data })
      } catch (err) {
        console.error('[SSEService] error 事件解析错误:', err)
      }
    }
    es.addEventListener('error', errorEventHandler)
    this.listeners.push({ event: 'error', handler: errorEventHandler })

    // disconnect 事件
    const disconnectHandler: EventListener = (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        this.handleSSEMessage({ type: 'disconnect', data })
      } catch (err) {
        console.error('[SSEService] disconnect 事件解析错误:', err)
      }
    }
    es.addEventListener('disconnect', disconnectHandler)
    this.listeners.push({ event: 'disconnect', handler: disconnectHandler })
  }

  /**
   * 移除所有事件监听器
   */
  private unregisterEventListeners(): void {
    if (!this.eventSource) {
      return
    }

    // 移除所有监听器
    for (const { event, handler } of this.listeners) {
      this.eventSource.removeEventListener(event, handler)
    }

    // 清空监听器列表
    this.listeners = []
  }

  /**
   * 处理 SSE 消息
   * 使用 requestAnimationFrame 节流 UI 更新
   * @param data 消息数据
   */
  private handleSSEMessage(data: any): void {
    // 构造消息对象
    const message: SSEMessage = {
      type: data.type || data.event || 'unknown',
      data: data.data || data,
      timestamp: data.timestamp || Date.now(),
    }

    console.log('[SSEService] handleSSEMessage 收到消息:', message.type, '| data:', JSON.stringify(message.data).substring(0, 100))

    // 添加到待处理队列
    this.pendingUpdates.push(message)

    // 使用 requestAnimationFrame 节流 UI 更新
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        // 批量处理所有待更新的消息
        for (const msg of this.pendingUpdates) {
          this.processMessage(msg)
        }

        // 清空队列
        this.pendingUpdates = []
        this.rafId = null
      })
    }

    // 触发消息回调
    if (this.onMessage) {
      this.onMessage(message)
    }
  }

  /**
   * 处理单条消息
   * @param message SSE 消息
   */
  private processMessage(message: SSEMessage): void {
    switch (message.type) {
      case 'connected':
        console.log('[SSEService] 连接成功:', message.data)
        break

      case 'log':
        if (this.onLog && message.data) {
          this.onLog({
            id: Date.now(),
            timestamp: message.data.timestamp || new Date().toISOString(),
            level: message.data.level || 'info',
            message: message.data.message || '',
          })
        }
        break

      case 'progress':
        if (this.onProgress && message.data) {
          this.onProgress({
            phase: message.data.phase || '',
            message: message.data.message || '',
            extra: message.data,
          })
        }
        break

      case 'agent_thinking':
        if (this.onAgentThinking && message.data) {
          this.onAgentThinking(message.data.content || '')
        }
        break

      case 'agent_tool_call':
        if (this.onAgentToolCall && message.data) {
          this.onAgentToolCall(message.data.tool || '', message.data.args)
        }
        break

      case 'agent_tool_result':
        if (this.onAgentToolResult && message.data) {
          this.onAgentToolResult(message.data.tool || '', message.data.result)
        }
        break

      case 'heartbeat':
        // 心跳消息，仅用于保持连接
        break

      case 'done':
        if (this.onDone && message.data) {
          this.onDone(message.data.result)
        }
        // 分析完成后，断开 SSE 连接
        this.disconnect()
        break

      case 'error':
        if (this.onError && message.data) {
          this.onError(message.data.message || '未知错误')
        }
        this._error = new Error(message.data?.message || '未知错误')
        this._state = 'error'
        this.notifyStateChange()
        break

      case 'disconnect':
        console.log('[SSEService] 服务器请求断开连接:', message.data)
        this.disconnect()
        break

      default:
        console.warn('[SSEService] 未知消息类型:', message.type)
    }
  }

  /**
   * 通知状态变化
   */
  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this._state, this._error)
    }
  }

  /**
   * 切换到 IPC 轮询降级模式
   */
  private fallbackToPollingMode(): void {
    if (this.fallbackToPolling) {
      return
    }

    console.log('[SSEService] 切换到 IPC 轮询降级模式')
    this.fallbackToPolling = true

    // 断开 SSE 连接
    this.disconnect()

    // 启动 IPC 轮询
    this.startPolling()
  }

  /**
   * 启动 IPC 轮询
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      return
    }

    console.log('[SSEService] 启动 IPC 轮询，lastLogId:', this.lastLogId)
    this.pollingInterval = window.setInterval(async () => {
      try {
        // 这里需要通过 IPC 获取日志
        // 注意：需要在外部注入 ipc 调用方法
        if (this.onPollingTick) {
          await this.onPollingTick(this.lastLogId)
        }
      } catch (err) {
        console.error('[SSEService] 轮询失败:', err)
      }
    }, 500) // 每 500ms 轮询一次
  }

  /**
   * 停止 IPC 轮询
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
      console.log('[SSEService] IPC 轮询已停止')
    }
  }

  /**
   * 轮询回调（需要外部注入）
   */
  public onPollingTick?: (lastLogId: number) => Promise<void>

  /**
   * 更新最后日志 ID
   * @param logId 日志 ID
   */
  updateLastLogId(logId: number): void {
    this.lastLogId = logId
  }
}

/**
 * 创建 SSE 服务实例
 * @param url SSE 服务器 URL
 * @param config 额外配置
 * @returns SSE 服务实例
 */
export function createSSEService(url: string, config?: Partial<SSEServiceConfig>): SSEService {
  return new SSEService({ url, ...config })
}
