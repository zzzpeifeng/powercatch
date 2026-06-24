/**
 * cURL 命令生成器
 * 将请求对象转换为 cURL 命令
 */
import type { CaptureRequest } from '../services/types'

/**
 * 转义单引号字符串
 * 在 shell 中，单引号内的内容需要特殊处理
 */
function escapeShellSingleQuote(str: string): string {
  return str.replace(/'/g, "'\\''")
}

/**
 * 检测是否为二进制 body（Base64 格式）
 * 尝试解码 Base64，如果是文本/JSON 则返回 false（不是二进制）
 */
function isBinaryBody(body: string): boolean {
  if (!body.startsWith('[Base64:')) {
    return false
  }

  // 尝试解码 Base64 并检查是否为文本
  try {
    const match = body.match(/^\[Base64:([^:]+):(\d+):(.+)\]$/s)
    if (!match) return true // 格式不匹配，认为是二进制

    const decoded = Buffer.from(match[3], 'base64').toString('utf-8')

    // 检查是否为合法 UTF-8 文本（控制字符占比不超过 10%）
    let controlCharCount = 0
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i)
      if ((code <= 0x08) || (code >= 0x0B && code <= 0x0C) || (code >= 0x0E && code <= 0x1F) || code === 0x7F) {
        controlCharCount++
      }
    }

    // 控制字符占比低，认为是文本
    if (controlCharCount / decoded.length < 0.1) {
      return false
    }

    return true
  } catch {
    // 解码失败，认为是二进制
    return true
  }
}

/**
 * 尝试解码 Base64 格式的 body
 * 如果是文本/JSON，返回解码后的字符串
 * 如果是二进制，返回 null
 */
function tryDecodeBase64Body(body: string): string | null {
  if (!body.startsWith('[Base64:')) {
    return body // 不是 Base64 格式，直接返回
  }

  try {
    const match = body.match(/^\[Base64:([^:]+):(\d+):(.+)\]$/s)
    if (!match) return null

    const decoded = Buffer.from(match[3], 'base64').toString('utf-8')

    // 检查是否为合法 UTF-8 文本
    let controlCharCount = 0
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i)
      if ((code <= 0x08) || (code >= 0x0B && code <= 0x0C) || (code >= 0x0E && code <= 0x1F) || code === 0x7F) {
        controlCharCount++
      }
    }

    if (controlCharCount / decoded.length < 0.1) {
      return decoded
    }

    return null // 是二进制数据
  } catch {
    return null
  }
}

/**
 * 将请求转换为 cURL 命令
 * @param request 请求数据
 * @returns cURL 命令字符串
 */
export function generateCurl(request: CaptureRequest): string {
  const parts: string[] = ['curl']

  // Method
  if (request.method && request.method !== 'GET') {
    parts.push(`-X ${request.method}`)
  }

  // URL
  parts.push(`'${escapeShellSingleQuote(request.url)}'`)

  // Headers
  if (request.requestHeaders) {
    for (const [key, value] of Object.entries(request.requestHeaders)) {
      if (value !== undefined) {
        const headerValue = Array.isArray(value) ? value.join(', ') : String(value)
        parts.push(`-H '${escapeShellSingleQuote(`${key}: ${headerValue}`)}'`)
      }
    }
  }

  // Body
  if (request.requestBody) {
    const decodedBody = tryDecodeBase64Body(request.requestBody)
    if (decodedBody !== null) {
      // 是文本（可能是从 Base64 解码出来的，也可能是原始文本）
      parts.push(`-d '${escapeShellSingleQuote(decodedBody)}'`)
    } else {
      // 是二进制数据
      parts.push('--data-binary @request_body.bin')
      parts.push('# 二进制数据，请从文件加载')
    }
  }

  // 格式化输出（每个参数一行）
  return parts.join(' \\\n  ')
}

/**
 * 将请求转换为单行 cURL 命令（适合复制粘贴）
 */
export function generateCurlSingleLine(request: CaptureRequest): string {
  const parts: string[] = ['curl']

  // Method
  if (request.method && request.method !== 'GET') {
    parts.push(`-X ${request.method}`)
  }

  // URL
  parts.push(`'${escapeShellSingleQuote(request.url)}'`)

  // Headers
  if (request.requestHeaders) {
    for (const [key, value] of Object.entries(request.requestHeaders)) {
      if (value !== undefined) {
        const headerValue = Array.isArray(value) ? value.join(', ') : String(value)
        parts.push(`-H '${escapeShellSingleQuote(`${key}: ${headerValue}`)}'`)
      }
    }
  }

  // Body
  if (request.requestBody) {
    const decodedBody = tryDecodeBase64Body(request.requestBody)
    if (decodedBody !== null) {
      // 是文本（可能是从 Base64 解码出来的，也可能是原始文本）
      parts.push(`-d '${escapeShellSingleQuote(decodedBody)}'`)
    } else {
      // 是二进制数据
      parts.push('--data-binary @request_body.bin')
    }
  }

  return parts.join(' ')
}
