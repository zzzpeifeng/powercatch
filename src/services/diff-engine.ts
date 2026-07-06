/**
 * Diff 对比引擎
 * 纯手写实现，不依赖外部 diff 库
 */
import type { CaptureRequest, DiffResult, HttpHeaders } from './types'

/**
 * 内置确定性启发式忽略名单（Built-in Heuristic Ignore Rules）
 * 零成本、零延迟：覆盖常见易变 / 噪声字段，默认开启（设置可关闭）。
 *
 * 规则格式约定（与用户手动规则一致）：
 *   - 不含 '.' → 视为 Header 名 / Query 参数名（大小写不敏感）；
 *   - 含 '*.` 前缀 → 视为 JSON body 通配路径（末段命中即剔除，任意父路径）；
 *   - 含 '.' 且非 '*.` 前缀 → 视为 JSON body 精确路径（点号表示法）。
 *
 * 分类（当前共 38 条：18 条 Header/Query 名（大小写不敏感）+ 20 条 `*.` 前缀 JSON 通配路径）：
 *   1. Header / Query 名（不含点，大小写不敏感）：易变 / 噪声头与签名类字段。
 *   2. JSON body 通配路径（*. 前缀）：任意父路径下命中的易变叶子字段。
 *
 * 注意：刻意不包含 authorization、set-cookie 等"可能影响真实差异判定"的字段，
 *       如需忽略请由用户在手动规则中自行添加，避免掩盖真实差异。
 */
export const BUILTIN_IGNORE_RULES: readonly string[] = [
  // ===== 1. Header / Query 名（不含点，大小写不敏感）=====
  // —— 时间类 ——
  'timestamp',
  'date',
  'x-timestamp',
  'last-modified',
  'expires',
  // —— 请求 / 链路追踪类 ——
  'x-request-id',
  'x-trace-id',
  'x-correlation-id',
  'etag',
  'x-powered-by',
  // —— 签名 / 防重放 / 凭证类（噪声高，通常被安全头携带，非业务差异）——
  'x-nonce',
  'x-signature',
  'x-sign',
  'x-csrf-token',
  'signature',
  'sign',
  'nonce',
  'token',

  // ===== 2. JSON body 通配路径（*. 前缀：任意父路径下末段命中即剔除）=====
  // —— 时间类 ——
  '*.timestamp',
  '*.createdAt',
  '*.updatedAt',
  '*.createTime',
  '*.updateTime',
  '*.expireAt',
  '*.expiresAt',
  '*.expireTime',
  '*.dateTime',
  '*.time',
  // —— 易变 ID / 追踪类 ——
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.sign',
  '*.signature',
  '*.nonce',
  '*.nonceStr',
  '*.requestId',
  '*.traceId',
  '*.sessionId',
]

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

/**
 * 将 DiffResult 序列化为紧凑文本，用于注入 AI Prompt
 * @param diff computeDiff() 的产出
 * @param maxDeltas 单维度最多保留的 delta 条数（超出截断，保证 token 预算）
 * @returns 紧凑文本
 */
export function serializeDiffForPrompt(diff: DiffResult, maxDeltas = 200): string {
  const lines: string[] = []

  // 1. 概览行
  const { overview } = diff
  lines.push(`[概览] 相同: ${overview.same.join(', ') || '无'} | 不同: ${overview.different.join(', ') || '无'}`)
  lines.push(`[统计] 请求头(+${overview.stats.requestHeaders.added}/-${overview.stats.requestHeaders.removed}/~${overview.stats.requestHeaders.modified}) ` +
             `响应头(+${overview.stats.responseHeaders.added}/-${overview.stats.responseHeaders.removed}/~${overview.stats.responseHeaders.modified}) ` +
             `请求体变更${overview.stats.requestBody.changes} 响应体变更${overview.stats.responseBody.changes}`)

  // 2. 请求头差异
  lines.push(...formatHeaderDiff('请求头', diff.requestHeaders))
  // 3. 响应头差异
  lines.push(...formatHeaderDiff('响应头', diff.responseHeaders))

  // 4. 请求体差异
  lines.push(...formatBodyDiff('请求体', diff.requestBody, maxDeltas))
  // 5. 响应体差异
  lines.push(...formatBodyDiff('响应体', diff.responseBody, maxDeltas))

  return lines.join('\n')
}

/**
 * 格式化 Header 差异为可读文本行
 */
function formatHeaderDiff(label: string, h: HeaderDiffResult): string[] {
  const out: string[] = []
  const added = Object.entries(h.added).map(([k, v]) => `+ ${k}: ${v}`)
  const removed = Object.entries(h.removed).map(([k, v]) => `- ${k}: ${v}`)
  const modified = h.modified.map((m) => `~ ${m.key}: ${m.old} → ${m.new}`)
  if (added.length || removed.length || modified.length) {
    out.push(`[${label}差异]`)
    out.push(...added, ...removed, ...modified)
  }
  return out
}

/**
 * 格式化 Body 差异为可读文本行（支持 json / text / binary / empty）
 */
function formatBodyDiff(label: string, b: DiffResult['requestBody'], max: number): string[] {
  const out: string[] = []
  if (b.type === 'empty') return out
  if (b.type === 'binary') { out.push(`[${label}] 二进制内容，无法结构化对比`); return out }
  if (b.type === 'json' && b.delta) {
    out.push(`[${label} JSON差异]`)
    // 单值 JSON.stringify 可能极长，截断避免撑爆 prompt
    const trunc = (v: any): string => {
      const s = JSON.stringify(v)
      return s.length > 500 ? s.slice(0, 500) + '…(已截断)' : s
    }
    ;(b.delta as JsonDelta[]).slice(0, max).forEach((d: JsonDelta) => {
      if (d.type === 'added') out.push(`+ ${d.path}: ${trunc(d.newValue)}`)
      else if (d.type === 'removed') out.push(`- ${d.path}: ${trunc(d.oldValue)}`)
      else out.push(`~ ${d.path}: ${trunc(d.oldValue)} → ${trunc(d.newValue)}`)
    })
    if (b.delta.length > max) out.push(`... 其余 ${b.delta.length - max} 处差异已省略`)
  }
  if (b.type === 'text' && b.changes) {
    out.push(`[${label} 文本差异]`)
    // 以"变更块"为单位截断，保证 removed/added 替换对完整
    const relevant = b.changes.filter((c) => c.added || c.removed)
    const blocks: Array<{ removed?: string; added?: string }> = []
    for (let i = 0; i < relevant.length; i++) {
      const c = relevant[i]
      if (c.removed && relevant[i + 1]?.added) {
        blocks.push({ removed: c.value, added: relevant[i + 1].value })
        i++ // 跳过紧随的 added，避免拆对
      } else if (c.removed) {
        blocks.push({ removed: c.value })
      } else {
        blocks.push({ added: c.value })
      }
    }
    blocks.slice(0, max).forEach((blk) => {
      if (blk.removed) out.push(`- ${blk.removed}`)
      if (blk.added) out.push(`+ ${blk.added}`)
    })
    if (blocks.length > max) out.push(`... 其余 ${blocks.length - max} 处变更块已省略`)
  }
  return out
}

// ===== 对比忽略规则（Compare Ignore Rules）=====
//
// 规则格式约定（简单可文档化，不做复杂通配）：
//   - 含小数点 '.' → 视为 JSON body 路径（点号表示法），如 'data.timestamp'、'user.token'
//   - 不含 '.'   → 视为 Header 名 或 Query 参数名（大小写不敏感匹配），如 'X-Request-Id'、'Authorization'、'signature'
//
// 命中的字段将从「请求头 / 响应头 / URL 查询参数 / JSON body 路径」中剔除后再参与 diff。

/**
 * 合并「用户手动规则」与「内置启发式名单」。
 * - useBuiltin=true 时并入 BUILTIN_IGNORE_RULES（去重，用户规则优先保留在前）。
 * - useBuiltin=false 时仅返回用户规则（去空、去重）。
 *
 * @param userRules 用户手动规则
 * @param useBuiltin 是否并入内置名单
 * @returns 合并去重后的规则数组（无副作用）
 */
export function mergeIgnoreRules(userRules: string[], useBuiltin: boolean): string[] {
  const user = Array.isArray(userRules) ? userRules : []
  const sources: string[] = useBuiltin ? [...user, ...BUILTIN_IGNORE_RULES] : [...user]
  const seen = new Set<string>()
  const merged: string[] = []
  for (const r of sources) {
    if (!r) continue
    if (seen.has(r)) continue
    seen.add(r)
    merged.push(r)
  }
  return merged
}

/**
 * 对单个 CaptureRequest 应用忽略规则，返回剔除命中字段后的新请求（不修改入参）。
 *
 * 命中范围：
 *   1) Header 名（请求头 + 响应头，大小写不敏感）
 *   2) URL 查询参数名（大小写不敏感）
 *   3) JSON body 路径：
 *      - 精确路径（含 '.' 且非 '*.` 前缀）→ 点号表示法，仅剔除该全路径叶子；
 *      - 通配路径（以 '*.` 开头）→ 路径末段等于 '*.` 之后部分，任意父路径下均剔除。
 *
 * @param request 原始请求（不会被修改）
 * @param rules 忽略规则列表
 * @returns 应用规则后的新请求；rules 为空时直接返回原对象（零开销）
 */
export function applyIgnoreRules(request: CaptureRequest, rules: string[]): CaptureRequest {
  if (!rules || rules.length === 0) return request

  // 规则分类：
  //   - 不含 '.' → Header / Query 名（大小写不敏感）
  //   - 含 '.' 且以 '*.` 开头 → JSON body 通配路径（末段命中）
  //   - 含 '.' 且非 '*.` 前缀 → JSON body 精确路径
  const headerRules = rules.filter((r) => !r.includes('.')).map((r) => r.toLowerCase())
  const exactPathRules = rules.filter((r) => r.includes('.') && !r.startsWith('*.'))
  const wildcardPathRules = rules.filter((r) => r.startsWith('*.')).map((r) => r.slice(2))

  // 深拷贝，避免污染原始请求（原始请求仍需用于持久化/原始报文展示）
  const clone: CaptureRequest = JSON.parse(JSON.stringify(request)) as CaptureRequest

  // 1) Header 剔除（请求头 + 响应头，大小写不敏感）
  if (headerRules.length > 0) {
    clone.requestHeaders = stripHeaders(clone.requestHeaders, headerRules)
    clone.responseHeaders = stripHeaders(clone.responseHeaders, headerRules)
  }

  // 2) Query 参数剔除（URL query string，大小写不敏感）
  if (headerRules.length > 0) {
    clone.url = stripQueryParams(clone.url, headerRules)
  }

  // 3) JSON body 路径剔除（请求体 + 响应体）：精确路径 + 通配路径
  if (exactPathRules.length > 0) {
    clone.requestBody = stripJsonPath(clone.requestBody, exactPathRules)
    clone.responseBody = stripJsonPath(clone.responseBody, exactPathRules)
  }
  if (wildcardPathRules.length > 0) {
    clone.requestBody = stripJsonPathWildcard(clone.requestBody, wildcardPathRules)
    clone.responseBody = stripJsonPathWildcard(clone.responseBody, wildcardPathRules)
  }

  return clone
}

/**
 * 剔除命中的 Header（大小写不敏感）
 */
function stripHeaders(headers: HttpHeaders, lowerRules: string[]): HttpHeaders {
  const out: HttpHeaders = {}
  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue
    if (lowerRules.includes(key.toLowerCase())) continue // 命中忽略规则，剔除
    out[key] = val
  }
  return out
}

/**
 * 从 URL 查询参数中剔除命中的参数（大小写不敏感），保留其余部分与 '?' 结构
 */
function stripQueryParams(url: string, lowerRules: string[]): string {
  if (!url.includes('?')) return url
  const [base, query] = url.split('?')
  const params = new URLSearchParams(query)
  for (const key of Array.from(params.keys())) {
    if (lowerRules.includes(key.toLowerCase())) {
      params.delete(key)
    }
  }
  const newQuery = params.toString()
  return newQuery ? `${base}?${newQuery}` : base
}

/**
 * 从 JSON body 中按点号路径剔除命中叶子字段，并重新序列化。
 * 非 JSON body / 路径不存在时原样返回。
 */
function stripJsonPath(body: string, pathRules: string[]): string {
  if (!body) return body
  let parsed: any
  try {
    parsed = JSON.parse(body)
  } catch {
    return body // 非 JSON，跳过路径剔除
  }
  if (parsed === null || typeof parsed !== 'object') return body

  for (const rule of pathRules) {
    const segments = rule.split('.')
    let cur: any = parsed
    let ok = true
    // 逐段导航到父级
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      if (cur && typeof cur === 'object' && !Array.isArray(cur) && seg in cur) {
        cur = cur[seg]
      } else {
        ok = false
        break
      }
    }
    if (!ok || !cur || typeof cur !== 'object' || Array.isArray(cur)) continue
    const leaf = segments[segments.length - 1]
    if (leaf in cur) {
      delete cur[leaf]
    }
  }

  return JSON.stringify(parsed)
}

/**
 * 从 JSON body 中按「通配末段」剔除命中叶子字段（任意父路径均可），并重新序列化。
 * 规则形如 '*.timestamp' → 匹配任意层级下 key 为 'timestamp' 的字段并删除。
 * 非 JSON body / 无有效末段时原样返回。
 *
 * @param body JSON body 字符串
 * @param leafKeys 通配末段 key 列表（已去掉 '*.` 前缀）
 */
function stripJsonPathWildcard(body: string, leafKeys: string[]): string {
  if (!body) return body
  const targets = leafKeys.filter((k) => k.length > 0)
  if (targets.length === 0) return body
  let parsed: any
  try {
    parsed = JSON.parse(body)
  } catch {
    return body // 非 JSON，跳过路径剔除
  }
  if (parsed === null || typeof parsed !== 'object') return body

  for (const key of targets) {
    deleteByLeafKey(parsed, key)
  }
  return JSON.stringify(parsed)
}

/**
 * 递归删除对象（含数组）中所有 key 等于 target 的属性（任意层级、任意父路径）。
 * JSON key 大小写敏感，按原样匹配。
 *
 * @param obj 待处理对象
 * @param target 目标叶子 key
 */
function deleteByLeafKey(obj: any, target: string): void {
  if (obj === null || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const item of obj) deleteByLeafKey(item, target)
    return
  }
  // 先删除当前层匹配键
  if (Object.prototype.hasOwnProperty.call(obj, target)) {
    delete obj[target]
  }
  // 再递归子对象（已删除的键不会出现在剩余遍历中）
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (value && typeof value === 'object') {
      deleteByLeafKey(value, target)
    }
  }
}
