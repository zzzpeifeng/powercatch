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
 */
function isBinaryBody(body: string): boolean {
  return body.startsWith('[Base64:')
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
    if (isBinaryBody(request.requestBody)) {
      // 二进制 body：提示从文件加载
      parts.push('--data-binary @request_body.bin')
      parts.push('# 二进制数据，请从文件加载')
    } else {
      parts.push(`-d '${escapeShellSingleQuote(request.requestBody)}'`)
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
    if (isBinaryBody(request.requestBody)) {
      parts.push('--data-binary @request_body.bin')
    } else {
      parts.push(`-d '${escapeShellSingleQuote(request.requestBody)}'`)
    }
  }

  return parts.join(' ')
}
