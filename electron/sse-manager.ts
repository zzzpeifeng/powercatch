/**
 * SSE 管理器（独立模块，避免循环依赖）
 * 负责 SSE 服务器生命周期和事件推送
 * 严格遵循 SSE 规范：https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
import * as http from 'http'

/** SSE 客户端连接集合 */
const sseClients: Set<http.ServerResponse> = new Set()

/** SSE 服务器实例 */
let sseServer: http.Server | null = null

/** SSE 服务器端口 */
let ssePort = 3001

/** 日志缓冲区（用于 IPC 轮询降级方案） */
const logBuffer: Array<{ id: number; timestamp: string; level: string; message: string }> = []
let logIdCounter = 0

/** 心跳定时器 */
let heartbeatInterval: NodeJS.Timeout | null = null

/** 空闲超时定时器（每个客户端独立） */
const idleTimers: Map<http.ServerResponse, NodeJS.Timeout> = new Map()

/** 空闲超时时间（10分钟） */
const IDLE_TIMEOUT = 10 * 60 * 1000

/** 心跳间隔（30秒） */
const HEARTBEAT_INTERVAL = 30 * 1000

/** Token 缓冲区（用于批量推送） */
let tokenBuffer: string[] = []
let bufferTimeout: NodeJS.Timeout | null = null
const BUFFER_FLUSH_SIZE = 10
const BUFFER_FLUSH_TIMEOUT = 500

/**
 * 转义 JSON 字符串中的特殊字符
 * @param str 输入字符串
 * @returns 转义后的字符串
 */
function escapeJSON(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * 获取缓冲区中的日志（从 lastId 之后的）
 * @param lastId 上次获取的日志 ID
 * @returns 日志列表和最新的日志 ID
 */
export function getBufferedLogs(lastId: number = 0): { logs: typeof logBuffer; lastId: number } {
  const logs = logBuffer.filter(l => l.id > lastId)
  return { logs, lastId: logIdCounter }
}

/**
 * 启动 SSE 服务器
 * @param port 端口号（默认 3001）
 * @returns 实际的端口号
 */
export function startSSEServer(port?: number): Promise<number> {
  if (sseServer) {
    console.warn('[SSE] 服务器已启动，跳过')
    return Promise.resolve(ssePort)
  }

  ssePort = port || 3001

  return new Promise((resolve, reject) => {
    sseServer = http.createServer((req, res) => {
      const url = req.url || '/'
      const method = req.method || 'GET'

      // 设置 CORS 头
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // SSE 端点：/ai-analysis-progress
      if (url.startsWith('/ai-analysis-progress') && method === 'GET') {
        // 设置 SSE 响应头（严格遵循 SSE 规范）
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
        })

        // 发送重试间隔（3秒后重连）
        res.write('retry: 3000\n\n')

        // 发送初始连接成功消息
        pushToClient(res, 'connected', { message: '连接成功' })

        // 将客户端添加到集合
        sseClients.add(res)
        console.log(`[SSE] 客户端连接，当前连接数: ${sseClients.size}`)

        // 启动心跳（如果还没启动）
        startHeartbeat()

        // 设置空闲超时
        setIdleTimeout(res)

        // 客户端断开连接时，从集合中移除
        req.on('close', () => {
          sseClients.delete(res)
          clearIdleTimeout(res)
          console.log(`[SSE] 客户端断开，当前连接数: ${sseClients.size}`)

          // 如果没有客户端了，停止心跳
          if (sseClients.size === 0) {
            stopHeartbeat()
          }
        })

        // 监听写入错误
        res.on('error', (err) => {
          console.error('[SSE] 写入错误:', err.message)
          sseClients.delete(res)
          clearIdleTimeout(res)
        })
      } else {
        // 404 其他路径
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not Found' }))
      }
    })

    sseServer.listen(ssePort, () => {
      console.log(`[SSE] 服务器已启动，监听端口: ${ssePort}`)
      console.log(`[SSE] 端点: http://localhost:${ssePort}/ai-analysis-progress`)
      resolve(ssePort)
    })

    sseServer.on('error', (error: Error) => {
      console.error('[SSE] 服务器错误:', error.message)
      reject(error)
    })
  })
}

/**
 * 停止 SSE 服务器
 */
export function stopSSEServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!sseServer) {
      resolve()
      return
    }

    // 停止心跳
    stopHeartbeat()

    // 清空 token 缓冲区
    flushTokenBuffer()

    // 向所有客户端发送关闭消息
    pushSSEEvent('disconnect', { message: '服务器关闭' })

    // 关闭所有客户端连接
    for (const client of sseClients) {
      try {
        clearIdleTimeout(client)
        client.end()
      } catch (e) {
        // ignore
      }
    }
    sseClients.clear()

    // 清理所有空闲定时器
    for (const [, timer] of idleTimers) {
      clearTimeout(timer)
    }
    idleTimers.clear()

    // 关闭服务器
    sseServer.close(() => {
      console.log('[SSE] 服务器已停止')
      sseServer = null
      resolve()
    })
  })
}

/**
 * 启动心跳定时器
 */
function startHeartbeat(): void {
  if (heartbeatInterval) {
    return
  }

  heartbeatInterval = setInterval(() => {
    if (sseClients.size > 0) {
      pushSSEEvent('heartbeat', { timestamp: Date.now() })
    } else {
      stopHeartbeat()
    }
  }, HEARTBEAT_INTERVAL)

  console.log(`[SSE] 心跳已启动，间隔: ${HEARTBEAT_INTERVAL}ms`)
}

/**
 * 停止心跳定时器
 */
function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
    console.log('[SSE] 心跳已停止')
  }
}

/**
 * 设置空闲超时
 * @param client 客户端响应对象
 */
function setIdleTimeout(client: http.ServerResponse): void {
  // 先清除旧的定时器
  clearIdleTimeout(client)

  const timer = setTimeout(() => {
    console.log('[SSE] 空闲超时，关闭连接')
    sseClients.delete(client)
    clearIdleTimeout(client)
    try {
      client.end()
    } catch (e) {
      // ignore
    }

    // 如果没有客户端了，停止心跳
    if (sseClients.size === 0) {
      stopHeartbeat()
    }
  }, IDLE_TIMEOUT)

  idleTimers.set(client, timer)
}

/**
 * 清除空闲超时
 * @param client 客户端响应对象
 */
function clearIdleTimeout(client: http.ServerResponse): void {
  const timer = idleTimers.get(client)
  if (timer) {
    clearTimeout(timer)
    idleTimers.delete(client)
  }
}

/**
 * 重置空闲超时（每次有活动时调用）
 * @param client 客户端响应对象
 */
function resetIdleTimeout(client: http.ServerResponse): void {
  setIdleTimeout(client)
}

/**
 * 推送 SSE 事件到所有连接的客户端
 * 严格遵循 SSE 规范：每个事件以 `data:` 开头，以 `\n\n` 结尾
 * @param event 事件类型
 * @param data 事件数据
 */
export function pushSSEEvent(event: string, data: any): void {
  if (sseClients.size === 0) {
    return
  }

  // 构造 SSE 格式的消息
  // 规范格式：
  // event: <event-name>\n
  // data: <json-data>\n\n
  const jsonData = JSON.stringify(data)
  const eventString = `event: ${event}\n` +
                     `data: ${jsonData}\n\n`

  // 重置每个客户端的空闲超时
  for (const client of sseClients) {
    try {
      resetIdleTimeout(client)
      client.write(eventString)
    } catch (e) {
      // 客户端已断开，移除
      sseClients.delete(client)
      clearIdleTimeout(client)
    }
  }
}

/**
 * 推送进度消息（便捷方法）
 * @param phase 分析阶段
 * @param message 进度消息
 * @param extra 额外数据
 */
export function pushProgress(phase: string, message: string, extra?: any): void {
  pushSSEEvent('progress', {
    phase,
    message,
    ...extra,
  })
}

/**
 * 推送日志消息（便捷方法）
 * @param level 日志级别
 * @param message 日志消息
 */
export function pushLog(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
  console.log(`[pushLog] 写入日志缓冲区: [${level}] ${message}`)

  // 添加到缓冲区（用于 IPC 轮询降级）
  logBuffer.push({
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    level,
    message,
  })
  console.log(`[pushLog] 缓冲区当前条数: ${logBuffer.length}`)

  // 限制缓冲区大小
  if (logBuffer.length > 1000) {
    logBuffer.splice(0, logBuffer.length - 1000)
  }

  pushSSEEvent('log', {
    level,
    message,
  })
}

/**
 * 推送 AI Agent 思考过程（流式输出）
 * 使用批量缓冲机制，避免高频推送导致客户端积压
 * @param content 思考内容（可能是部分内容）
 */
export function pushAgentThinking(content: string): void {
  // 添加到缓冲区
  tokenBuffer.push(content)

  // 达到批量大小或超时时推送
  if (tokenBuffer.length >= BUFFER_FLUSH_SIZE) {
    flushTokenBuffer()
  } else if (!bufferTimeout) {
    // 设置超时定时器
    bufferTimeout = setTimeout(() => {
      flushTokenBuffer()
    }, BUFFER_FLUSH_TIMEOUT)
  }
}

/**
 * 立即刷新 token 缓冲区
 */
function flushTokenBuffer(): void {
  if (tokenBuffer.length === 0) {
    return
  }

  // 合并所有缓冲的 token
  const content = tokenBuffer.join('')
  tokenBuffer = []

  // 清除定时器
  if (bufferTimeout) {
    clearTimeout(bufferTimeout)
    bufferTimeout = null
  }

  // 推送事件
  pushSSEEvent('agent_thinking', { content })
}

/**
 * 推送 AI Agent 工具调用事件
 * @param tool 工具名称
 * @param args 工具参数
 */
export function pushAgentToolCall(tool: string, args?: any): void {
  pushSSEEvent('agent_tool_call', { tool, args })
}

/**
 * 推送 AI Agent 工具结果事件
 * @param tool 工具名称
 * @param result 工具执行结果
 */
export function pushAgentToolResult(tool: string, result: any): void {
  pushSSEEvent('agent_tool_result', { tool, result })
}

/**
 * 推送分析完成事件
 * @param result 分析结果
 */
export function pushDone(result: any): void {
  // 先刷新缓冲区，确保所有内容都已推送
  flushTokenBuffer()

  pushSSEEvent('done', {
    result,
  })
}

/**
 * 推送分析错误事件
 * @param message 错误信息
 */
export function pushError(message: string): void {
  // 先刷新缓冲区
  flushTokenBuffer()

  pushSSEEvent('error', {
    message,
  })
}

/**
 * 获取 SSE 服务器端口号
 * @returns 端口号
 */
export function getSSEPort(): number {
  return ssePort
}

/**
 * 推送消息到单个客户端
 * @param client 客户端响应对象
 * @param event 事件类型
 * @param data 事件数据
 */
function pushToClient(client: http.ServerResponse, event: string, data: any): void {
  const jsonData = JSON.stringify(data)
  const eventString = `event: ${event}\n` +
                     `data: ${jsonData}\n\n`

  try {
    resetIdleTimeout(client)
    client.write(eventString)
  } catch (e) {
    // ignore
  }
}
