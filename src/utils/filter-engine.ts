/**
 * 过滤引擎 - 高级过滤系统的纯函数实现
 * 各维度之间是 AND 关系，维度内多选是 OR 关系
 */
import type {
  CaptureRequest, FilterState,
  StatusCodeGroup, ContentTypeGroup, DurationRange, SizeRange,
} from '../services/types'

// ===== 辅助函数 =====

/** 将状态码映射到分组（null → 'pending'） */
function getStatusCodeGroup(code: number | null): StatusCodeGroup {
  if (code === null) return 'pending'
  if (code >= 200 && code < 300) return '2xx'
  if (code >= 300 && code < 400) return '3xx'
  if (code >= 400 && code < 500) return '4xx'
  if (code >= 500) return '5xx'
  return 'pending' // 1xx 或其他异常归入 pending
}

/**
 * 将 Content-Type 头映射到分组
 * 处理 string | string[] | undefined 三种情况
 */
function getContentTypeGroup(ct: string | string[] | undefined): ContentTypeGroup {
  // 统一转为小写字符串
  let ctStr: string
  if (ct === undefined) return 'other'
  if (Array.isArray(ct)) ctStr = ct[0]?.toLowerCase() ?? ''
  else ctStr = ct.toLowerCase()

  if (ctStr.includes('json')) return 'json'
  if (ctStr.includes('html')) return 'html'
  if (ctStr.includes('image')) return 'image'
  if (ctStr.includes('javascript') || ctStr.includes('ecmascript')) return 'javascript'
  if (ctStr.includes('css')) return 'css'
  return 'other'
}

/** 将响应时间映射到范围（null → 'pending'） */
function getDurationRange(duration: number | null): DurationRange {
  if (duration === null) return 'pending'
  if (duration < 100) return 'fast'
  if (duration < 500) return 'normal'
  if (duration < 1000) return 'slow'
  return 'very_slow'
}

/**
 * 将请求体大小映射到范围
 * 使用 TextEncoder 计算字节数（而非字符串长度，避免中文/二进制精度问题）
 */
function getSizeRange(requestBody: string): SizeRange {
  if (!requestBody || requestBody.length === 0) return 'empty'
  // TextEncoder 计算 UTF-8 字节数，比 .length 更准确
  const bytes = new TextEncoder().encode(requestBody).length
  if (bytes < 1024) return 'tiny'
  if (bytes < 10240) return 'small'
  if (bytes < 102400) return 'medium'
  return 'large'
}

// ===== 核心过滤函数 =====

/**
 * 判断请求是否匹配所有激活的过滤条件
 * 各维度之间是 AND 关系，维度内多选是 OR 关系
 */
export function matchFilters(req: CaptureRequest, filter: FilterState): boolean {
  // 方法过滤
  if (filter.methods.length > 0 && !filter.methods.includes(req.method)) {
    return false
  }

  // 状态码过滤
  if (filter.statusGroups.length > 0) {
    const group = getStatusCodeGroup(req.statusCode)
    if (!filter.statusGroups.includes(group)) return false
  }

  // Content-Type 过滤（注意：responseHeaders 不是 optional，不需要 ?.）
  if (filter.contentTypes.length > 0) {
    const ct = getContentTypeGroup(req.responseHeaders['content-type'])
    if (!filter.contentTypes.includes(ct)) return false
  }

  // 响应时间过滤
  if (filter.durationRanges.length > 0) {
    const range = getDurationRange(req.duration)
    if (!filter.durationRanges.includes(range)) return false
  }

  // 请求体大小过滤
  if (filter.sizeRanges.length > 0) {
    const size = getSizeRange(req.requestBody)
    if (!filter.sizeRanges.includes(size)) return false
  }

  // 设备 IP 过滤
  if (filter.clientIps.length > 0 && !filter.clientIps.includes(req.clientIp)) {
    return false
  }

  return true
}
