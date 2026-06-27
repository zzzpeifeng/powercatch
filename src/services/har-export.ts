/**
 * HAR 导出服务
 * 将 PowerCatch 抓包数据导出为 HAR 1.2 格式（HTTP Archive）
 * 兼容 Chrome DevTools、Firefox、Fiddler、Charles 等工具
 */
import type { CaptureRequest, HttpHeaders } from './types'
import { downloadFile } from './export-service'

// ============================================================
// HAR 1.2 类型定义
// ============================================================

interface HarLog {
  version: string
  creator: { name: string; version: string }
  entries: HarEntry[]
}

interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    headers: Array<{ name: string; value: string }>
    queryString: Array<{ name: string; value: string }>
    headersSize: number
    bodySize: number
    postData?: {
      mimeType: string
      text: string
    }
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    headers: Array<{ name: string; value: string }>
    content: {
      size: number
      mimeType: string
      text?: string
    }
    headersSize: number
    bodySize: number
  }
  timings: {
    send: number
    wait: number
    receive: number
  }
}

interface HarFile {
  log: HarLog
}

// ============================================================
// 工具函数
// ============================================================

/** 将 HttpHeaders 转为 HAR headers 数组 */
function toHarHeaders(headers: HttpHeaders): Array<{ name: string; value: string }> {
  if (!headers) return []
  const result: Array<{ name: string; value: string }> = []
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      result.push({ name, value: Array.isArray(value) ? value.join(', ') : String(value) })
    }
  }
  return result
}

/** 从 URL 中解析 query string */
function parseQueryString(url: string): Array<{ name: string; value: string }> {
  const result: Array<{ name: string; value: string }> = []
  try {
    const urlObj = new URL(url)
    urlObj.searchParams.forEach((value, name) => {
      result.push({ name, value })
    })
  } catch {
    // URL 解析失败，尝试手动提取
    const qIndex = url.indexOf('?')
    if (qIndex >= 0) {
      const search = url.slice(qIndex + 1)
      const params = new URLSearchParams(search)
      params.forEach((value, name) => {
        result.push({ name, value })
      })
    }
  }
  return result
}

/** 从响应头中提取 Content-Type */
function getContentType(headers: HttpHeaders, fallback: string): string {
  if (!headers) return fallback
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type' && value !== undefined) {
      return Array.isArray(value) ? value[0] : String(value)
    }
  }
  return fallback
}

/** 尝试解码 Base64 编码的请求体 */
function decodeBody(body: string): string {
  if (!body) return ''
  if (body.startsWith('[Base64:')) {
    try {
      const match = body.match(/^\[Base64:([^:]+):(\d+):(.+)\]$/s)
      if (match) {
        return atob(match[3])
      }
    } catch { /* ignore */ }
  }
  return body
}

/** HTTP 状态码对应的标准文本 */
function getStatusText(status: number): string {
  const map: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict',
    422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  }
  return map[status] || ''
}

// ============================================================
// 核心转换函数
// ============================================================

/**
 * 将 CaptureRequest 数组转换为 HAR 1.2 格式对象
 * @param requests 请求列表
 * @returns HAR 文件对象
 */
export function convertToHar(requests: CaptureRequest[]): HarFile {
  const entries: HarEntry[] = requests.map((req) => {
    const requestHeaders = toHarHeaders(req.requestHeaders)
    const responseHeaders = toHarHeaders(req.responseHeaders)
    const requestBody = decodeBody(req.requestBody)

    // 请求体大小
    const bodySize = requestBody ? new Blob([requestBody]).size : 0

    // 响应体
    const responseBody = req.responseBody || ''
    const responseMimeType = getContentType(req.responseHeaders, '')

    // 计算时间
    const startedDateTime = req.capturedAt || new Date().toISOString()
    const time = req.duration ?? 0

    const entry: HarEntry = {
      startedDateTime,
      time,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: 'HTTP/1.1',
        headers: requestHeaders,
        queryString: parseQueryString(req.url),
        headersSize: -1,
        bodySize,
        ...(requestBody ? {
          postData: {
            mimeType: getContentType(req.requestHeaders, 'application/octet-stream'),
            text: requestBody,
          },
        } : {}),
      },
      response: {
        status: req.statusCode ?? 0,
        statusText: req.statusCode ? getStatusText(req.statusCode) : '',
        httpVersion: 'HTTP/1.1',
        headers: responseHeaders,
        content: {
          size: responseBody ? new Blob([responseBody]).size : 0,
          mimeType: responseMimeType,
          ...(responseBody ? { text: responseBody } : {}),
        },
        headersSize: -1,
        bodySize: responseBody ? new Blob([responseBody]).size : 0,
      },
      timings: {
        send: 0,
        wait: time,
        receive: 0,
      },
    }

    return entry
  })

  return {
    log: {
      version: '1.2',
      creator: {
        name: 'PowerCatch',
        version: '1.0.0',
      },
      entries,
    },
  }
}

/**
 * 将请求列表导出为 HAR 文件并下载
 * @param requests 请求列表
 */
export function exportHarFile(requests: CaptureRequest[]): void {
  const har = convertToHar(requests)
  const json = JSON.stringify(har, null, 2)
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  downloadFile(json, `powercatch-${timestamp}.har`, 'application/json')
}
