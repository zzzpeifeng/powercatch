/**
 * SSE 管理器（独立模块，避免循环依赖）
 * 负责 SSE 服务器生命周期和事件推送
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

/** 获取缓冲区中的日志（从 lastId 之后的） */
export function getBufferedLogs(lastId: number = 0): { logs: typeof logBuffer; lastId: number } {
  const logs = logBuffer.filter(l => l.id > lastId)
  return { logs, lastId: logIdCounter }
}

/**
 * 启动 SSE 服务器
 * @param port 端口号（默认 3001）
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
        // 设置 SSE 响应头
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })

        // 发送初始消息
        pushToClient(res, 'connected', { message: '连接成功' })

        // 将客户端添加到集合
        sseClients.add(res)
        console.log(`[SSE] 客户端连接，当前连接数: ${sseClients.size}`)

        // 注意：不在连接时自动发送缓冲日志，改为前端主动请求（防止重连时重复发送）

        // 客户端断开连接时，从集合中移除
        req.on('close', () => {
          sseClients.delete(res)
          console.log(`[SSE] 客户端断开，当前连接数: ${sseClients.size}`)
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

    // 向所有客户端发送关闭消息
    pushSSEEvent('disconnect', { message: '服务器关闭' })

    // 关闭所有客户端连接
    for (const client of sseClients) {
      try {
        client.end()
      } catch (e) {
        // ignore
      }
    }
    sseClients.clear()

    // 关闭服务器
    sseServer.close(() => {
      console.log('[SSE] 服务器已停止')
      sseServer = null
      resolve()
    })
  })
}

/**
 * 推送 SSE 事件到所有连接的客户端
 * @param event 事件类型（log/progress/done/error/connected/disconnect）
 * @param data 事件数据
 */
export function pushSSEEvent(event: string, data: any): void {
  if (sseClients.size === 0) {
    return
  }

  const message = JSON.stringify({
    event,
    data,
    timestamp: Date.now(),
  })

  const eventString = `data: ${message}\n\n`

  for (const client of sseClients) {
    try {
      client.write(eventString)
    } catch (e) {
      // 客户端已断开，移除
      sseClients.delete(client)
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
 * 推送分析完成事件
 * @param result 分析结果
 */
export function pushDone(result: any): void {
  pushSSEEvent('done', {
    result,
  })
}

/**
 * 推送分析错误事件
 * @param message 错误信息
 */
export function pushError(message: string): void {
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
  const message = JSON.stringify({
    event,
    data,
    timestamp: Date.now(),
  })

  const eventString = `data: ${message}\n\n`

  try {
    client.write(eventString)
  } catch (e) {
    // ignore
  }
}
