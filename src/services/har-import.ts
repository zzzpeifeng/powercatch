/**
 * HAR 导入服务
 * 将 HAR 1.2 格式文件导入为 PowerCatch CaptureRequest 数组
 * 兼容 Chrome DevTools、Firefox、Fiddler、Charles 等工具导出的 HAR
 */
import type { CaptureRequest, HttpMethod, HttpHeaders } from './types'

// ============================================================
// HAR 类型定义（导入用，字段可能缺失）
// ============================================================

interface HarHeader {
  name: string
  value: string
}

interface HarQueryString {
  name: string
  value: string
}

interface HarRequest {
  method: string
  url: string
  httpVersion?: string
  headers?: HarHeader[]
  queryString?: HarQueryString[]
  postData?: {
    mimeType?: string
    text?: string
    params?: Array<{ name: string; value: string }>
  }
  bodySize?: number
}

interface HarResponse {
  status: number
  statusText?: string
  httpVersion?: string
  headers?: HarHeader[]
  content: {
    size?: number
    mimeType?: string
    text?: string
    encoding?: string
  }
  bodySize?: number
}

interface HarTimings {
  send?: number
  wait?: number
  receive?: number
  blocked?: number
  dns?: number
  connect?: number
  ssl?: number
}

interface HarEntry {
  startedDateTime?: string
  time?: number
  request: HarRequest
  response: HarResponse
  timings?: HarTimings
  cache?: any
  connection?: string
  comment?: string
}

interface HarLog {
  version?: string
  creator?: { name?: string; version?: string }
  entries?: HarEntry[]
}

interface HarFile {
  log?: HarLog
  // 某些工具可能直接在根级放置 entries
  entries?: HarEntry[]
}

// ============================================================
// 工具函数
// ============================================================

/** HAR headers 数组转 HttpHeaders 对象 */
function toHttpHeaders(headers?: HarHeader[]): HttpHeaders {
  if (!headers || !Array.isArray(headers)) return {}
  const result: HttpHeaders = {}
  for (const h of headers) {
    if (h && h.name) {
      const key = h.name
      const value = h.value ?? ''
      // 如果已存在同名 header，合并为数组
      if (result[key] !== undefined) {
        const existing = result[key]
        if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          result[key] = [String(existing), value]
        }
      } else {
        result[key] = value
      }
    }
  }
  return result
}

/** 生成唯一 ID */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 从 URL 中提取 host */
function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** 从 URL 中提取 path（含 query string） */
function extractPath(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    const qIndex = url.indexOf('?')
    return qIndex >= 0 ? url.slice(0, qIndex) : url
  }
}

/** 验证 HTTP 方法 */
function isValidMethod(method: string): method is HttpMethod {
  const valid: string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
  return valid.includes(method.toUpperCase())
}

/** 从 postData 提取请求体 */
function extractRequestBody(entry: HarEntry): string {
  const postData = entry.request.postData
  if (!postData) return ''

  // 优先使用 text 字段
  if (postData.text) return postData.text

  // 某些工具将参数放在 params 中
  if (postData.params && postData.params.length > 0) {
    const params = new URLSearchParams()
    for (const p of postData.params) {
      params.append(p.name, p.value)
    }
    return params.toString()
  }

  return ''
}

/** 计算总耗时 */
function calcDuration(entry: HarEntry): number | null {
  // 优先使用顶层 time
  if (entry.time !== undefined && entry.time !== null && entry.time >= 0) {
    return Math.round(entry.time)
  }
  // 从 timings 计算
  const t = entry.timings
  if (t) {
    const parts = [t.blocked, t.dns, t.connect, t.ssl, t.send, t.wait, t.receive]
    const total = parts.reduce<number>((sum, v) => sum + (v && v > 0 ? v : 0), 0)
    return total > 0 ? Math.round(total) : null
  }
  return null
}

/** 提取响应体文本 */
function extractResponseBody(entry: HarEntry): string {
  const content = entry.response.content
  if (!content) return ''

  // 处理 base64 编码的响应
  if (content.encoding === 'base64' && content.text) {
    try {
      return atob(content.text)
    } catch {
      return content.text
    }
  }

  return content.text || ''
}

// ============================================================
// 核心解析函数
// ============================================================

/**
 * 解析 HAR 文件内容为 CaptureRequest 数组
 * @param harContent HAR 文件的 JSON 字符串内容
 * @returns 解析后的 CaptureRequest 数组
 * @throws Error 当 HAR 格式无效时
 */
export function parseHarContent(harContent: string): CaptureRequest[] {
  let har: HarFile
  try {
    har = JSON.parse(harContent)
  } catch {
    throw new Error('无效的 HAR 文件：JSON 解析失败')
  }

  // 兼容不同格式：有些工具直接在根级放置 entries
  const log = har.log
  const entries: HarEntry[] | undefined = log?.entries || har.entries

  if (!entries || !Array.isArray(entries)) {
    throw new Error('无效的 HAR 文件：缺少 entries 数组')
  }

  if (entries.length === 0) {
    return []
  }

  const requests: CaptureRequest[] = []

  for (const entry of entries) {
    // 跳过无效条目
    if (!entry || !entry.request || !entry.response) continue

    const req = entry.request
    const res = entry.response

    // URL 是必须的
    if (!req.url) continue

    // 方法必须有效，否则默认 GET
    const method = isValidMethod(req.method) ? req.method.toUpperCase() as HttpMethod : 'GET'

    const capturedAt = entry.startedDateTime || new Date().toISOString()
    const duration = calcDuration(entry)
    const host = extractHost(req.url)
    const path = extractPath(req.url)

    const captureRequest: CaptureRequest = {
      id: generateId(),
      method,
      url: req.url,
      path,
      host,
      statusCode: res.status ?? null,
      duration,
      requestHeaders: toHttpHeaders(req.headers),
      requestBody: extractRequestBody(entry),
      responseHeaders: toHttpHeaders(res.headers),
      responseBody: extractResponseBody(entry),
      clientIp: '',
      deviceName: 'HAR Import',
      capturedAt,
      isRecorded: false,
      selected: false,
      checked: false,
    }

    requests.push(captureRequest)
  }

  return requests
}

/**
 * 通过文件选择器导入 HAR 文件
 * 打开系统文件对话框，读取用户选择的 .har 文件
 * @returns 解析后的 CaptureRequest 数组
 */
export function importHarFile(): Promise<CaptureRequest[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.har,.json'

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('未选择文件'))
        return
      }

      try {
        const text = await file.text()
        const requests = parseHarContent(text)
        resolve(requests)
      } catch (error: any) {
        reject(new Error(`导入失败: ${error.message}`))
      }
    }

    input.oncancel = () => {
      reject(new Error('已取消'))
    }

    input.click()
  })
}
