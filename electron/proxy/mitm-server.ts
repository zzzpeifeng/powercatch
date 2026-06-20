/**
 * http-mitm-proxy 封装
 * HTTP/HTTPS 中间人代理，解密流量并回传请求/响应数据
 */
import { Proxy as HttpMitmProxy } from 'http-mitm-proxy'
import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { getSslCaDir, ensureSslCaDir, cleanupOldCACerts, getCACertPath } from './ca-cert'
import { IPC_CHANNELS, type CaptureRequest, type HttpMethod, type ProxyStatus } from '../../src/services/types'
import { networkInterfaces } from 'os'
import { SSLErrorClassifier, SSLErrorFormatter, type SSLErrorDetail } from '../services/ssl-error-handler'
import { SSLErrorLogger } from '../services/ssl-logger'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib'

let proxyInstance: any = null
let proxyStatus: ProxyStatus = 'stopped'
let mainWindow: BrowserWindow | null = null
let domainFilters: string[] = []
let deviceAliases: Record<string, string> = {}
let requestCounter: number = 0
let currentPort: number = 8888

/**
 * 获取本机局域网 IP
 * 优先返回局域网 IP（192.168.x.x、10.x.x.x、172.16-31.x.x）
 * 避免使用 VPN 或虚拟网络的 IP（如 198.19.x.x、100.64-127.x.x 等）
 */
export function getLocalIP(): string {
  const interfaces = networkInterfaces()
  
  // 优先查找局域网 IP
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        const addr = alias.address
        // 局域网 IP 范围
        if (addr.startsWith('192.168.') || 
            addr.startsWith('10.') || 
            isPrivateIP(addr)) {
          return addr
        }
      }
    }
  }
  
  // 如果没找到局域网 IP，返回第一个非内部 IPv4 地址
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address
      }
    }
  }
  
  return '127.0.0.1'
}

/**
 * 检查是否为局域网 IP
 * 局域网 IP 范围：
 * - 192.168.0.0/16
 * - 10.0.0.0/8
 * - 172.16.0.0/12
 */
function isPrivateIP(addr: string): boolean {
  if (addr.startsWith('172.')) {
    const secondOctet = parseInt(addr.split('.')[1])
    return secondOctet >= 16 && secondOctet <= 31
  }
  return false
}

/**
 * 域名匹配逻辑（OR 匹配，支持 * 通配符 glob 风格）
 * 与 src/stores/request-store.ts 中的 filteredRequests 逻辑保持一致
 */
function matchDomain(host: string, filters: string[]): boolean {
  if (filters.length === 0) return true // 无过滤器时匹配所有

  return filters.some((filter) => {
    // 通配符匹配：支持 * 作为任意字符通配符
    if (filter.includes('*')) {
      const pattern = filter
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符（保留 *）
        .replace(/\*/g, '.*')                   // * → 匹配任意字符
      return new RegExp(`^${pattern}$`, 'i').test(host)
    }
    // 精确匹配
    return host === filter
  })
}

/**
 * 设置域名过滤器
 */
export function setDomainFilters(filters: string[]): void {
  domainFilters = filters
}

/**
 * 设置设备别名
 */
export function setDeviceAliases(aliases: Record<string, string>): void {
  deviceAliases = aliases
}

/**
 * 获取设备名称
 */
function getDeviceName(clientIp: string): string {
  return deviceAliases[clientIp] || clientIp
}

/**
 * 生成请求唯一 ID
 */
function generateRequestId(): string {
  requestCounter++
  return `req_${Date.now()}_${requestCounter}`
}

/**
 * 解析 URL 路径
 */
function parseUrlPath(url: string): string {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).pathname
    }
    // 相对路径
    const queryIndex = url.indexOf('?')
    return queryIndex >= 0 ? url.slice(0, queryIndex) : url
  } catch {
    return url
  }
}

/**
 * 解析 URL host
 */
function parseUrlHost(url: string): string {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).hostname
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * 根据 content-encoding 解压响应体
 * 如果解压失败或编码不支持，返回原始 buffer 的 base64 字符串（带前缀标记）
 */
function decodeResponseBody(buffer: Buffer, headers: Record<string, any>): string {
  const encoding = (headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase()

  try {
    if (encoding.includes('gzip')) {
      return gunzipSync(buffer).toString('utf-8')
    }
    if (encoding.includes('deflate')) {
      return inflateSync(buffer).toString('utf-8')
    }
    if (encoding.includes('br')) {
      return brotliDecompressSync(buffer).toString('utf-8')
    }
  } catch (e) {
    // 解压失败，可能是多次压缩或数据损坏，fall through 尝试作为原始文本
    console.warn('[Proxy] 响应体解压失败，尝试原始解码:', (e as Error).message)
  }

  // 无压缩或解压失败：尝试 utf-8 解码
  // 先检测是否为二进制数据（简单启发式：含大量非 UTF-8 字节）
  const preview = buffer.slice(0, 8000)
  const isLikelyBinary = preview.some((byte, i) => {
    // 检测 null 字节（二进制文件特征）或无效 UTF-8 序列
    if (byte === 0) return true
    // 检测大量连续非 ASCII 且非 UTF-8 的字节
    if (byte > 0x7f && i + 1 < preview.length && preview[i + 1] > 0x7f) {
      // 简单检测：如果不是合法的 UTF-8 序列起始字节，可能是二进制
      if (byte < 0xc0 || byte > 0xf7) return true
    }
    return false
  })

  if (isLikelyBinary) {
    // 标记为二进制数据，前端会显示友好提示
    return `[Binary Data: ${buffer.length} bytes, Content-Type: ${headers['content-type'] || headers['Content-Type'] || 'unknown'}]`
  }

  return buffer.toString('utf-8')
}

/**
 * 根据 content-encoding 解压请求体（客户端发送压缩数据的情况较少见）
 */
function decodeRequestBody(buffer: Buffer, headers: Record<string, any>): string {
  const encoding = (headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase()
  if (!encoding || encoding === 'identity') {
    // 检测是否为二进制数据
    const isLikelyBinary = buffer.some((byte, i) => {
      if (byte === 0) return true
      if (byte > 0x7f && i + 1 < buffer.length && buffer[i + 1] > 0x7f) {
        if (byte < 0xc0 || byte > 0xf7) return true
      }
      return false
    })
    if (isLikelyBinary) {
      return `[Binary Request Body: ${buffer.length} bytes]`
    }
    return buffer.toString('utf-8')
  }
  // 尝试解压（客户端压缩请求体较少见，尽力而为）
  try {
    if (encoding.includes('gzip')) return gunzipSync(buffer).toString('utf-8')
    if (encoding.includes('deflate')) return inflateSync(buffer).toString('utf-8')
    if (encoding.includes('br')) return brotliDecompressSync(buffer).toString('utf-8')
  } catch (e) {
    console.warn('[Proxy] 请求体解压失败:', (e as Error).message)
  }
  return `[Compressed Request Body: ${buffer.length} bytes, encoding: ${encoding}]`
}

/**
 * 将请求数据推送到前端
 * @param request 完整请求数据
 * @param isUpdate 是否为更新（响应已到达，更新已有请求）
 */
function pushToRenderer(request: CaptureRequest, isUpdate: boolean = false): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[Proxy] ⚠️ mainWindow 不存在或已销毁，无法发送数据到前端')
    return
  }
  try {
    mainWindow.webContents.send(IPC_CHANNELS.PROXY_NEW_REQUEST, { ...request, _isUpdate: isUpdate })
    console.log(`[Proxy] 📤 发送成功: ${request.method} ${request.url} (ID: ${request.id})`)
  } catch (e) {
    console.error(`[Proxy] 📤 发送失败: ${request.id}`, e)
  }
}

/**
 * 在请求到达时推送（部分数据，等响应回来再更新）
 * 返回一个 requestId 用于后续更新
 */
function pushRequestArrived(method: string, url: string, path: string, host: string, clientIp: string): string {
  const id = generateRequestId()
  const now = Date.now()
  const partial: CaptureRequest = {
    id,
    method: method as any,
    url,
    path,
    host,
    statusCode: null,
    duration: 0,
    requestHeaders: {},
    requestBody: '',
    responseHeaders: {},
    responseBody: '',
    clientIp,
    deviceName: getDeviceName(clientIp),
    capturedAt: new Date().toISOString(),
    isRecorded: true,
    selected: false,
    checked: false,
    _arrivedAt: now,
  }
  pushToRenderer(partial, false)
  return id
}

/**
 * 在响应到达时更新已有请求
 * 通过独立 channel 发送，避免类型污染 CaptureRequest
 */
function pushResponseArrived(id: string, statusCode: number | null, duration: number, responseHeaders: Record<string, any>, responseBody: string, requestHeaders: Record<string, any>, requestBody: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.PROXY_REQUEST_UPDATED, {
      id,
      statusCode,
      duration,
      requestHeaders,
      requestBody,
      responseHeaders,
      responseBody,
    })
  }
}

/**
 * 启动代理服务
 * @param port 代理端口
 * @param win 主窗口引用
 * @returns 是否启动成功
 */
export async function startProxy(port: number, win: BrowserWindow): Promise<boolean> {
  if (proxyStatus === 'running' || proxyStatus === 'starting') {
    return true
  }

  proxyStatus = 'starting'
  mainWindow = win
  currentPort = port

  // 确保 sslCaDir 目录存在，并清理旧版证书文件
  // http-mitm-proxy 会在 proxy.listen() 时自动生成 CA 证书
  cleanupOldCACerts()
  ensureSslCaDir()

  try {
    // 创建代理实例
    const proxy = new HttpMitmProxy()

    // SSL 中间件配置
    proxy.sslCaDir = getSslCaDir()
    
    // 调试日志：打印 sslCaDir
    console.log('[Proxy] sslCaDir:', proxy.sslCaDir)
    console.log('[Proxy] CA 证书路径:', getCACertPath())

    // 请求拦截
    proxy.onRequest((ctx: any, callback: any) => {
      const clientIp = ctx.clientToProxyRequest.socket?.remoteAddress || 'unknown'
      const rawUrl = ctx.clientToProxyRequest.url || ''
      const host = ctx.clientToProxyRequest.headers?.host || parseUrlHost(rawUrl)
      const method = (ctx.clientToProxyRequest.method || 'GET').toUpperCase() as HttpMethod

      // 检测 SSL 连接（HTTPS MITM 场景）
      const isSSL = ctx.isSSL === true ||
                    (ctx.clientToProxyRequest.socket as any)?.encrypted === true ||
                    (ctx.clientToProxyRequest.connection as any)?.encrypted === true

      // 构建完整 URL（确保包含协议前缀）
      let url = rawUrl
      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        const protocol = isSSL ? 'https://' : 'http://'
        url = `${protocol}${host}${rawUrl}`
      }

      // 调试日志：记录收到的请求
      console.log(`[Proxy] 📥 收到请求: ${method} ${url} (来自: ${clientIp})`)

      // 始终记录基础字段，供 onResponseEnd 使用
      ctx._startTime = Date.now()
      ctx._clientIp = clientIp
      ctx._method = method
      ctx._url = url
      ctx._host = host
      ctx._path = parseUrlPath(url)
      ctx._domainMatched = matchDomain(host, domainFilters)

      // 收集请求体（仅匹配域名的请求，节省内存）
      const requestChunks: Buffer[] = []
      ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
        if (ctx._domainMatched) {
          requestChunks.push(chunk)
        }
        return callback(null, chunk)
      })

      ctx.onRequestEnd((ctx: any, callback: any) => {
        if (ctx._domainMatched) {
          const rawRequestBuffer = Buffer.concat(requestChunks)
          const reqHeaders = ctx.clientToProxyRequest?.headers || {}
          ctx._requestHeaders = reqHeaders
          ctx._requestBody = decodeRequestBody(rawRequestBuffer, reqHeaders)
        }
        // 请求已到达代理，立即推送到前端（状态码 null，等响应回来再更新）
        ctx._requestId = pushRequestArrived(
          ctx._method || 'GET',
          ctx._url || '',
          ctx._path || '',
          ctx._host || '',
          ctx._clientIp || 'unknown',
        )
        return callback()
      })

      return callback()
    })

    // 响应拦截
    proxy.onResponse((ctx: any, callback: any) => {
      const responseChunks: Buffer[] = []
      
      // 调试日志：记录响应
      const url = ctx.clientToProxyRequest?.url || ctx._url || 'unknown'
      console.log(`[Proxy] 📤 收到响应: ${url} (状态: ${ctx.serverToProxyResponse?.statusCode || 'unknown'})`)

      ctx.onResponseData((ctx: any, chunk: Buffer, callback: any) => {
        responseChunks.push(chunk)
        return callback(null, chunk)
      })

      ctx.onResponseEnd((ctx: any, callback: any) => {
        const duration = ctx._startTime ? Date.now() - ctx._startTime : 0
        const statusCode = ctx.serverToProxyResponse?.statusCode || null
        const rawResponseBody = Buffer.concat(responseChunks)
        const responseHeaders = ctx.serverToProxyResponse?.headers || {}
        const responseBody = decodeResponseBody(rawResponseBody, responseHeaders)

        // 响应已到达，更新已有请求（而非推送新请求）
        if (ctx._requestId) {
          pushResponseArrived(
            ctx._requestId,
            statusCode,
            duration,
            responseHeaders,
            responseBody,
            ctx._requestHeaders || {},
            ctx._requestBody || '',
          )
        } else {
          // 降级：理论上不会走到这里（onRequestEnd 一定会设置 _requestId）
          // 若因异常未设置，则推送一条完整新请求
          const fallback: CaptureRequest = {
            id: generateRequestId(),
            method: ctx._method || 'GET',
            url: ctx._url || '',
            path: ctx._path || '',
            host: ctx._host || '',
            statusCode,
            duration,
            requestHeaders: ctx._requestHeaders || {},
            requestBody: ctx._requestBody || '',
            responseHeaders,
            responseBody,
            clientIp: ctx._clientIp || 'unknown',
            deviceName: getDeviceName(ctx._clientIp || ''),
            capturedAt: new Date().toISOString(),
            isRecorded: true,
            selected: false,
            checked: false,
          }
          pushToRenderer(fallback, false)
        }

        return callback()
      })

      return callback()
    })

    // ===== SSL错误处理（关键！）=====
    const sslLogger = SSLErrorLogger.getInstance()

    // http-mitm-proxy .onError() 回调签名：(ctx, err, kind)
    // kind 是错误类型字符串，如 "HTTPS_CLIENT_ERROR", "HTTP_SERVER_ERROR" 等
    // 注意：ctx 可能是 null（如 HTTPS_CLIENT_ERROR）
    proxy.onError((ctx: any, err: any, kind: string) => {
      // 判断是否为 SSL 相关错误
      const isSslError = kind === 'HTTPS_CLIENT_ERROR' ||
                         kind === 'HTTPS_SERVER_ERROR' ||
                         err?.code?.startsWith('SSL') ||
                         err?.message?.includes('SSL') ||
                         err?.message?.includes('certificate') ||
                         err?.message?.includes('TLS')

      if (isSslError) {
        // 注意：HTTPS_CLIENT_ERROR 时 ctx 是 null，需要从 err 中获取 domain
        const domain = ctx?.clientToProxyRequest?.url ||
                       ctx?.clientToProxyRequest?.headers?.host ||
                       err?.host ||  // 某些 SSL 错误会附带 host 信息
                       'unknown'

        // 分类错误
        const errorDetail = SSLErrorClassifier.classify(err, domain)

        // 记录日志
        sslLogger.logError(errorDetail)

        // 对证书固定错误，只记录不输出（减少控制台噪音）
        if (errorDetail.type === 'CERTIFICATE_PINNING') {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.SSL_ERROR_NOTIFY, {
              ...errorDetail,
              suppressed: true,
            })
          }
        } else {
          console.warn(SSLErrorFormatter.formatShort(errorDetail))
        }
      } else {
        console.error(`Proxy error (${kind}):`, err)
      }
      // 注意：不需要调用 callback，http-mitm-proxy 的 onError handler 无回调
    })

    // 启动代理
    return new Promise<boolean>((resolve) => {
      // 超时保护：5 秒后仍未成功则视为失败
      const timeout = setTimeout(() => {
        if (proxyStatus === 'starting') {
          console.error('[Proxy] 启动超时（5秒），端口可能被占用:', port)
          proxyStatus = 'stopped'
          resolve(false)
        }
      }, 5000)

      try {
        proxy.listen({ port, host: '0.0.0.0', sslCaDir: proxy.sslCaDir }, () => {
          clearTimeout(timeout)
          proxyInstance = proxy
          proxyStatus = 'running'
          console.log('[Proxy] 启动成功，端口:', port)
          resolve(true)
        })
      } catch (listenErr) {
        clearTimeout(timeout)
        console.error('[Proxy] listen 异常:', listenErr)
        proxyStatus = 'stopped'
        resolve(false)
      }
    })
  } catch (error) {
    console.error('Failed to start proxy:', error)
    proxyStatus = 'stopped'
    return false
  }
}

/**
 * 停止代理服务
 */
export async function stopProxy(): Promise<void> {
  if (proxyStatus === 'stopped' || proxyStatus === 'stopping') {
    return
  }

  proxyStatus = 'stopping'

  if (proxyInstance) {
    try {
      proxyInstance.close()
    } catch (e) {
      console.error('Error closing proxy:', e)
    }
    proxyInstance = null
  }

  proxyStatus = 'stopped'
}

/**
 * 获取代理状态
 */
export function getProxyStatus(): { status: ProxyStatus; port: number; localIp: string } {
  return {
    status: proxyStatus,
    port: currentPort,
    localIp: getLocalIP(),
  }
}
