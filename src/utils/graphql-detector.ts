/**
 * GraphQL 请求检测工具
 * 用于识别 GraphQL 请求并解析 operation name 和类型
 */
import type { CaptureRequest } from '../services/types'

/**
 * 检测是否为 GraphQL 请求
 * 判断逻辑：
 * 1. 请求头 Content-Type 包含 application/json 或 application/graphql
 * 2. 请求体包含 query 字段（GraphQL 核心字段）
 * 3. 请求体是有效的 JSON 格式
 */
export function isGraphQLRequest(request: CaptureRequest): boolean {
  // 只处理 POST 请求（GraphQL 标准使用 POST）
  if (request.method !== 'POST') return false

  // 检查 Content-Type
  const contentType = getContentType(request)
  if (!isGraphQLContentType(contentType)) return false

  // 检查请求体是否包含 GraphQL query
  return hasGraphQLQuery(request.requestBody)
}

/**
 * 解析 GraphQL operation name
 * 从请求体中提取 operationName 字段
 */
export function parseOperationName(request: CaptureRequest): string | null {
  if (!request.requestBody) return null

  try {
    const body = JSON.parse(request.requestBody)
    return body.operationName || null
  } catch {
    // 尝试从 query 字段解析
    return extractOperationNameFromQuery(request.requestBody)
  }
}

/**
 * 解析 GraphQL operation 类型
 * 从 query 字段中提取 query/mutation/subscription
 */
export function parseOperationType(request: CaptureRequest): 'query' | 'mutation' | 'subscription' | null {
  if (!request.requestBody) return null

  try {
    const body = JSON.parse(request.requestBody)
    const query = body.query || ''

    // 移除注释和多余空白
    const cleanQuery = query.replace(/#[^\n]*/g, '').trim()

    // 匹配 operation 类型
    if (/^\s*query\b/i.test(cleanQuery)) return 'query'
    if (/^\s*mutation\b/i.test(cleanQuery)) return 'mutation'
    if (/^\s*subscription\b/i.test(cleanQuery)) return 'subscription'

    // 如果没有明确指定类型，默认为 query
    if (/^\s*\{/.test(cleanQuery)) return 'query'

    return null
  } catch {
    return null
  }
}

// ===== 内部辅助函数 =====

/**
 * 获取请求的 Content-Type
 */
function getContentType(request: CaptureRequest): string {
  const headers = request.requestHeaders
  if (!headers) return ''

  // 处理大小写不敏感的 header 名称
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') {
      const value = headers[key]
      return Array.isArray(value) ? value[0] || '' : value || ''
    }
  }
  return ''
}

/**
 * 检查 Content-Type 是否为 GraphQL 支持的类型
 */
function isGraphQLContentType(contentType: string): boolean {
  if (!contentType) return false

  const ct = contentType.toLowerCase()
  return ct.includes('application/json') ||
         ct.includes('application/graphql') ||
         ct.includes('text/plain')  // 某些客户端使用 text/plain
}

/**
 * 检查请求体是否包含 GraphQL query
 */
function hasGraphQLQuery(body: string): boolean {
  if (!body || body.trim().length === 0) return false

  try {
    const parsed = JSON.parse(body)
    // 必须包含 query 字段，且是字符串类型
    return typeof parsed.query === 'string' && parsed.query.trim().length > 0
  } catch {
    // 尝试解析 GraphQL 原始格式（非 JSON）
    return isRawGraphQL(body)
  }
}

/**
 * 检查是否为原始 GraphQL 格式（非 JSON）
 */
function isRawGraphQL(body: string): boolean {
  const trimmed = body.trim()
  // 原始 GraphQL 以 query/mutation/subscription 或 { 开头
  return /^\s*(query|mutation|subscription|\{)/i.test(trimmed)
}

/**
 * 从原始 query 字符串中提取 operation name
 */
function extractOperationNameFromQuery(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed.query !== 'string') return null

    const query = parsed.query
    // 匹配 "query OperationName" 或 "mutation OperationName" 模式
    const match = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}