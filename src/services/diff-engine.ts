/**
 * Diff 对比引擎
 * 纯手写实现，不依赖外部 diff 库
 */
import type { CaptureRequest, DiffResult, HttpHeaders } from './types'

/** Headers 对比结果 */
export interface HeaderDiffResult {
  added: Record<string, string>
  removed: Record<string, string>
  modified: Array<{ key: string; old: string; new: string }>
}

/** Body 变更项 */
export interface BodyChange {
  value: string
  added?: boolean
  removed?: boolean
}

/** JSON 路径 delta 节点 */
export interface JsonDelta {
  path: string
  type: 'added' | 'removed' | 'modified'
  oldValue?: any
  newValue?: any
}

/**
 * 对比两个 headers 对象
 * 忽略大小写（HTTP headers 不区分大小写）
 */
export function diffHeaders(h1: HttpHeaders, h2: HttpHeaders): HeaderDiffResult {
  const added: Record<string, string> = {}
  const removed: Record<string, string> = {}
  const modified: Array<{ key: string; old: string; new: string }> = []

  // 规范化 key 为小写，保留原始 key 显示
  const normalize = (headers: HttpHeaders): Map<string, { originalKey: string; value: string }> => {
    const map = new Map<string, { originalKey: string; value: string }>()
    for (const [key, val] of Object.entries(headers)) {
      if (val !== undefined) {
        map.set(key.toLowerCase(), {
          originalKey: key,
          value: Array.isArray(val) ? val.join(', ') : String(val),
        })
      }
    }
    return map
  }

  const map1 = normalize(h1)
  const map2 = normalize(h2)

  // 找 removed 和 modified
  for (const [lowerKey, entry] of map1) {
    const match = map2.get(lowerKey)
    if (!match) {
      removed[entry.originalKey] = entry.value
    } else if (entry.value !== match.value) {
      modified.push({ key: entry.originalKey, old: entry.value, new: match.value })
    }
  }

  // 找 added
  for (const [lowerKey, entry] of map2) {
    if (!map1.has(lowerKey)) {
      added[entry.originalKey] = entry.value
    }
  }

  return { added, removed, modified }
}

/**
 * 检测内容是否为二进制（简单启发式：包含大量不可打印字符）
 */
function isBinaryContent(content: string): boolean {
  if (!content) return false
  // 检查前 512 字节
  const sample = content.slice(0, 512)
  let nonPrintable = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    // 允许常见空白字符 (0x09 \t, 0x0A \n, 0x0D \r) 和可打印 ASCII (0x20-0x7E)
    if (code !== 0x09 && code !== 0x0A && code !== 0x0D && (code < 0x20 || code > 0x7E)) {
      nonPrintable++
    }
  }
  return nonPrintable / sample.length > 0.3
}

/**
 * 尝试解析 JSON，失败返回 null
 */
function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 递归对比两个 JSON 对象，输出 delta 列表
 */
function diffJsonRecursive(obj1: any, obj2: any, path: string = ''): JsonDelta[] {
  const deltas: JsonDelta[] = []

  // 类型不同
  if (typeof obj1 !== typeof obj2 || Array.isArray(obj1) !== Array.isArray(obj2)) {
    deltas.push({ path: path || '(root)', type: 'modified', oldValue: obj1, newValue: obj2 })
    return deltas
  }

  // 基本类型
  if (obj1 === null || obj2 === null || typeof obj1 !== 'object') {
    if (obj1 !== obj2) {
      deltas.push({ path: path || '(root)', type: 'modified', oldValue: obj1, newValue: obj2 })
    }
    return deltas
  }

  // 数组
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    const maxLen = Math.max(obj1.length, obj2.length)
    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`
      if (i >= obj1.length) {
        deltas.push({ path: itemPath, type: 'added', newValue: obj2[i] })
      } else if (i >= obj2.length) {
        deltas.push({ path: itemPath, type: 'removed', oldValue: obj1[i] })
      } else {
        deltas.push(...diffJsonRecursive(obj1[i], obj2[i], itemPath))
      }
    }
    return deltas
  }

  // 对象
  const keys1 = new Set(Object.keys(obj1))
  const keys2 = new Set(Object.keys(obj2))

  // removed
  for (const key of keys1) {
    if (!keys2.has(key)) {
      const propPath = path ? `${path}.${key}` : key
      deltas.push({ path: propPath, type: 'removed', oldValue: obj1[key] })
    }
  }

  // added
  for (const key of keys2) {
    if (!keys1.has(key)) {
      const propPath = path ? `${path}.${key}` : key
      deltas.push({ path: propPath, type: 'added', newValue: obj2[key] })
    }
  }

  // modified / recursive
  for (const key of keys1) {
    if (keys2.has(key)) {
      const propPath = path ? `${path}.${key}` : key
      deltas.push(...diffJsonRecursive(obj1[key], obj2[key], propPath))
    }
  }

  return deltas
}

/**
 * 对比 body 内容
 * JSON 类型使用结构化 diff，其他使用逐行文本 diff
 */
export function diffBody(
  body1: string,
  body2: string,
  contentType?: string
): { type: 'json' | 'text' | 'binary' | 'empty'; delta?: JsonDelta[]; changes?: BodyChange[] } {
  // 空 body
  if (!body1 && !body2) {
    return { type: 'empty' }
  }

  // 二进制检测
  if (isBinaryContent(body1) || isBinaryContent(body2)) {
    return { type: 'binary' }
  }

  // 尝试 JSON 解析
  const json1 = tryParseJson(body1)
  const json2 = tryParseJson(body2)

  if (json1 !== null && json2 !== null) {
    const deltas = diffJsonRecursive(json1, json2)
    return { type: 'json', delta: deltas }
  }

  // 文本逐行 diff
  const lines1 = body1.split('\n')
  const lines2 = body2.split('\n')
  const changes = diffLines(lines1, lines2)
  return { type: 'text', changes }
}

/**
 * 简单的逐行 LCS diff
 * 输出带 added/removed 标记的变更列表
 */
function diffLines(lines1: string[], lines2: string[]): BodyChange[] {
  const m = lines1.length
  const n = lines2.length

  // 空的快速路径
  if (m === 0 && n === 0) return []
  if (m === 0) return lines2.map((l) => ({ value: l, added: true }))
  if (n === 0) return lines1.map((l) => ({ value: l, removed: true }))

  // 小数据用完整 LCS，大数据用 Myers 简化
  if (m * n > 1000000) {
    return diffLinesSimple(lines1, lines2)
  }

  // LCS DP 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 回溯
  const result: BodyChange[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
      result.unshift({ value: lines1[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ value: lines2[j - 1], added: true })
      j--
    } else {
      result.unshift({ value: lines1[i - 1], removed: true })
      i--
    }
  }

  return result
}

/**
 * 大文件简化 diff：基于最长公共前缀的启发式逐行对比
 * 性能 O(n*m) 在极端情况下仍然可能较慢，但比完整 LCS 更节省内存
 */
function diffLinesSimple(lines1: string[], lines2: string[]): BodyChange[] {
  const result: BodyChange[] = []
  let i = 0
  let j = 0

  while (i < lines1.length && j < lines2.length) {
    if (lines1[i] === lines2[j]) {
      result.push({ value: lines1[i] })
      i++
      j++
    } else {
      // 向前搜索看是否能在 lines2 中找到当前行
      let foundIn2 = -1
      for (let k = j + 1; k < Math.min(j + 50, lines2.length); k++) {
        if (lines2[k] === lines1[i]) {
          foundIn2 = k
          break
        }
      }

      // 向前搜索看是否能在 lines1 中找到当前行
      let foundIn1 = -1
      for (let k = i + 1; k < Math.min(i + 50, lines1.length); k++) {
        if (lines1[k] === lines2[j]) {
          foundIn1 = k
          break
        }
      }

      if (foundIn2 >= 0 && (foundIn1 < 0 || (foundIn2 - j) <= (foundIn1 - i))) {
        // lines2 中有匹配，说明 j..foundIn2 是新增的
        while (j < foundIn2) {
          result.push({ value: lines2[j], added: true })
          j++
        }
      } else if (foundIn1 >= 0) {
        // lines1 中有匹配，说明 i..foundIn1 是删除的
        while (i < foundIn1) {
          result.push({ value: lines1[i], removed: true })
          i++
        }
      } else {
        // 两边都不同，标记为替换
        result.push({ value: lines1[i], removed: true })
        result.push({ value: lines2[j], added: true })
        i++
        j++
      }
    }
  }

  // 剩余行
  while (i < lines1.length) {
    result.push({ value: lines1[i], removed: true })
    i++
  }
  while (j < lines2.length) {
    result.push({ value: lines2[j], added: true })
    j++
  }

  return result
}

/**
 * 检测请求体 Content-Type
 */
function detectContentType(headers: HttpHeaders): string | undefined {
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type' && val) {
      return Array.isArray(val) ? val[0] : String(val)
    }
  }
  return undefined
}

/**
 * 主入口：对比两个 CaptureRequest，返回 DiffResult
 */
export function computeDiff(req1: CaptureRequest, req2: CaptureRequest): DiffResult {
  // 对比请求头
  const reqHeaders = diffHeaders(req1.requestHeaders, req2.requestHeaders)

  // 对比响应头
  const resHeaders = diffHeaders(req1.responseHeaders, req2.responseHeaders)

  // 对比请求体
  const reqContentType = detectContentType(req1.requestHeaders)
  const reqBody = diffBody(req1.requestBody, req2.requestBody, reqContentType)

  // 对比响应体
  const resContentType = detectContentType(req1.responseHeaders)
  const resBody = diffBody(req1.responseBody, req2.responseBody, resContentType)

  // 计算概览
  const same: string[] = []
  const different: string[] = []

  // URL
  if (req1.url === req2.url) same.push('URL')
  else different.push('URL')

  // Method
  if (req1.method === req2.method) same.push('Method')
  else different.push('Method')

  // 状态码
  if (req1.statusCode === req2.statusCode) same.push('Status Code')
  else different.push('Status Code')

  // 请求头
  const reqHeaderChanges = Object.keys(reqHeaders.added).length + Object.keys(reqHeaders.removed).length + reqHeaders.modified.length
  if (reqHeaderChanges === 0) same.push('Request Headers')
  else different.push('Request Headers')

  // 请求体
  const reqBodyChanges = reqBody.type === 'empty' ? 0 : (reqBody.delta?.length || reqBody.changes?.filter((c) => c.added || c.removed).length || 0)
  if (reqBodyChanges === 0) same.push('Request Body')
  else different.push('Request Body')

  // 响应头
  const resHeaderChanges = Object.keys(resHeaders.added).length + Object.keys(resHeaders.removed).length + resHeaders.modified.length
  if (resHeaderChanges === 0) same.push('Response Headers')
  else different.push('Response Headers')

  // 响应体
  const resBodyChanges = resBody.type === 'empty' ? 0 : (resBody.delta?.length || resBody.changes?.filter((c) => c.added || c.removed).length || 0)
  if (resBodyChanges === 0) same.push('Response Body')
  else different.push('Response Body')

  return {
    overview: {
      same,
      different,
      stats: {
        requestHeaders: {
          added: Object.keys(reqHeaders.added).length,
          removed: Object.keys(reqHeaders.removed).length,
          modified: reqHeaders.modified.length,
        },
        requestBody: { changes: reqBodyChanges },
        responseHeaders: {
          added: Object.keys(resHeaders.added).length,
          removed: Object.keys(resHeaders.removed).length,
          modified: resHeaders.modified.length,
        },
        responseBody: { changes: resBodyChanges },
      },
    },
    requestHeaders: reqHeaders,
    requestBody: reqBody as DiffResult['requestBody'],
    responseHeaders: resHeaders,
    responseBody: resBody as DiffResult['responseBody'],
  }
}
