/**
 * http-mitm-proxy 封装
 * HTTP/HTTPS 中间人代理，解密流量并回传请求/响应数据
 */
import { Proxy as HttpMitmProxy } from 'http-mitm-proxy'
import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { getSslCaDir, ensureSslCaDir, cleanupOldCACerts, getCACertPath } from './ca-cert'
import {
  IPC_CHANNELS,
  type CaptureRequest,
  type HttpMethod,
  type ProxyStatus,
  type BreakpointRule,
  type InterceptSession,
  type BreakpointResumePayload,
  type BreakpointStatus,
  type MapLocalRule,
  type MapRemoteRule,
  type AutoResponderRule,
  type RewriteRule,
  type DnsOverrideRule,
  type Cookie,
} from '../../src/services/types'
import { parseSetCookieHeader, cookiesToHeader } from '../../src/utils/cookie-parser'
import { networkInterfaces } from 'os'
import { SSLErrorClassifier, SSLErrorFormatter, type SSLErrorDetail } from '../services/ssl-error-handler'
import { SSLErrorLogger } from '../services/ssl-logger'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib'
import { findMatchingRule } from '../../src/utils/breakpoint-matcher'
import { matchMapLocal } from '../../src/utils/map-local-matcher'
import { matchMapRemote } from '../../src/utils/map-remote-matcher'
import { matchAutoResponder } from '../../src/utils/auto-responder-matcher'
import { matchRewriteRules } from '../../src/utils/rewrite-matcher'
import { matchDnsOverride } from '../../src/utils/dns-override-matcher'
import { readFileSync } from 'fs'
import { extname } from 'path'
import * as sqlite from '../db/sqlite'

let proxyInstance: any = null
let proxyStatus: ProxyStatus = 'stopped'
let mainWindow: BrowserWindow | null = null
let domainFilters: string[] = []
let deviceAliases: Record<string, string> = {}
let requestCounter: number = 0
let currentPort: number = 8888

// 断点相关状态
let breakpointRules: BreakpointRule[] = []

// Map Local 相关状态
let mapLocalRules: MapLocalRule[] = []

// Map Remote 相关状态
let mapRemoteRules: MapRemoteRule[] = []

// Auto Responder 相关状态
let autoResponderRules: AutoResponderRule[] = []

// Rewrite Rules 相关状态
let rewriteRules: RewriteRule[] = []

// DNS 覆盖相关状态
let dnsOverrideRules: DnsOverrideRule[] = []

// Cookie 相关状态
let cookieStore: Cookie[] = []
const pendingInterceptions = new Map<string, {
  resolve: (modified: InterceptSession) => void
  reject: (reason: string) => void
}>()

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
 * 设置断点规则
 */
export function setBreakpointRules(rules: BreakpointRule[]): void {
  breakpointRules = rules.filter(r => r.enabled)
}

/**
 * 设置 Map Local 规则
 */
export function setMapLocalRules(rules: MapLocalRule[]): void {
  mapLocalRules = rules.filter(r => r.enabled)
}

/**
 * 设置 Map Remote 规则
 */
export function setMapRemoteRules(rules: MapRemoteRule[]): void {
  mapRemoteRules = rules.filter(r => r.enabled)
}

/**
 * 设置 Auto Responder 规则
 */
export function setAutoResponderRules(rules: AutoResponderRule[]): void {
  autoResponderRules = rules.filter(r => r.enabled)
}

/**
 * 设置 Rewrite Rules 规则
 */
export function setRewriteRules(rules: RewriteRule[]): void {
  rewriteRules = rules.filter(r => r.enabled)
}

/**
 * 设置 DNS 覆盖规则
 */
export function setDnsOverrideRules(rules: DnsOverrideRule[]): void {
  dnsOverrideRules = rules.filter(r => r.enabled)
}

/**
 * 设置 Cookie Store（供 IPC 层调用）
 * @param cookies Cookie 列表
 */
export function setCookieStore(cookies: Cookie[]): void {
  cookieStore = cookies
}

/**
 * 中止所有待处理的拦截
 */
export function abortAllPendingInterceptions(): void {
  for (const [id, { reject }] of pendingInterceptions) {
    reject('aborted')
  }
  pendingInterceptions.clear()
}

/**
 * 恢复断点拦截（放行）
 * 由 ipc.ts 的 BREAKPOINT_RESUME handler 调用
 */
export function resolveBreakpointResume(sessionId: string, modified: InterceptSession): void {
  const pending = pendingInterceptions.get(sessionId)
  if (pending) {
    pending.resolve(modified)
    pendingInterceptions.delete(sessionId)
  }
}

/**
 * 中止断点拦截（丢弃）
 * 由 ipc.ts 的 BREAKPOINT_ABORT handler 调用
 */
export function rejectBreakpointResume(sessionId: string): void {
  const pending = pendingInterceptions.get(sessionId)
  if (pending) {
    pending.reject('aborted')
    pendingInterceptions.delete(sessionId)
  }
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
 * 生成会话 ID
 */
function generateSessionId(): string {
  return `bp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 等待断点恢复
 */
function waitForBreakpointResume(sessionId: string): Promise<InterceptSession> {
  return new Promise((resolve, reject) => {
    // 设置 5 分钟超时
    const timeout = setTimeout(() => {
      pendingInterceptions.delete(sessionId)
      reject('timeout')
    }, 5 * 60 * 1000)

    pendingInterceptions.set(sessionId, {
      resolve: (modified) => {
        clearTimeout(timeout)
        resolve(modified)
      },
      reject: (reason) => {
        clearTimeout(timeout)
        reject(reason)
      },
    })
  })
}

/**
 * 推送断点状态更新到前端
 */
function pushBreakpointStatus(requestId: string, status: BreakpointStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_STATUS_UPDATE, {
      requestId,
      status,
    })
  }
}

/**
 * 创建拦截会话
 */
function createInterceptSession(params: {
  ruleId: string
  stage: 'request' | 'response'
  method?: HttpMethod
  url?: string
  requestHeaders?: Record<string, any>
  requestBody?: string
  statusCode?: number
  responseHeaders?: Record<string, any>
  responseBody?: string
}): InterceptSession {
  const id = generateSessionId()
  const now = new Date().toISOString()

  const data = {
    method: (params.method || 'GET') as HttpMethod,
    url: params.url || '',
    requestHeaders: params.requestHeaders || {},
    requestBody: params.requestBody || '',
    statusCode: params.statusCode,
    responseHeaders: params.responseHeaders,
    responseBody: params.responseBody,
  }

  return {
    id,
    ruleId: params.ruleId,
    stage: params.stage,
    editable: { ...data },
    original: { ...data },
    status: 'waiting',
    interceptedAt: now,
  }
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

  // 无压缩或解压失败：尝试 UTF-8 解码
  // 已知文本类型直接解码，跳过二进制检测（避免误判合法 UTF-8 多字节序列）
  const contentType = (headers['content-type'] || headers['Content-Type'] || '').split(';')[0].trim()
  const textContentTypePatterns = [
    'application/json',
    'text/',
    'application/xml',
    'application/xhtml+xml',
    'application/javascript',
    'application/css',
    'application/x-www-form-urlencoded',
    'application/graphql',
  ]
  const isKnownTextType = textContentTypePatterns.some(p =>
    contentType === p || (p.endsWith('/') && contentType.startsWith(p.replace(/\/$/, '')))
  )
  if (isKnownTextType) {
    return buffer.toString('utf-8')
  }

  // 未知类型 → 做二进制检测（启发式）
  const preview = buffer.slice(0, 8000)
  const isLikelyBinary = preview.some((byte, i) => {
    if (byte === 0) return true
    if (byte > 0x7f && i + 1 < preview.length && preview[i + 1] > 0x7f) {
      if (byte < 0xc0 || byte > 0xf7) return true
    }
    return false
  })

  if (isLikelyBinary) {
    const ct = contentType || 'application/octet-stream'
    if (buffer.length <= 5 * 1024 * 1024) {
      return `[Base64:${ct}:${buffer.length}:${buffer.toString('base64')}]`
    }
    return `[Body too large: ${buffer.length} bytes, Content-Type: ${ct}]`
  }

  return buffer.toString('utf-8')
}

/**
 * 根据 content-encoding 解压请求体（客户端发送压缩数据的情况较少见）
 * 修复：对齐 decodeResponseBody 的逻辑 —— 先尝试解压，再做二进制检测
 * 支持：有 Content-Encoding 头的压缩 / 无头但实际 gzip 的数据 / 普通文本
 */
function decodeRequestBody(buffer: Buffer, headers: Record<string, any>): string {
  const encoding = (headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase()
  const contentType = (headers['content-type'] || headers['Content-Type'] || '').split(';')[0].trim()

  // 调试日志：打印请求体前 50 字节的 hex + 可读字符
  const previewLen = Math.min(buffer.length, 50)
  const hexPreview = Array.from(buffer.slice(0, previewLen)).map(b => b.toString(16).padStart(2, '0')).join(' ')
  const asciiPreview = Array.from(buffer.slice(0, previewLen)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('')
  console.log(`[decodeRequestBody] buffer.length=${buffer.length}, encoding="${encoding}", contentType="${contentType}"`)
  console.log(`[decodeRequestBody] first ${previewLen} bytes hex: ${hexPreview}`)
  console.log(`[decodeRequestBody] first ${previewLen} bytes ascii: ${asciiPreview}`)

  // 第一步：尝试解压（有 Content-Encoding 头 或 检测到 gzip/deflate 魔术字节）
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
  const isDeflate = buffer.length >= 2 && buffer[0] === 0x78 && (buffer[1] === 0x01 || buffer[1] === 0x5e || buffer[1] === 0x9c || buffer[1] === 0xda)
  console.log(`[decodeRequestBody] isGzip=${isGzip}, isDeflate=${isDeflate}`)

  if (encoding.includes('gzip') || (!encoding && isGzip)) {
    try {
      const decompressed = gunzipSync(buffer).toString('utf-8')
      console.log(`[decodeRequestBody] gzip 解压成功，解码后长度=${decompressed.length}，前100字符: ${decompressed.slice(0, 100)}`)
      return decompressed
    } catch (e) {
      console.warn('[Proxy] 请求体 gzip 解压失败，尝试原始解码:', (e as Error).message)
    }
  }
  if (encoding.includes('deflate') || (!encoding && isDeflate)) {
    try {
      const decompressed = inflateSync(buffer).toString('utf-8')
      console.log(`[decodeRequestBody] deflate 解压成功，解码后长度=${decompressed.length}`)
      return decompressed
    } catch (e) {
      console.warn('[Proxy] 请求体 deflate 解压失败，尝试原始解码:', (e as Error).message)
    }
  }
  if (encoding.includes('br')) {
    try {
      const decompressed = brotliDecompressSync(buffer).toString('utf-8')
      console.log(`[decodeRequestBody] brotli 解压成功，解码后长度=${decompressed.length}`)
      return decompressed
    } catch (e) {
      console.warn('[Proxy] 请求体 brotli 解压失败，尝试原始解码:', (e as Error).message)
    }
  }

  // 第二步：已知文本类型直接 UTF-8 解码，跳过二进制检测
  // 修复：原 isLikelyBinary 逻辑会把合法 UTF-8 多字节序列的后续字节（0x80-0xbf）误判为二进制
  const textContentTypePatterns = [
    'application/json',
    'text/',
    'application/xml',
    'application/xhtml+xml',
    'application/javascript',
    'application/css',
    'application/x-www-form-urlencoded',
    'application/graphql',
  ]
  const isKnownTextType = textContentTypePatterns.some(p =>
    contentType === p || (p.endsWith('/') && contentType.startsWith(p.replace(/\/$/, '')))
  )
  if (isKnownTextType) {
    const result = buffer.toString('utf-8')
    console.log(`[decodeRequestBody] 已知文本类型"${contentType}"，直接 UTF-8 解码，前100字符: ${result.slice(0, 100)}`)
    return result
  }

  // 第三步：未知类型 → 做二进制检测（对齐 decodeResponseBody 逻辑）
  const isLikelyBinary = buffer.some((byte, i) => {
    if (byte === 0) return true
    if (byte > 0x7f && i + 1 < buffer.length && buffer[i + 1] > 0x7f) {
      if (byte < 0xc0 || byte > 0xf7) return true
    }
    return false
  })
  console.log(`[decodeRequestBody] isLikelyBinary=${isLikelyBinary}, 最终处理: ${isLikelyBinary ? 'Base64(HEX模式)' : 'UTF-8文本'}`)
  if (isLikelyBinary) {
    if (buffer.length <= 5 * 1024 * 1024) {
      return `[Base64:${contentType || 'application/octet-stream'}:${buffer.length}:${buffer.toString('base64')}]`
    }
    return `[Body too large: ${buffer.length} bytes, Content-Type: ${contentType || 'application/octet-stream'}]`
  }
  const result = buffer.toString('utf-8')
  console.log(`[decodeRequestBody] UTF-8解码成功，前100字符: ${result.slice(0, 100)}`)
  return result
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

// ===== Map Local 文件读取 =====

/** 内置 MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
}

/** 文本 MIME 类型（可直接转 UTF-8 string） */
const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/javascript', 'application/xml', 'application/x-www-form-urlencoded']

function getMimeType(filePath: string, customMime: string): string {
  if (customMime) return customMime
  const ext = extname(filePath).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))
}

/**
 * 应用路径替换（v1 简化方案：全路径替换，保留 query string）
 */
function applyPathReplacement(originalPath: string, replacement: string): string {
  const qIndex = originalPath.indexOf('?')
  const pathname = qIndex >= 0 ? originalPath.substring(0, qIndex) : originalPath
  const search = qIndex >= 0 ? originalPath.substring(qIndex) : ''
  return replacement + search
}

/**
 * 读取本地文件
 * - content: 用于存储在 CaptureRequest.responseBody（文本=原文，二进制=[Base64:...]）
 * - rawBuffer: 原始 Buffer，用于发送给客户端（不做 [Base64:...] 编码）
 */
function readLocalFile(localPath: string, customMime: string): { content: string; mimeType: string; isBinary: boolean; rawBuffer: Buffer } {
  const mimeType = getMimeType(localPath, customMime)
  const buffer = readFileSync(localPath)

  if (isTextMime(mimeType)) {
    return { content: buffer.toString('utf-8'), mimeType, isBinary: false, rawBuffer: buffer }
  } else {
    // 二进制文件：content 编码为 [Base64:...] 格式（用于 responseBody 存储）
    const base64 = buffer.toString('base64')
    const contentType = mimeType.split(';')[0]
    const header = `[Base64:${contentType}:${buffer.length}:`
    return { content: header + base64 + ']', mimeType, isBinary: true, rawBuffer: buffer }
  }
}

/**
 * 在请求到达时推送（部分数据，等响应回来再更新）
 * 返回一个 requestId 用于后续更新
 * @param mapLocalRuleId 可选，Map Local 规则 ID
 * @param mapRemoteRuleId 可选，Map Remote 规则 ID
 * @param autoResponderRuleId 可选，Auto Responder 规则 ID
 * @param rewriteRuleIds 可选，Rewrite Rules 规则 ID 数组
 */
function pushRequestArrived(method: string, url: string, path: string, host: string, clientIp: string, mapLocalRuleId?: string, mapRemoteRuleId?: string, autoResponderRuleId?: string, rewriteRuleIds?: string[]): string {
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
    mapLocalRuleId,
    mapRemoteRuleId,
    autoResponderRuleId,
    rewriteRuleIds,
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

      // 跳过 CONNECT 方法和 WebSocket 升级
      if (method === 'CONNECT') return callback()
      const upgradeHeader = ctx.clientToProxyRequest?.headers?.upgrade
      if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') return callback()

      // ===== DNS 覆盖检查（最高优先级，在所有规则之前） =====
      const dnsMatch = matchDnsOverride(host, dnsOverrideRules)
      if (dnsMatch) {
        // 修改代理目标地址为规则中的 IP
        ctx.proxyToServerRequestOptions.host = dnsMatch.ip
        // 保持 Host 头为原始域名（让服务器正确路由）
        if (!ctx.proxyToServerRequestOptions.headers) {
          ctx.proxyToServerRequestOptions.headers = {}
        }
        ctx.proxyToServerRequestOptions.headers.host = host
        console.log(`[DNS Override] 🎯 ${host} → ${dnsMatch.ip}`)
      }

      // ===== Map Local 检查（优先于断点） =====
      const mapLocalMatch = matchMapLocal(url, method, mapLocalRules)
      if (mapLocalMatch) {
        try {
          const { content, mimeType, isBinary, rawBuffer } = readLocalFile(mapLocalMatch.localPath, mapLocalMatch.mimeType)

          // 收集请求头和请求体
          const reqHeaders: Record<string, string> = {}
          ctx.clientToProxyRequest.forEach((value: string, key: string) => { reqHeaders[key] = value })
          const requestBody = ctx._requestBody || ''

          // 推送请求数据到渲染进程
          const mapLocalRequestId = pushRequestArrived(method, url, ctx._path, ctx._host, clientIp, mapLocalMatch.id)

          // 推送响应数据到渲染进程
          pushResponseArrived(
            mapLocalRequestId,
            200,
            0,
            { 'content-type': mimeType },
            content,
            reqHeaders,
            requestBody
          )

          // 构造响应返回给客户端（使用 chunked encoding）
          const res = ctx.proxyToClientResponse
          res.writeHead(200, {
            'content-type': mimeType,
            'transfer-encoding': 'chunked',
          })
          res.end(rawBuffer)

          // 不调用 callback()，请求已处理完毕
          return
        } catch (error) {
          // 文件读取失败：返回 404
          console.error(`[Map Local] 文件读取失败: ${mapLocalMatch.localPath}`, error)
          const res = ctx.proxyToClientResponse
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end(`Map Local: file not found: ${mapLocalMatch.localPath}`)
          return
        }
      }

      // ===== Auto Responder 检查（Map Local 之后、Map Remote 之前） =====
      const autoResponderMatch = matchAutoResponder(url, method, autoResponderRules)
      if (autoResponderMatch) {
        try {
          const { statusCode, headers, body, delay } = autoResponderMatch.response

          // 收集请求头和请求体
          const reqHeaders: Record<string, string> = {}
          ctx.clientToProxyRequest.forEach((value: string, key: string) => { reqHeaders[key] = value })
          const requestBody = ctx._requestBody || ''

          // 推送请求数据到渲染进程
          const autoResponderRequestId = pushRequestArrived(method, url, ctx._path, ctx._host, clientIp, undefined, undefined, autoResponderMatch.id)

          // 延迟响应（如果配置了）
          // 注意：http-mitm-proxy 的回调不支持 async/await，使用 setTimeout 包装
          const sendResponse = () => {
            // 推送响应数据到渲染进程
            pushResponseArrived(
              autoResponderRequestId,
              statusCode,
              0,
              headers,
              body,
              reqHeaders,
              requestBody
            )

            // 构造响应返回给客户端
            const res = ctx.proxyToClientResponse
            res.writeHead(statusCode, {
              ...headers,
              'transfer-encoding': 'chunked',
            })
            res.end(body)
          }

          // 根据延迟配置执行响应
          if (delay > 0) {
            setTimeout(sendResponse, delay)
          } else {
            sendResponse()
          }

          // 标记为已处理，跳过后续流程
          return
        } catch (error) {
          console.error('[Auto Responder] 处理失败:', error)
          // 降级：继续正常流程
        }
      }

      // ===== Map Remote 检查（Auto Responder 之后、Rewrite Rules 之前） =====
      const mapRemoteMatch = matchMapRemote(url, method, mapRemoteRules)
      if (mapRemoteMatch) {
        const { target } = mapRemoteMatch

        // 修改目标地址
        ctx.proxyToServerRequestOptions.host = target.host
        ctx.proxyToServerRequestOptions.port = target.port || (target.protocol === 'https' ? 443 : 80)

        // 修改路径（路径替换）
        if (target.pathReplacement) {
          const originalPath = ctx.proxyToServerRequestOptions.path || '/'
          ctx.proxyToServerRequestOptions.path = applyPathReplacement(originalPath, target.pathReplacement)
        }

        // 修改请求头中的 Host（使用 proxyToServerRequestOptions，不用 clientToProxyRequest）
        ctx.proxyToServerRequestOptions.headers = {
          ...ctx.proxyToServerRequestOptions.headers,
          host: target.host,
        }

        // TLS 协议切换
        if (target.protocol === 'https' && !isSSL) {
          ctx.proxyToServerRequestOptions.ssl = true
        } else if (target.protocol === 'http' && isSSL) {
          ctx.proxyToServerRequestOptions.ssl = false
        }

        // 标记请求（用于 UI 显示 + onRequestEnd 中传递 mapRemoteRuleId）
        ctx._mapRemoteRuleId = mapRemoteMatch.id
        ctx._mapRemoteTarget = `${target.protocol}://${target.host}${target.port ? ':' + target.port : ''}`

        console.log(`[Map Remote] 🎯 规则命中: ${mapRemoteMatch.name} → ${ctx._mapRemoteTarget}`)

        // 继续正常流程（调用 callback()，让 proxy 继续处理请求转发）
        // onRequestEnd 中的 pushRequestArrived() 会处理推送，传入 ctx._mapRemoteRuleId
        return callback()
      }

      // ===== Rewrite Rules 检查（Map Remote 之后、Breakpoint 之前） =====
      const rewriteMatches = matchRewriteRules(url, method, rewriteRules)
      if (rewriteMatches.length > 0) {
        const rewriteRuleIds: string[] = []

        for (const rule of rewriteMatches) {
          const { rewrite } = rule

          // URL 重写
          if (rewrite.url) {
            try {
              const currentPath = ctx.proxyToServerRequestOptions.path || '/'
              const newPath = currentPath.replace(
                new RegExp(rewrite.url.pattern), rewrite.url.replacement
              )
              ctx.proxyToServerRequestOptions.path = newPath
            } catch (e) {
              console.error('[Rewrite Rules] URL rewrite error:', e)
            }
          }

          // 请求头修改（使用 proxyToServerRequestOptions.headers）
          if (rewrite.requestHeaders) {
            const { add, remove, modify } = rewrite.requestHeaders
            // 确保 headers 对象存在
            if (!ctx.proxyToServerRequestOptions.headers) {
              ctx.proxyToServerRequestOptions.headers = {}
            }
            // 添加请求头
            for (const [key, value] of Object.entries(add || {})) {
              ctx.proxyToServerRequestOptions.headers[key.toLowerCase()] = value
            }
            // 删除请求头
            for (const key of remove || []) {
              delete ctx.proxyToServerRequestOptions.headers[key.toLowerCase()]
            }
            // 修改请求头
            for (const [key, value] of Object.entries(modify || {})) {
              ctx.proxyToServerRequestOptions.headers[key.toLowerCase()] = value
            }
          }

          // 请求体修改（在 onRequestEnd 中处理）
          if (rewrite.requestBody) {
            ctx._rewriteRequestBody = rewrite.requestBody
          }

          // 响应头修改（在 onResponse 中处理）
          if (rewrite.responseHeaders) {
            if (!ctx._rewriteResponseHeaders) {
              ctx._rewriteResponseHeaders = []
            }
            ctx._rewriteResponseHeaders.push(rewrite.responseHeaders)
          }

          // 响应体修改（在 onResponse 中处理）
          if (rewrite.responseBody) {
            if (!ctx._rewriteResponseBody) {
              ctx._rewriteResponseBody = []
            }
            ctx._rewriteResponseBody.push(rewrite.responseBody)
          }

          // 状态码覆盖（在 onResponse 中处理）
          if (rewrite.statusCode) {
            ctx._rewriteStatusCode = rewrite.statusCode
          }

          rewriteRuleIds.push(rule.id)
        }

        // 记录命中的规则 ID
        ctx._rewriteRuleIds = rewriteRuleIds
        console.log(`[Rewrite Rules] 🎯 命中 ${rewriteMatches.length} 条规则`)
      }

      // 检查是否命中断点规则
      const breakpointMatch = findMatchingRule(url, method, breakpointRules)
      ctx._breakpointMatched = breakpointMatch !== null
      ctx._breakpointRule = breakpointMatch
      ctx._breakpointStage = breakpointMatch?.stage || null

      // 请求阶段断点拦截
      if (breakpointMatch && (breakpointMatch.stage === 'request' || breakpointMatch.stage === 'both')) {
        console.log(`[Breakpoint] 🎯 请求阶段断点命中: ${breakpointMatch.name}`)

        // 收集请求体
        const requestChunks: Buffer[] = []

        ctx.onRequestData((ctx: any, chunk: Buffer, cb: any) => {
          requestChunks.push(chunk)
          // 不转发，我们在 onRequestEnd 中处理
          return cb()
        })

        ctx.onRequestEnd(async (ctx: any, cb: any) => {
          try {
            const rawBody = Buffer.concat(requestChunks)
            const reqHeaders = ctx.clientToProxyRequest?.headers || {}
            const decodedBody = decodeRequestBody(rawBody, reqHeaders)

            // 创建拦截会话
            const session = createInterceptSession({
              ruleId: breakpointMatch.id,
              stage: 'request',
              method,
              url,
              requestHeaders: reqHeaders,
              requestBody: decodedBody,
            })

            // 立即推送到前端（显示"拦截中"状态）
            ctx._requestId = pushRequestArrived(method, url, ctx._path, ctx._host, clientIp)
            pushBreakpointStatus(ctx._requestId, 'intercepting')

            // 发送拦截事件到前端
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
            }

            // 等待用户编辑
            const modified = await waitForBreakpointResume(session.id)

            // 【关键】在 callback() 之前应用所有修改
            // 修改 URL（仅 path+query，不能改 host）
            if (ctx.proxyToServerRequestOptions) {
              try {
                const parsedUrl = new URL(modified.editable.url)
                ctx.proxyToServerRequestOptions.path = parsedUrl.pathname + parsedUrl.search
              } catch {
                // URL 解析失败，保持原样
              }

              // 修改 Method
              ctx.proxyToServerRequestOptions.method = modified.editable.method

              // 修改 Headers
              ctx.proxyToServerRequestOptions.headers = { ...modified.editable.requestHeaders }

              // 移除 Content-Encoding（不重新压缩）
              delete ctx.proxyToServerRequestOptions.headers['content-encoding']
              delete ctx.proxyToServerRequestOptions.headers['transfer-encoding']

              // 使用 chunked transfer encoding
              delete ctx.proxyToServerRequestOptions.headers['content-length']
              ctx.proxyToServerRequestOptions.headers['transfer-encoding'] = 'chunked'
            }

            // 设置 onRequestData — 不转发原始数据
            ctx.onRequestData((_ctx: any, _chunk: Buffer, cb: any) => {
              return cb()
            })

            // 设置 onRequestEnd — 写入修改后的 body
            ctx.onRequestEnd((ctx: any, cb: any) => {
              const newBody = Buffer.from(modified.editable.requestBody)
              if (ctx.proxyToServerRequest && newBody.length > 0) {
                ctx.proxyToServerRequest.write(newBody)
                ctx.proxyToServerRequest.end()
              }
              pushBreakpointStatus(ctx._requestId, 'resumed')
              // 不调用 cb()，因为我们已经手动结束了请求
            })

            // 【关键】现在才调用 callback() — headers 带着修改发送到 Server
            callback()

          } catch (reason) {
            if (reason === 'aborted' || reason === 'timeout') {
              console.log(`[Breakpoint] 请求被${reason === 'aborted' ? '丢弃' : '超时'}: ${url}`)
              ctx.proxyToClientResponse.destroy()
              ctx.proxyToServerRequest?.destroy()
              if (ctx._requestId) {
                pushBreakpointStatus(ctx._requestId, 'aborted')
              }
              // 不调用 callback，请求终止
            } else {
              console.error('[Breakpoint] 意外错误:', reason)
              // 降级：放行原始请求
              callback()
            }
          }
        })

        // 【关键】不调用 callback，请求暂停
        return
      }

      // ===== 非断点请求：原有流程 =====

      // ===== Cookie 注入 =====
      if (cookieStore.length > 0 && host) {
        const path = ctx._path || '/'
        const matchingCookies = cookieStore.filter(c => {
          // 域名匹配（支持 .example.com 匹配 example.com）
          const domainMatch = c.domain === host ||
            (c.domain.startsWith('.') && host.endsWith(c.domain))
          // 路径匹配
          const pathMatch = path.startsWith(c.path)
          // 过期时间检查
          const notExpired = !c.expires || new Date(c.expires) > new Date()

          return domainMatch && pathMatch && notExpired
        })

        if (matchingCookies.length > 0) {
          if (!ctx.proxyToServerRequestOptions) {
            ctx.proxyToServerRequestOptions = {}
          }
          if (!ctx.proxyToServerRequestOptions.headers) {
            ctx.proxyToServerRequestOptions.headers = {}
          }
          const existingCookie = ctx.proxyToServerRequestOptions.headers.cookie || ''
          const newCookie = cookiesToHeader(matchingCookies)
          // 合并 Cookie（Store 的优先）
          ctx.proxyToServerRequestOptions.headers.cookie = newCookie + (existingCookie ? '; ' + existingCookie : '')
          console.log(`[Cookie] 注入 ${matchingCookies.length} 个 Cookie 到 ${host}`)
        }
      }

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

        // 应用 Rewrite Rules 请求体修改
        if (ctx._rewriteRequestBody) {
          const { pattern, replacement, fullReplace } = ctx._rewriteRequestBody
          if (fullReplace !== undefined) {
            ctx._requestBody = fullReplace
          } else if (pattern && replacement !== undefined) {
            try {
              ctx._requestBody = (ctx._requestBody || '').replace(new RegExp(pattern, 'g'), replacement)
            } catch (e) {
              console.error('[Rewrite Rules] Request body replace error:', e)
            }
          }
        }

        // 请求已到达代理，立即推送到前端（状态码 null，等响应回来再更新）
        ctx._requestId = pushRequestArrived(
          ctx._method || 'GET',
          ctx._url || '',
          ctx._path || '',
          ctx._host || '',
          ctx._clientIp || 'unknown',
          undefined,              // mapLocalRuleId（正常流程无 Map Local 命中）
          ctx._mapRemoteRuleId,   // mapRemoteRuleId（可能为 undefined）
          undefined,              // autoResponderRuleId
          ctx._rewriteRuleIds,    // rewriteRuleIds（可能为 undefined）
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

      // ===== Set-Cookie 提取 =====
      const setCookie = ctx.serverToProxyResponse?.headers?.['set-cookie']
      if (setCookie && ctx._host) {
        try {
          const newCookies = parseSetCookieHeader(setCookie, ctx._host)
          if (newCookies.length > 0) {
            // 更新内存 Cookie Store
            for (const cookie of newCookies) {
              const key = `${cookie.domain}:${cookie.path}:${cookie.name}`
              const index = cookieStore.findIndex(
                c => `${c.domain}:${c.path}:${c.name}` === key
              )
              if (index !== -1) {
                cookieStore[index] = cookie
              } else {
                cookieStore.push(cookie)
              }
            }
            // 持久化到数据库
            try {
              sqlite.importCookies(newCookies)
            } catch (dbErr) {
              console.error('[Cookie] 持久化 Set-Cookie 失败:', dbErr)
            }
            console.log(`[Cookie] 从 ${ctx._host} 提取 ${newCookies.length} 个 Set-Cookie`)
          }
        } catch (e) {
          console.error('[Cookie] Set-Cookie 解析错误:', e)
        }
      }

      // 检查响应阶段断点
      const shouldInterceptResponse = ctx._breakpointMatched && 
        (ctx._breakpointStage === 'response' || ctx._breakpointStage === 'both') &&
        !ctx._breakpointAborted

      if (shouldInterceptResponse) {
        console.log(`[Breakpoint] 🎯 响应阶段断点命中: ${ctx._breakpointRule?.name}`)

        // 收集响应体
        ctx.onResponseData((ctx: any, chunk: Buffer, cb: any) => {
          responseChunks.push(chunk)
          // 不转发
          return cb()
        })

        ctx.onResponseEnd(async (ctx: any, cb: any) => {
          try {
            const rawBody = Buffer.concat(responseChunks)
            const statusCode = ctx.serverToProxyResponse?.statusCode || 200
            const respHeaders = ctx.serverToProxyResponse?.headers || {}
            const decodedBody = decodeResponseBody(rawBody, respHeaders)

            const session = createInterceptSession({
              ruleId: ctx._breakpointRule.id,
              stage: 'response',
              statusCode,
              responseHeaders: respHeaders,
              responseBody: decodedBody,
              // 包含请求阶段数据（可能已修改）
              method: ctx._method,
              url: ctx._url,
              requestHeaders: ctx._requestHeaders,
              requestBody: ctx._requestBody,
            })

            if (ctx._requestId) {
              pushBreakpointStatus(ctx._requestId, 'intercepting')
            }

            // 发送拦截事件到前端
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
            }

            const modified = await waitForBreakpointResume(session.id)

            // 【关键】在 callback() 之前应用响应修改
            if (ctx.serverToProxyResponse) {
              ctx.serverToProxyResponse.statusCode = modified.editable.statusCode || statusCode
              ctx.serverToProxyResponse.headers = { ...modified.editable.responseHeaders }
              // 移除 Content-Encoding（不重新压缩）
              delete ctx.serverToProxyResponse.headers['content-encoding']
              delete ctx.serverToProxyResponse.headers['transfer-encoding']
              // 使用 chunked transfer encoding
              delete ctx.serverToProxyResponse.headers['content-length']
              ctx.serverToProxyResponse.headers['transfer-encoding'] = 'chunked'
            }

            // 设置 onResponseData — 不转发原始数据
            ctx.onResponseData((_ctx: any, _chunk: Buffer, cb: any) => {
              return cb()
            })

            // 设置 onResponseEnd — 写入修改后的响应体
            ctx.onResponseEnd((ctx: any, cb: any) => {
              const newBody = Buffer.from(modified.editable.responseBody || '')
              if (ctx.proxyToClientResponse && newBody.length > 0) {
                ctx.proxyToClientResponse.write(newBody)
                ctx.proxyToClientResponse.end()
              }
              if (ctx._requestId) {
                pushBreakpointStatus(ctx._requestId, 'resumed')
              }
              // 不调用 cb()
            })

            // 现在才调用 callback() — 响应头带着修改发送到 Client
            callback()

          } catch (reason) {
            if (reason === 'aborted' || reason === 'timeout') {
              console.log(`[Breakpoint] 响应被${reason === 'aborted' ? '丢弃' : '超时'}: ${url}`)
              ctx.proxyToClientResponse.destroy()
              if (ctx._requestId) {
                pushBreakpointStatus(ctx._requestId, 'aborted')
              }
            } else {
              console.error('[Breakpoint] 响应拦截错误:', reason)
              callback()
            }
          }
        })

        return // 不调用 callback()
      }

      // ===== 非断点响应：原有流程 =====
      ctx.onResponseData((ctx: any, chunk: Buffer, callback: any) => {
        responseChunks.push(chunk)
        return callback(null, chunk)
      })

      ctx.onResponseEnd((ctx: any, callback: any) => {
        const duration = ctx._startTime ? Date.now() - ctx._startTime : 0
        let statusCode = ctx.serverToProxyResponse?.statusCode || null
        const rawResponseBody = Buffer.concat(responseChunks)
        let responseHeaders = ctx.serverToProxyResponse?.headers || {}
        let responseBody = decodeResponseBody(rawResponseBody, responseHeaders)

        // 应用 Rewrite Rules 响应修改
        // 状态码覆盖
        if (ctx._rewriteStatusCode) {
          statusCode = ctx._rewriteStatusCode
        }

        // 响应头修改
        if (ctx._rewriteResponseHeaders && ctx._rewriteResponseHeaders.length > 0) {
          const headers = { ...responseHeaders }
          for (const rewrite of ctx._rewriteResponseHeaders) {
            const { add, remove, modify } = rewrite
            // 添加响应头
            for (const [key, value] of Object.entries(add || {})) {
              headers[key.toLowerCase()] = value
            }
            // 删除响应头
            for (const key of remove || []) {
              delete headers[key.toLowerCase()]
            }
            // 修改响应头
            for (const [key, value] of Object.entries(modify || {})) {
              headers[key.toLowerCase()] = value
            }
          }
          responseHeaders = headers
        }

        // 响应体修改
        if (ctx._rewriteResponseBody && ctx._rewriteResponseBody.length > 0) {
          let body = responseBody
          for (const rewrite of ctx._rewriteResponseBody) {
            const { pattern, replacement, fullReplace } = rewrite
            if (fullReplace !== undefined) {
              body = fullReplace
            } else if (pattern && replacement !== undefined) {
              try {
                body = body.replace(new RegExp(pattern, 'g'), replacement)
              } catch (e) {
                console.error('[Rewrite Rules] Response body replace error:', e)
              }
            }
          }
          responseBody = body
        }

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

  // 先 abort 所有 pending interceptions
  abortAllPendingInterceptions()

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
