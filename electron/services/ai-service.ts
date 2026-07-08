/**
 * AI 大模型 API 调用服务
 * 支持 OpenAI 兼容接口（GPT/Claude/国产大模型）
 */
import OpenAI from 'openai'
import type { CaptureRequest, CompareRequest, CompareResult, DiffResult, IgnoreSuggestion, TemplateVariable } from '../../src/services/types'
import { TEMPLATE_VARIABLES } from '../../src/services/types'
import { computeDiff, serializeDiffForPrompt, applyIgnoreRules, mergeIgnoreRules } from '../../src/services/diff-engine'

/**
 * AI 对比 System Prompt（兼容结构化差异与原始报文回退两种措辞）
 */
const SYSTEM_PROMPT = `你是一个专业的接口数据对比分析专家。
下方是 diff 引擎算出的两个 HTTP 请求/响应的差异信息（优先为结构化差异）：
- 若内容以"[diff 引擎计算失败或响应体过大，已回退原始报文]"开头，则为原始报文的前 4000 字符截断，并非结构化差异，请据实分析
- 否则，概览行说明哪些是相同/不同的维度，各维度以 +（新增）/ -（删除）/ ~（修改）标记具体变化
请基于这些信息，分析：1) 业务影响 2) 可能的原因 3) 测试关注点。
若确实无差异，请明确说明"两次请求基本一致"。`

/** Tier 3：重试配置 */
const MAX_RETRIES = 2                 // 额外重试次数（总尝试 = MAX_RETRIES + 1）
const RETRY_BASE_DELAY_MS = 50        // 指数退避基数
/** Tier 3：缓存配置 */
const CACHE_TTL_MS = 5 * 60 * 1000    // 5 分钟
const MAX_CACHE_ENTRIES = 50           // 缓存条目上限，防长会话内存泄漏

/** 空 diff 结构（computeStructuredDiff 抛错时兜底，保证 diffResult 始终有值） */
const EMPTY_DIFF: DiffResult = {
  overview: { same: [], different: [], stats: { requestHeaders: { added: 0, removed: 0, modified: 0 }, requestBody: { changes: 0 }, responseHeaders: { added: 0, removed: 0, modified: 0 }, responseBody: { changes: 0 } } },
  requestHeaders: { added: {}, removed: {}, modified: [] },
  requestBody: { type: 'empty' },
  responseHeaders: { added: {}, removed: {}, modified: [] },
  responseBody: { type: 'empty' },
}

/** AI 请求互斥锁 */
let isComparing: boolean = false

/**
 * 检查是否正在对比中
 */
export function isCompareInProgress(): boolean {
  return isComparing
}

/**
 * 填充 Prompt 模板变量
 * @param template 模板字符串
 * @param request 对比请求参数
 * @param precomputedDiff 预计算的结构化差异（可选，避免重复计算）
 * @param ignoreRules 对比忽略规则（可选）；非空时在计算 diff 前剔除命中字段，并在 Prompt 末尾追加提示
 * @returns 填充后的 Prompt
 */
/**
 * 填充 Prompt 模板变量
 * @param template 模板字符串
 * @param request 对比请求参数
 * @returns 填充后的 Prompt
 */
export function fillPromptTemplate(
  template: string,
  request: CompareRequest,
  precomputedDiff?: DiffResult,
  ignoreRules?: string[],
): string {
  const { requestA, requestB } = request

  // 合并「用户规则」与「内置启发式名单」得到 effective rules，贯穿 diff 与附录
  const effectiveRules = mergeIgnoreRules(ignoreRules ?? [])

  // 前置 diff：计算结构化差异并序列化（应用 effective rules 剔除命中字段）
  let diffText = ''
  try {
    // 大请求体/响应体（>1MB）仍可能触发 diffJsonRecursive 纯递归栈溢出，提前跳过递归 diff
    const bodies = [requestA.requestBody, requestB.requestBody, requestA.responseBody, requestB.responseBody]
    const tooLarge = bodies.some((b) => (b || '').length > 1_000_000)
    if (tooLarge) {
      throw new Error('body too large (>1MB) for recursive diff, fallback to raw')
    }
    const diff = precomputedDiff ?? computeStructuredDiff(request, ignoreRules)
    diffText = serializeDiffForPrompt(diff, 200)
  } catch (e) {
    console.warn('[AI Service] diff 计算失败，回退原始 body 截断:', e)
    // 兜底注入原始 body 截断摘要（而非空白），防止默认模板下 AI 静默误判为"基本一致"
    diffText = `[diff 引擎计算失败或响应体过大，已回退原始报文前 4000 字符]\n` +
      `=== 请求A响应体(前4000字符) ===\n${(requestA.responseBody || '').slice(0, 4000)}\n` +
      `=== 请求B响应体(前4000字符) ===\n${(requestB.responseBody || '').slice(0, 4000)}`
  }

  // 若模板含 {diff_result}，则跳过旧 body 变量注入，确保降本生效
  const useDiffResult = template.includes('{diff_result}')

  const variables: Record<string, string> = {
    // —— 新增：结构化差异（核心优化）——
    '{diff_result}': diffText,
    // —— 保留：旧变量，确保用户自定义模板仍可工作；useDiffResult 时置空避免降本失效 ——
    '{path}': requestA.path,
    '{device_a_name}': requestA.deviceName || requestA.clientIp,
    '{device_b_name}': requestB.deviceName || requestB.clientIp,
    '{client_ip_a}': requestA.clientIp,
    '{client_ip_b}': requestB.clientIp,
    '{response_a_json}': useDiffResult ? '' : (requestA.responseBody || ''),
    '{response_b_json}': useDiffResult ? '' : (requestB.responseBody || ''),
    '{request_method}': requestA.method,
    '{request_headers_a}': JSON.stringify(requestA.requestHeaders, null, 2),
    '{request_headers_b}': JSON.stringify(requestB.requestHeaders, null, 2),
    // —— 新增：原始 body 不再默认注入，但保留变量供旧模板使用 ——
    '{url_a}': requestA.url,
    '{url_b}': requestB.url,
    '{status_a}': String(requestA.statusCode ?? ''),
    '{status_b}': String(requestB.statusCode ?? ''),
    '{request_body_a}': useDiffResult ? '' : (requestA.requestBody || ''),
    '{request_body_b}': useDiffResult ? '' : (requestB.requestBody || ''),
    '{response_headers_a}': JSON.stringify(requestA.responseHeaders, null, 2),
    '{response_headers_b}': JSON.stringify(requestB.responseHeaders, null, 2),
  }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(key).join(value)
  }

  // 追加忽略字段提示段（基于 effective rules，不破坏任何变量替换，仅追加在末尾）
  const appendix = buildIgnoreRulesAppendix(effectiveRules)
  return appendix ? result + appendix : result
}

/**
 * Prompt 注入用：忽略字段提示段头
 */
const IGNORE_RULES_HEADER =
  '【忽略字段】对比时请忽略以下字段，不要将其作为差异点报告（仅当字段名/路径匹配时）：'

/**
 * 构造忽略字段追加段（仅当 rules 非空返回非空字符串）。
 * 用于在主进程对比链路向 Prompt 末尾追加「请忽略这些字段」提示。
 * @param rules 忽略规则列表
 * @returns 追加段文本（含前后空行）；为空时返回 ''
 */
export function buildIgnoreRulesAppendix(rules: string[] | undefined): string {
  if (!rules || rules.length === 0) return ''
  const list = rules.map((r) => `- ${r}`).join('\n')
  return `\n\n${IGNORE_RULES_HEADER}\n${list}`
}

/**
 * 计算结构化差异（供 Prompt 注入与结果返回复用，单一数据源）
 * @throws 当任意 body >1MB 触发递归 diff 风险时抛出（调用方兜底）
 */
export function computeStructuredDiff(request: CompareRequest, ignoreRules?: string[]): DiffResult {
  const bodies = [request.requestA.requestBody, request.requestB.requestBody, request.requestA.responseBody, request.requestB.responseBody]
  const tooLarge = bodies.some((b) => (b || '').length > 1_000_000)
  if (tooLarge) {
    throw new Error('body too large (>1MB) for recursive diff, fallback to raw')
  }
  // 合并「用户规则」与「内置启发式名单」得到 effective rules，再应用
  const effectiveRules = mergeIgnoreRules(ignoreRules ?? [])
  // 应用对比忽略规则：剔除双方命中的 Header / Query 参数 / JSON body 路径后再 diff
  const a = effectiveRules.length ? applyIgnoreRules(request.requestA, effectiveRules) : request.requestA
  const b = effectiveRules.length ? applyIgnoreRules(request.requestB, effectiveRules) : request.requestB
  return computeDiff(a, b)
}

/**
 * 判断错误是否可重试（连接/超时/限流/5xx/网络层），401/404 等不可重试
 * @param err 捕获的错误
 * @returns 是否可重试
 */
function isRetryableError(err: any): boolean {
  const msg = ((err && err.message) || String(err) || '').toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('429') || msg.includes('rate limit') ||
    msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') ||
    msg.includes('econnreset') || msg.includes('etimedout') ||
    msg.includes('econnrefused') || msg.includes('enotfound') ||
    msg.includes('fetch failed') || msg.includes('network')
  )
}

/** 对比缓存条目 */
interface CompareCacheEntry {
  result: CompareResult
  expiresAt: number
}
const compareCache = new Map<string, CompareCacheEntry>()

/**
 * 稳定缓存 key：模型 + 模板 + 请求 A/B 关键身份（避免序列化超大 body）
 * 纳入 compareIgnoreRules 与 useBuiltinIgnore（历史兼容字段，已不再用于自动合并内置名单）。
 * @param request 对比请求
 * @returns 稳定 key 字符串
 */
export function cacheKey(request: CompareRequest): string {
  const sig = (r: any) => ({
    m: r.method, p: r.path, u: r.url, s: r.statusCode,
    c: r.clientIp, d: r.deviceName,
    h: r.requestHeaders, rh: r.responseHeaders,
    rbl: (r.requestBody || '').length, rbs: (r.requestBody || '').slice(0, 200),
    abl: (r.responseBody || '').length, abs: (r.responseBody || '').slice(0, 200),
  })
  const raw = JSON.stringify({
    m: request.modelName,
    t: request.promptTemplate,
    i: request.compareIgnoreRules ?? [],
    ub: request.useBuiltinIgnore ?? false,
    a: sig(request.requestA),
    b: sig(request.requestB),
  })
  let h = 0
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0
  return `cmp:${h}`
}

/**
 * 读取缓存（过期自动清理）
 * @param key 缓存 key
 * @returns 缓存的 CompareResult 或 null
 */
function getCached(key: string): CompareResult | null {
  const e = compareCache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { compareCache.delete(key); return null }
  return e.result
}

/**
 * 写入缓存
 * @param key 缓存 key
 * @param result 对比结果
 */
function setCached(key: string, result: CompareResult): void {
  // 上限保护：超过 MAX_CACHE_ENTRIES 时淘汰最旧一条，避免长会话内存泄漏
  if (!compareCache.has(key) && compareCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = compareCache.keys().next().value
    if (oldest !== undefined) compareCache.delete(oldest)
  }
  compareCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** 供测试/手动清理缓存 */
export function clearCompareCache(): void { compareCache.clear() }

/**
 * 延时辅助
 * @param ms 毫秒
 */
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

/**
 * AI 调用彻底失败时返回降级结果（不抛错），仍携带结构化 diff 供 UI/Tab 使用
 * @param request 对比请求
 * @param structuredDiff 已计算的结构化差异
 * @param reason 失败原因
 * @returns 降级 CompareResult（degraded: true）
 */
function buildFallbackResult(request: CompareRequest, structuredDiff: DiffResult, reason: string): CompareResult {
  const diffSummary = structuredDiff.overview.different.length
    ? `检测到 ${structuredDiff.overview.different.length} 处差异维度：${structuredDiff.overview.different.join('、')}。`
    : '结构化差异引擎未检测到明显不同维度。'
  return {
    analysis: `⚠️ AI 分析暂时不可用（${reason}），已降级为结构化差异概览：\n\n${diffSummary}\n\n请稍后重试「对比」以获取完整 AI 分析。`,
    modelName: request.modelName,
    path: request.requestA.path,
    deviceA: { name: request.requestA.deviceName || request.requestA.clientIp, ip: request.requestA.clientIp },
    deviceB: { name: request.requestB.deviceName || request.requestB.clientIp, ip: request.requestB.clientIp },
    isStreaming: false,
    diffResult: structuredDiff,
    degraded: true,
  }
}

/**
 * 单次流式对比（被重试包裹）；返回完整 CompareResult
 * @param request 对比请求
 * @param prompt 已填充的 Prompt
 * @param structuredDiff 已计算的结构化差异
 * @param onChunk 流式 token 回调
 * @returns 完整 CompareResult
 */
async function runStreamingCompare(
  request: CompareRequest,
  prompt: string,
  structuredDiff: DiffResult,
  onChunk?: (chunk: string) => void,
): Promise<CompareResult> {
  const client = new OpenAI({ baseURL: request.apiUrl, apiKey: request.apiKey, timeout: 90000 })
  const stream = await client.chat.completions.create({
    model: request.modelName,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    stream: true,
    temperature: 0.1,
  })
  let fullContent = ''
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      fullContent += content
      if (onChunk) onChunk(content)
    }
  }
  return {
    analysis: fullContent,
    modelName: request.modelName,
    path: request.requestA.path,
    deviceA: { name: request.requestA.deviceName || request.requestA.clientIp, ip: request.requestA.clientIp },
    deviceB: { name: request.requestB.deviceName || request.requestB.clientIp, ip: request.requestB.clientIp },
    isStreaming: false,
    diffResult: structuredDiff,
  }
}

/**
 * 执行 AI 对比（流式 + Tier 3 重试/降级/缓存）
 * @param request 对比请求参数
 * @param onChunk 流式 token 回调
 * @param onEnd 完成回调
 * @returns 对比结果（成功或降级，均不抛错；仅「对比进行中」互斥冲突会抛错）
 */
export async function executeCompare(
  request: CompareRequest,
  onChunk?: (chunk: string) => void,
  onEnd?: (result: CompareResult) => void,
): Promise<CompareResult> {
  if (isComparing) {
    throw new Error('AI 对比正在进行中，请等待完成后再试。')
  }

  // 1) 缓存命中：直接返回（模拟流式，先 onChunk 全文再 onEnd）
  const key = cacheKey(request)
  const cached = getCached(key)
  if (cached) {
    console.log('[AI Service] 命中对比缓存，跳过 AI 调用')
    if (onChunk) onChunk(cached.analysis)
    if (onEnd) onEnd(cached)
    return cached
  }

  isComparing = true
  try {
    // 2) 计算结构化 diff（单一数据源，先于 AI 与重试；应用对比忽略规则剔除命中字段）
    let structuredDiff: DiffResult
    try {
      structuredDiff = computeStructuredDiff(request, request.compareIgnoreRules)
    } catch {
      structuredDiff = EMPTY_DIFF
    }
    const prompt = fillPromptTemplate(request.promptTemplate, request, structuredDiff, request.compareIgnoreRules)

    // 3) 重试 + 降级
    let lastError: any = null
    let attempt = 0
    const maxAttempts = MAX_RETRIES + 1
    while (attempt < maxAttempts) {
      attempt++
      let gotChunkThisRun = false
      const chunkWrapper = (c: string) => { gotChunkThisRun = true; onChunk?.(c) }
      try {
        const result = await runStreamingCompare(request, prompt, structuredDiff, chunkWrapper)
        setCached(key, result)
        if (onEnd) onEnd(result)
        return result
      } catch (err) {
        lastError = err
        // 关键：若本次尝试已下发过 chunk，则不再重试（避免 UI 重复/错乱内容），直接降级
        const retryable = isRetryableError(err) && !gotChunkThisRun
        if (!retryable || attempt >= maxAttempts) break
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
        console.warn(`[AI Service] 第 ${attempt} 次对比失败，将在 ${delay}ms 后重试:`, (err as Error)?.message)
        await sleep(delay)
      }
    }

    // 4) 重试耗尽 → 降级（不抛错，返回结构化差异概览）
    const reason = (lastError instanceof Error ? lastError.message : String(lastError))
    console.error('[AI Service] 对比重试耗尽，降级为结构化差异概览:', reason)
    const fallback = buildFallbackResult(request, structuredDiff, `重试 ${maxAttempts} 次仍失败：${reason}`)
    setCached(key, fallback)
    if (onEnd) onEnd(fallback)
    return fallback
  } finally {
    isComparing = false
  }
}

/**
 * 测试 AI 连接
 * @param apiUrl API 地址
 * @param apiKey API Key
 * @param modelName 模型名称
 * @returns 测试结果
 */
export async function testConnection(
  apiUrl: string,
  apiKey: string,
  modelName: string
): Promise<{ success: boolean; message: string }> {
  try {
    const client = new OpenAI({
      baseURL: apiUrl,
      apiKey: apiKey,
    })

    const response = await client.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: 'Hello, respond with OK.' }],
      max_tokens: 10,
    })

    const choice = response.choices?.[0]
    if (!choice) {
      return { success: false, message: '连接成功但未返回任何结果，请检查模型名称。' }
    }

    // 兼容推理模型（content 可能为空，内容在 reasoning_content）
    const content = (choice.message as any).reasoning_content || choice.message.content || ''
    if (content) {
      return { success: true, message: `连接成功！模型响应: ${content.slice(0, 100)}` }
    } else {
      // 有 choice 但 content 为空，说明是推理模型且响应被截断（max_tokens=10）
      // 只要 API 调用成功就认为连接正常
      return { success: true, message: '连接成功！（推理模型，已确认 API 可达）' }
    }
  } catch (error: any) {
    const message = error?.message || '未知错误'
    if (message.includes('401') || message.includes('Unauthorized')) {
      return { success: false, message: 'API Key 无效，请检查配置。' }
    }
    if (message.includes('404') || message.includes('Not Found')) {
      return { success: false, message: '模型名称不存在或 API 地址错误。' }
    }
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      return { success: false, message: '无法连接到 API 服务器，请检查网络和 API 地址。' }
    }
    return { success: false, message: `连接失败: ${message}` }
  }
}

/**
 * 获取可用模板变量
 */
export function getTemplateVariables(): TemplateVariable[] {
  return TEMPLATE_VARIABLES
}

/**
 * AI「智能忽略」建议分析的 System Prompt
 * 要求模型只输出结构化的可忽略字段 JSON，不输出任何多余说明。
 */
const IGNORE_SUGGESTIONS_SYSTEM_PROMPT = `你是一个接口对比的"噪声字段"识别专家。
给定两次请求/响应的关键差异信息，请找出那些"易变、非业务相关、不应被视为真实差异"的字段，给出忽略建议：
- header：请求/响应头名（如 x-request-id、date、etag 等），用 name 字段
- query：URL 查询参数名（如 signature、timestamp 等），用 name 字段
- body：JSON 响应体中的路径（点号表示法，如 data.timestamp、user.token），用 path 字段
只输出 JSON，格式严格为：
{"suggestions":[{"category":"header"|"query"|"body","name"?:"字段名","path"?:"json.路径","reason":"为什么建议忽略"}]}
不要输出任何额外说明文字。若没有明显可忽略字段，返回 {"suggestions":[]}。`

/** AI 忽略建议分析超时（毫秒） */
const IGNORE_SUGGESTIONS_TIMEOUT_MS = 60_000

/**
 * 构造 AI「智能忽略」建议分析的 Prompt（聚焦头/Query/响应体等易变字段信息）
 * @param requestA 请求 A
 * @param requestB 请求 B
 * @returns 拼接好的用户 Prompt
 */
function buildIgnoreSuggestionsPrompt(requestA: CaptureRequest, requestB: CaptureRequest): string {
  const queryOf = (url: string): string => {
    try {
      const q = new URL(url).search
      return q || '(无)'
    } catch {
      return '(无)'
    }
  }
  return [
    `请求方法：A=${requestA.method}，B=${requestB.method}`,
    `URL：A=${requestA.url}`,
    `状态码：A=${requestA.statusCode ?? ''}，B=${requestB.statusCode ?? ''}`,
    `查询参数 A：${queryOf(requestA.url)}`,
    `查询参数 B：${queryOf(requestB.url)}`,
    `请求头 A：${JSON.stringify(requestA.requestHeaders)}`,
    `请求头 B：${JSON.stringify(requestB.requestHeaders)}`,
    `响应头 A：${JSON.stringify(requestA.responseHeaders)}`,
    `响应头 B：${JSON.stringify(requestB.responseHeaders)}`,
    `响应体 A（前 4000 字符）：${(requestA.responseBody || '').slice(0, 4000)}`,
    `响应体 B（前 4000 字符）：${(requestB.responseBody || '').slice(0, 4000)}`,
  ].join('\n')
}

/**
 * 将模型返回的 JSON 文本稳健解析为 IgnoreSuggestion[]。
 * - 支持标准 JSON 与「被额外说明文字包裹的 JSON 块」两种形态
 * - 过滤非法 category / 缺失 name(path) 的条目
 * - 任何解析失败都返回 []（绝不上抛，保证调用方拿到空数组兜底）
 * @param content 模型原始输出
 * @returns 忽略建议列表（已校验字段完整性）
 */
function parseIgnoreSuggestions(content: string): IgnoreSuggestion[] {
  const text = (content || '').trim()
  if (!text) return []

  let parsed: any = undefined
  try {
    parsed = JSON.parse(text)
  } catch {
    // 退化：从文本中提取第一个 {...} 块再解析
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return []
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return []
    }
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.suggestions
  if (!Array.isArray(list)) return []

  const out: IgnoreSuggestion[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const category = item.category
    if (category !== 'header' && category !== 'query' && category !== 'body') continue

    let name: string | undefined
    let path: string | undefined
    if (category === 'body') {
      path = typeof item.path === 'string' ? item.path.trim() : undefined
      if (!path) continue
    } else {
      name = typeof item.name === 'string' ? item.name.trim() : undefined
      if (!name) continue
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
    out.push({
      category,
      name,
      path,
      reason: reason || '模型建议忽略该字段（易变/噪声字段，非业务差异）',
    })
  }
  return out
}

/**
 * 分析对比结果，给出可忽略字段建议（AI「智能忽略」弹窗数据源）。
 * 非流式、带 JSON 结构化输出与 ~60s 超时；结果稳健解析，失败/异常/超时均返回 []。
 *
 * 注意：本函数只负责产出"建议"，去重与"只在有新增项时弹窗"由前端（CompareResult.vue）
 * 基于 settingsStore.compareIgnoreRules 完成，避免在后端耦合用户已有规则。
 *
 * @param requestA 请求 A
 * @param requestB 请求 B
 * @param aiConfig AI 配置（apiUrl / apiKey / modelName）
 * @returns 忽略建议列表（按 header / query / body 分类，每项含 reason）
 */
export async function analyzeIgnoreSuggestions(
  requestA: CaptureRequest,
  requestB: CaptureRequest,
  aiConfig: { apiUrl: string; apiKey: string; modelName: string },
): Promise<IgnoreSuggestion[]> {
  // 超时保护：~60s；无论成功失败都清除定时器，避免测试 / 长会话中悬挂的 pending timer 拖住事件循环
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`AI 忽略建议分析超时（${IGNORE_SUGGESTIONS_TIMEOUT_MS / 1000} 秒）`)),
      IGNORE_SUGGESTIONS_TIMEOUT_MS,
    )
  })

  const prompt = buildIgnoreSuggestionsPrompt(requestA, requestB)

  const call = async (): Promise<IgnoreSuggestion[]> => {
    const client = new OpenAI({ baseURL: aiConfig.apiUrl, apiKey: aiConfig.apiKey, timeout: IGNORE_SUGGESTIONS_TIMEOUT_MS })
    const res = await client.chat.completions.create({
      model: aiConfig.modelName,
      messages: [
        { role: 'system', content: IGNORE_SUGGESTIONS_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })
    const content = res.choices?.[0]?.message?.content ?? ''
    return parseIgnoreSuggestions(content)
  }

  try {
    return await Promise.race([call(), timeout])
  } catch (err) {
    console.error('[AI Service] 忽略建议分析失败，返回空列表:', (err as Error)?.message || err)
    return []
  } finally {
    if (timer) clearTimeout(timer)
  }
}
