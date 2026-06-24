/**
 * 通用 Body 解析器（请求体/响应体共用）
 * 根据 Content-Type 路由到正确的预览模式，处理 Base64 前缀格式
 */

/** 预览模式枚举 */
export type PreviewMode = 'json' | 'html' | 'xml' | 'css' | 'js' | 'image' | 'hex' | 'text' | 'binary-info'

/** 解析结果 */
export interface ParsedBody {
  mode: PreviewMode
  /** 文本内容 / base64 数据（不含前缀） */
  content: string
  meta?: {
    contentType?: string
    size?: number
    isBinary?: boolean
    /** 仅图片：base64 data URL */
    dataUrl?: string
  }
}

/** Base64 前缀格式：[Base64:<contentType>:<originalSize>:<base64Data>] */
const BASE64_PREFIX_RE = /^\[Base64:([^:]+):(\d+):(.+)\]$/s

/** Body too large 前缀 */
const BODY_TOO_LARGE_RE = /^\[Body too large: (\d+) bytes, Content-Type: ([^\]]+)\]$/

/** Binary Data 旧格式兼容 */
const BINARY_DATA_RE = /^\[Binary Data: (\d+) bytes(?:, Content-Type: ([^\]]*))?\]$/

/**
 * 尝试将字符串解析为 JSON，成功返回解析结果，失败返回 null
 */
function tryParseJson(str: string): any | null {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

/**
 * 检测字符串是否为合法的 UTF-8 文本
 */
function isUtf8Text(str: string): boolean {
  try {
    // 如果字符串包含大量控制字符（除了常见的空白字符），认为是二进制
    let controlCharCount = 0
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      // 控制字符：0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F
      if ((code <= 0x08) || (code >= 0x0B && code <= 0x0C) || (code >= 0x0E && code <= 0x1F) || code === 0x7F) {
        controlCharCount++
      }
    }
    // 如果控制字符占比超过 10%，认为是二进制
    return controlCharCount / str.length < 0.1
  } catch {
    return false
  }
}

/**
 * 解析 body 字符串，返回 ParsedBody
 */
export function parseBody(body: string, contentType: string): ParsedBody {
  if (!body) {
    return { mode: 'text', content: '' }
  }

  // 1. 检测 Base64 前缀格式
  const base64Match = body.match(BASE64_PREFIX_RE)
  if (base64Match) {
    const [, ct, sizeStr, base64Data] = base64Match
    const size = parseInt(sizeStr, 10)
    if (ct.startsWith('image/')) {
      return {
        mode: 'image',
        content: base64Data,
        meta: { contentType: ct, size, isBinary: true, dataUrl: `data:${ct};base64,${base64Data}` },
      }
    }

    // 非图片二进制 → 尝试解码后检测是否为 JSON 或文本
    try {
      const decoded = Buffer.from(base64Data, 'base64').toString('utf-8')

      // 优先检测是否为 JSON
      if (tryParseJson(decoded)) {
        return {
          mode: 'json',
          content: decoded,
          meta: { contentType: ct, size, isBinary: false },
        }
      }

      // 再检测是否为合法 UTF-8 文本
      if (isUtf8Text(decoded)) {
        return {
          mode: 'text',
          content: decoded,
          meta: { contentType: ct, size, isBinary: false },
        }
      }
    } catch {
      // 解码失败，走 Hex 模式
    }

    // 无法解析为 JSON 或文本 → Hex 模式
    return {
      mode: 'hex',
      content: base64Data,
      meta: { contentType: ct, size, isBinary: true },
    }
  }

  // 2. 检测 Body too large
  const tooLargeMatch = body.match(BODY_TOO_LARGE_RE)
  if (tooLargeMatch) {
    return {
      mode: 'binary-info',
      content: body,
      meta: { contentType: tooLargeMatch[2], size: parseInt(tooLargeMatch[1], 10), isBinary: true },
    }
  }

  // 3. 检测旧格式 Binary Data（兼容）
  const binaryMatch = body.match(BINARY_DATA_RE)
  if (binaryMatch) {
    return {
      mode: 'binary-info',
      content: body,
      meta: { contentType: binaryMatch[2] || 'unknown', size: parseInt(binaryMatch[1], 10), isBinary: true },
    }
  }

  // 4. Compressed Request Body（兼容）
  if (body.startsWith('[Compressed Request Body:') || body.startsWith('[Compressed')) {
    return { mode: 'binary-info', content: body, meta: { isBinary: true } }
  }

  // 5. 根据 Content-Type 路由
  const ct = contentType.toLowerCase().split(';')[0].trim()
  const mode = mapContentTypeToMode(ct, body)

  return { mode, content: body, meta: { contentType: ct } }
}

/**
 * Content-Type → 预览模式映射
 */
function mapContentTypeToMode(ct: string, body: string): PreviewMode {
  // JSON
  if (ct === 'application/json' || ct.endsWith('+json')) {
    return 'json'
  }

  // HTML
  if (ct === 'text/html') {
    return 'html'
  }

  // XML
  if (ct === 'text/xml' || ct === 'application/xml' || ct.endsWith('+xml')) {
    return 'xml'
  }

  // CSS
  if (ct === 'text/css') {
    return 'css'
  }

  // JavaScript
  if (ct === 'text/javascript' || ct === 'application/javascript' || ct === 'application/x-javascript') {
    return 'js'
  }

  // 图片
  if (ct.startsWith('image/')) {
    return 'image'
  }

  // text/plain：尝试自动检测
  if (ct === 'text/plain' || ct === '') {
    return autoDetectMode(body)
  }

  // 兜底
  return 'text'
}

/**
 * 对 text/plain 内容做自动检测
 */
function autoDetectMode(body: string): PreviewMode {
  const trimmed = body.trim()
  if (!trimmed) return 'text'

  // 尝试 JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 不是合法 JSON
    }
  }

  // 尝试 XML/HTML
  if (trimmed.startsWith('<')) {
    // HTML 特征
    if (/<html|<body|<div|<span|<head|<!DOCTYPE/i.test(trimmed.slice(0, 500))) {
      return 'html'
    }
    return 'xml'
  }

  return 'text'
}

/**
 * 判断 body 是否为 Base64 编码的二进制数据
 */
export function isBase64Body(body: string): boolean {
  return BASE64_PREFIX_RE.test(body)
}

/**
 * 从 Base64 前缀中提取原始大小
 */
export function getBase64OriginalSize(body: string): number | null {
  const match = body.match(BASE64_PREFIX_RE)
  return match ? parseInt(match[2], 10) : null
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
