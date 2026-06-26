/**
 * AI 分析服务（纯 AI Agent 模式）
 *
 * 实现方式：
 * - 使用 AI Agent 模式（Function Calling）直接分析代码仓库
 * - 支持流式输出，实时推送分析过程到前端
 * - 不依赖 ScanWorker，完全由 AI 自主搜索和分析
 *
 * 工作流程：
 * 1. 构建 System Prompt 和 User Prompt
 * 2. 调用 AI API（支持流式输出）
 * 3. AI 通过工具调用（Function Calling）自主搜索代码
 * 4. 实时推送分析过程（agent_thinking, agent_tool_call, agent_tool_result）
 * 5. 生成最终分析报告
 */
import type { BrowserWindow } from 'electron'
import type { RouteMatch, AnalysisScenario } from '../../src/services/types'
import type { CodeExplorationResult } from './types'
import OpenAI from 'openai'
import { AIAgentToolExecutor, type ToolCallResult } from './ai-agent-tool-executor'
import { loadPrompt } from './prompts/prompt-loader'
// @ts-ignore - sse-manager.ts 导出在运行时可用
import { pushLog, pushProgress, pushDone, pushError, pushSSEEvent } from '../sse-manager'

/**
 * 进度推送回调
 */
export type ProgressCallback = (
  event: 'log' | 'progress' | 'done' | 'error',
  data: any
) => void

/**
 * 分析请求参数
 */
export interface AnalyzeRequest {
  /** 仓库本地路径 */
  clonePath: string
  /** HTTP 方法 */
  method: string
  /** 请求路径 */
  url: string
  /** 请求体（Phase 2 生成 curl 时使用） */
  requestBody?: string
  /** 请求头（Phase 2 生成 curl 时使用） */
  requestHeaders?: Record<string, string | string[]>
}

/**
 * 分析结果
 */
export interface AnalyzeResult {
  /** 路由匹配结果 */
  matches: RouteMatch[]
  /** 分析报告（Markdown 格式） */
  analysis: string
  /** 结构化场景列表 */
  scenarios: AnalysisScenario[]
}

/**
 * AI 分析服务（纯 AI Agent 模式）
 */
export class AIAnalyzeService {
  private mainWindow: BrowserWindow
  private openai: OpenAI | null = null
  private apiKey: string = ''
  private baseURL: string = ''
  private modelName: string = 'deepseek-chat'
  private progressCallback: ProgressCallback | null = null

  constructor(
    mainWindow: BrowserWindow,
    apiKey?: string,
    baseURL?: string,
    progressCallback?: ProgressCallback
  ) {
    this.mainWindow = mainWindow
    if (apiKey) {
      this.updateApiConfig(apiKey, baseURL)
    }
    if (progressCallback) {
      this.progressCallback = progressCallback
    }
    console.log('[AIAnalyzeService] 初始化完成（纯 AI Agent 模式）')
  }

  /**
   * 更新 AI API 配置
   * @param apiKey API Key
   * @param baseURL 基础 URL（可选，用于兼容非 OpenAI API）
   */
  updateApiConfig(apiKey: string, baseURL?: string): void {
    this.apiKey = apiKey
    this.baseURL = baseURL || ''
    this.openai = new OpenAI({
      apiKey,
      baseURL: baseURL || undefined,
    })
    console.log('[AIAnalyzeService] API 配置已更新')
  }

  /**
   * 执行 AI 代码分析（纯 AI Agent 模式）
   *
   * 工作流程：
   * 1. 直接调用 AI Agent 分析
   * 2. AI 通过工具调用自主搜索代码
   * 3. 实时推送分析过程
   * 4. 生成分析报告
   *
   * @param request 分析请求参数
   * @returns 分析结果
   */
  async analyze(request: AnalyzeRequest): Promise<AnalyzeResult> {
    const { clonePath, method, url } = request

    if (!this.openai) {
      throw new Error('AI API 未配置，请先在设置页面配置 API Key。')
    }

    console.log(`[AIAnalyzeService] 开始分析: ${method} ${url}`)
    console.log(`[AIAnalyzeService] 仓库路径: ${clonePath}`)

    // 两阶段 Pipeline：先尝试新版，失败则降级到旧版
    try {
      return await this.analyzeWithTwoPhasePipeline(request)
    } catch (pipelineError: any) {
      console.error('[AIAnalyzeService] ❌ 两阶段 Pipeline 失败，准备降级到单 Agent 模式')
      console.error('[AIAnalyzeService] ❌ 错误类型:', pipelineError.constructor.name)
      console.error('[AIAnalyzeService] ❌ 错误消息:', pipelineError.message)
      console.error('[AIAnalyzeService] ❌ 错误堆栈:', pipelineError.stack)
      // 重置 phase 到 'analyzing'，避免 store 的 agentThinking 分隔逻辑误插入分隔线
      this.pushProgress('ai-agent', '两阶段分析失败，降级到单 Agent 模式')
      this.pushAgentThinking('\n\n--- 两阶段分析失败，降级到单 Agent 模式 ---\n\n')
      return this.analyzeWithAgentLegacy(request)
    }
  }

  // ============================================================
  // 两阶段 Pipeline（v2.0）
  // ============================================================

  /**
   * 两阶段 Pipeline：Code Explorer → Test Case Generator
   */
  private async analyzeWithTwoPhasePipeline(request: AnalyzeRequest): Promise<AnalyzeResult> {
    const { clonePath, method, url, requestBody, requestHeaders } = request

    // Phase 1: Code Explorer
    this.pushProgress('code-explorer', 'Phase 1: 开始探索代码...')
    const explorationResult = await this.phase1ExploreCode(clonePath, method, url, requestBody, requestHeaders)

    // Phase 2: Test Case Generator
    this.pushProgress('test-generator', 'Phase 2: 开始生成测试用例...')
    const testResult = await this.phase2GenerateTests(method, url, requestBody, requestHeaders, explorationResult)

    // 组装结果
    const analysisSummary = this.buildAnalysisSummary(explorationResult, testResult)
    const matches: RouteMatch[] = [{
      filePath: explorationResult.entryPoint.handlerFile,
      content: '',
      routePattern: explorationResult.entryPoint.routePattern,
      handlerName: explorationResult.entryPoint.handlerFunction,
      lineNumber: 0,
    } as any]

    this.pushAgentComplete(analysisSummary, testResult.scenarios)
    console.log(`[AIAnalyzeService] 两阶段 Pipeline 完成，${testResult.scenarios.length} 个场景`)

    return {
      matches,
      analysis: analysisSummary,
      scenarios: testResult.scenarios,
    }
  }

  // ============================================================
  // Phase 1: Code Explorer Agent
  // ============================================================

  /**
   * Phase 1: 探索代码，追踪完整调用链路
   */
  private async phase1ExploreCode(
    clonePath: string,
    method: string,
    url: string,
    requestBody?: string,
    requestHeaders?: Record<string, string | string[]>,
  ): Promise<CodeExplorationResult> {
    const toolExecutor = new AIAgentToolExecutor(clonePath)
    // 不再限制工具调用次数，让 AI 无限探索直至完成
    // 仅保留超时保护（10 分钟），防止死循环
    const PHASE1_TIMEOUT_MS = 10 * 60 * 1000

    // 加载 Prompt（带变量替换）
    const systemPrompt = loadPrompt('code-explorer-system')
    const userPrompt = loadPrompt('code-explorer-user', {
      METHOD: method,
      PATH: url,
      URL: url,
      REQUEST_BODY: requestBody || '{}',
      REQUEST_HEADERS: requestHeaders ? JSON.stringify(requestHeaders, null, 2) : '{}',
    })

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    // 工具定义（与 Phase 2 共用同一套工具）
    const tools = this.getTools()
    let toolCallCount = 0
    let explorationResult: CodeExplorationResult | null = null
    const startTime = Date.now()

    try {
      while (true) {
        // 超时检查：超过 10 分钟则强制要求 AI 输出 JSON
        if (Date.now() - startTime > PHASE1_TIMEOUT_MS) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          console.warn(`[Phase1] ⏰ 已达到超时上限（${elapsed}s），正在强制生成最终结果...`)
          this.pushAgentThinking('[代码探索] 已达到超时上限（10分钟），正在强制生成最终结果...', 'explorer')
          messages.push({
            role: 'user',
            content: '时间已到，请立即输出完整的 JSON 结果（包含 entryPoint、fullCallChain、params、respStructure、businessRules、errorPaths、externalCalls）。不要调用任何工具，只输出 JSON。',
          })
          const finalResponse = await this.openai!.chat.completions.create({
            model: this.modelName,
            messages,
          })
          const content = finalResponse.choices[0].message.content || ''
          console.log(`[Phase1] ⏰ 超时强制输出，AI 返回内容长度: ${content.length}`)
          try {
            explorationResult = this.parseExplorationResult(content)
            console.log('[Phase1] ⏰ 超时强制输出解析成功')
          } catch (parseError: any) {
            console.warn('[Phase1] ⏰ 超时后解析失败，尝试从对话历史提取:', parseError.message)
            explorationResult = this.extractExplorationFromHistory(messages)
            if (explorationResult) {
              console.log('[Phase1] ⏰ 从历史提取成功，entryPoint:', explorationResult.entryPoint)
            } else {
              console.error('[Phase1] ⏰ 从历史提取也失败，explorationResult 为 null')
            }
          }
          break
        }

        this.pushAgentThinking(`[代码探索] 正在推理（第 ${toolCallCount + 1} 轮）...`, 'explorer')

        let stream
        try {
          stream = await this.openai!.chat.completions.create({
            model: this.modelName,
            messages,
            tools,
            tool_choice: 'auto',
            stream: true,
          })
        } catch (apiError: any) {
          console.error('[Phase1] ❌ API 调用失败（第 ${toolCallCount + 1} 轮）')
          console.error('[Phase1] ❌ API 错误类型:', apiError.constructor.name)
          console.error('[Phase1] ❌ API 错误消息:', apiError.message)
          console.error('[Phase1] ❌ API 错误堆栈:', apiError.stack)
          throw apiError
        }

        let fullContent = ''
        let toolCallsBuffer: Array<{ id: string; function: { name: string; arguments: string } }> = []

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          // 正常内容（最终答案 / JSON 输出）
          if (delta?.content) {
            fullContent += delta.content
            this.pushAgentThinking(delta.content, 'explorer')
          }
          // 推理模型的思考过程（deepseek-v4-pro 等）
          const reasoning = (delta as any)?.reasoning_content
          if (reasoning) {
            this.pushAgentThinking(reasoning, 'explorer')
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index || 0
              if (!toolCallsBuffer[index]) toolCallsBuffer[index] = { id: '', function: { name: '', arguments: '' } }
              if (tc.id) toolCallsBuffer[index].id = tc.id
              if (tc.function?.name) toolCallsBuffer[index].function.name += tc.function.name
              if (tc.function?.arguments) toolCallsBuffer[index].function.arguments += tc.function.arguments
            }
          }
        }

        // 没有工具调用 → AI 已生成最终 JSON
        if (toolCallsBuffer.length === 0 && fullContent) {
          this.pushAgentThinking('[代码探索] 探索完成，正在解析结果...', 'explorer')
          explorationResult = this.parseExplorationResult(fullContent)
          break
        }

        // 执行工具调用
        if (toolCallsBuffer.length > 0) {
          const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
            role: 'assistant',
            content: fullContent || null,
            tool_calls: toolCallsBuffer.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          }
          messages.push(assistantMsg)

          for (const tc of toolCallsBuffer) {
            const toolName = tc.function.name
            let args: Record<string, any> = {}
            try { args = JSON.parse(tc.function.arguments) } catch { args = {} }

            this.pushAgentToolCall(toolName, args)
            this.pushProgress('code-explorer', `[代码探索] 调用工具: ${toolName}（累计 ${toolCallCount + 1} 次）`)

            const result = await toolExecutor.executeTool(toolName, args)
            this.pushAgentToolResult(toolName, result)

            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
            toolCallCount++

            if (!result.success) {
              console.warn(`[Phase1] 工具 ${toolName} 执行失败:`, result.error)
            }
          }
          continue
        }
        break
      }

      if (!explorationResult) {
        throw new Error('Code Explorer 未返回有效结果')
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[Phase1] 探索完成（耗时 ${elapsed}s，共 ${toolCallCount} 轮工具调用），入参: ${explorationResult.params.length} 个，错误路径: ${explorationResult.errorPaths.length} 个，业务规则: ${explorationResult.businessRules.length} 个`)
      return explorationResult

    } catch (error: any) {
      console.error('[Phase1] ❌ 代码探索失败')
      console.error('[Phase1] ❌ 错误类型:', error.constructor.name)
      console.error('[Phase1] ❌ 错误消息:', error.message)
      console.error('[Phase1] ❌ 错误堆栈:', error.stack)
      throw error
    }
  }

  /**
   * 解析 Phase 1 Code Explorer 的 JSON 输出
   * 含格式修复逻辑（AI 可能在 JSON 前后加说明文字，或输出语法不完整的 JSON）
   */
  private parseExplorationResult(content: string): CodeExplorationResult {
    // 1. 智能提取 JSON 字符串（找到第一个 { 然后匹配括号）
    const jsonStr = this.extractJsonString(content)
    if (!jsonStr) {
      console.error('[parseExplorationResult] ❌ 未找到 JSON 字符串')
      throw new Error('AI 输出中未找到 JSON')
    }

    // 2. 尝试直接解析
    try {
      const parsed = JSON.parse(jsonStr)
      console.log('[parseExplorationResult] ✅ JSON 解析成功')
      return this.buildExplorationResult(parsed)
    } catch (parseError: any) {
      console.warn('[parseExplorationResult] ⚠️ 首次解析失败，尝试修复:', parseError.message)

      // 3. 尝试修复常见 JSON 语法问题
      const repaired = this.repairJson(jsonStr)
      if (repaired) {
        try {
          const parsed = JSON.parse(repaired)
          console.log('[parseExplorationResult] ✅ 修复后解析成功')
          return this.buildExplorationResult(parsed)
        } catch (repairError: any) {
          console.warn('[parseExplorationResult] ⚠️ 修复后仍然失败:', repairError.message)
        }
      }

      // 4. 尝试从原始内容中用正则提取关键字段（最后降级）
      const partial = this.extractPartialExploration(content)
      if (partial) {
        console.log('[parseExplorationResult] ⚠️ 使用部分提取数据（字段可能不完整）')
        return partial
      }

      // 5. 全部失败，抛原错误
      const rawPreview = content.substring(0, 2000)
      console.error('[parseExplorationResult] ❌ JSON 解析失败（位置 ' + this.findJsonErrorPosition(jsonStr, parseError.message) + '):', parseError.message)
      console.error('[parseExplorationResult] ❌ AI 原始输出（前 2000 字符）:\n', rawPreview)
      throw new Error(`Code Explorer 输出解析失败: ${parseError.message}`)
    }
  }

  /**
   * 从文本中智能提取 JSON 字符串
   * 找到第一个 { 然后手动匹配花括号/方括号，处理字符串内的括号
   */
  private extractJsonString(content: string): string | null {
    // 先找 ```json ... ``` 代码块
    const codeBlockMatch = content.match(/```json\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim()
    }

    // 再找第一个 { 然后匹配括号
    const startIdx = content.indexOf('{')
    if (startIdx === -1) return null

    let depth = 0
    let inString = false
    let escapeNext = false
    const stack: string[] = [] // 记录打开的括号类型

    for (let i = startIdx; i < content.length; i++) {
      const ch = content[i]

      if (escapeNext) { escapeNext = false; continue }
      if (ch === '\\') { escapeNext = true; continue }

      if (ch === '"' && !escapeNext) {
        inString = !inString
        continue
      }

      if (inString) continue

      if (ch === '{' || ch === '[') {
        depth++
        stack.push(ch)
      } else if (ch === '}') {
        depth--
        if (stack.pop() !== '{') return null // 括号不匹配
      } else if (ch === ']') {
        depth--
        if (stack.pop() !== '[') return null
      }

      if (depth === 0 && stack.length === 0) {
        return content.substring(startIdx, i + 1)
      }
    }

    // 到达文本末尾，depth > 0 说明 JSON 被截断，尝试自动补全
    if (depth > 0) {
      console.warn('[extractJsonString] ⚠️ JSON 被截断，尝试自动补全...')
      let truncated = content.substring(startIdx)
      // 自动补全未关闭的括号
      while (stack.length > 0) {
        const open = stack.pop()!
        truncated += open === '{' ? '}' : ']'
      }
      return truncated
    }

    return null
  }

  /**
   * 修复常见 JSON 语法问题
   */
  private repairJson(jsonStr: string): string | null {
    try {
      let s = jsonStr

      // 1. 转义 JSON 字符串值内的控制字符（最核心的修复）
      s = this.escapeControlCharsInJson(s)

      // 2. 去掉 trailing commas
      s = s.replace(/,\s*([\}\]])/g, '$1')

      // 3. 统一逗号前后的空格
      s = s.replace(/\s*,\s*/g, ', ')

      // 4. 修复缺少引号的 key
      s = s.replace(/([\{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')

      return s
    } catch {
      return null
    }
  }

  /**
   * 转义 JSON 字符串值内的控制字符
   * 遍历字符，在 inString=true 时把实际换行符等转成 \n \r \t 等转义序列
   * 正确处理已转义的字符（如已有的 \n 不会被重复转义）
   */
  private escapeControlCharsInJson(input: string): string {
    let result = ''
    let inString = false
    let escaped = false

    for (let i = 0; i < input.length; i++) {
      const ch = input[i]

      if (escaped) {
        result += ch
        escaped = false
        continue
      }

      if (ch === '\\') {
        result += ch
        escaped = true
        continue
      }

      if (ch === '"') {
        result += ch
        inString = !inString
        continue
      }

      if (inString) {
        const code = ch.charCodeAt(0)
        if (code < 32) {
          switch (ch) {
            case '\n': result += '\\n'; break
            case '\r': result += '\\r'; break
            case '\t': result += '\\t'; break
            case '\b': result += '\\b'; break
            case '\f': result += '\\f'; break
            default:
              result += '\\u' + code.toString(16).padStart(4, '0')
          }
          continue
        }
      }

      result += ch
    }

    return result
  }

  /**
   * 从文本内容中用正则提取部分字段（最后降级方案）
   */
  private extractPartialExploration(content: string): CodeExplorationResult | null {
    try {
      const result: CodeExplorationResult = {
        entryPoint: { handlerFile: '', handlerFunction: '', routePattern: '', framework: 'unknown' },
        fullCallChain: [],
        params: [],
        respStructure: { type: 'object', fields: [] },
        businessRules: [],
        errorPaths: [],
        externalCalls: [],
      }

      // 提取 entryPoint
      const entryMatch = content.match(/"handlerFile"\s*:\s*"([^"]+)"/)
      if (entryMatch) result.entryPoint.handlerFile = entryMatch[1]

      const funcMatch = content.match(/"handlerFunction"\s*:\s*"([^"]+)"/)
      if (funcMatch) result.entryPoint.handlerFunction = funcMatch[1]

      const routeMatch = content.match(/"routePattern"\s*:\s*"([^"]+)"/)
      if (routeMatch) result.entryPoint.routePattern = routeMatch[1]

      const fwMatch = content.match(/"framework"\s*:\s*"([^"]+)"/)
      if (fwMatch) (result.entryPoint as any).framework = fwMatch[1]

      // 提取 params（简单字段）
      const paramMatches = Array.from(content.matchAll(/"name"\s*:\s*"([^"]+)"\s*/g))
      for (const m of paramMatches) {
        result.params.push({
          name: m[1],
          location: 'body' as const,
          type: 'string',
          required: true,
          constraints: { min: null, max: null, pattern: null, enum: null },
          defaultValue: null,
          description: '',
          sourceTag: 'partial-extraction',
        })
      }

      // 只要拿到了 handlerFile 就认为有部分数据
      if (result.entryPoint.handlerFile) {
        return result
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 找到 JSON 解析错误的近似位置（用于日志）
   */
  private findJsonErrorPosition(jsonStr: string, errorMessage: string): string {
    const posMatch = errorMessage.match(/position\s+(\d+)/)
    if (posMatch) {
      const pos = parseInt(posMatch[1])
      const line = jsonStr.substring(0, pos).split('\n').length
      return `position ${pos}, line ${line}`
    }
    return errorMessage
  }

  /**
   * 从解析后的对象构建 CodeExplorationResult
   */
  private buildExplorationResult(parsed: any): CodeExplorationResult {
    if (!parsed.entryPoint) {
      throw new Error('JSON 缺少 entryPoint 字段')
    }

    return {
      entryPoint: {
        handlerFile: parsed.entryPoint.handlerFile || '',
        handlerFunction: parsed.entryPoint.handlerFunction || '',
        routePattern: parsed.entryPoint.routePattern || '',
        framework: parsed.entryPoint.framework || 'unknown',
      },
      fullCallChain: parsed.fullCallChain || [],
      params: parsed.params || [],
      respStructure: parsed.respStructure || { type: 'object', fields: [] },
      businessRules: parsed.businessRules || [],
      errorPaths: parsed.errorPaths || [],
      externalCalls: parsed.externalCalls || [],
    }
  }

  /**
   * 从对话历史中提取代码探索结果（降级方案）
   * 当 AI 无法输出完整 JSON 时，尝试从工具调用结果中构建最小可用的 CodeExplorationResult
   */
  private extractExplorationFromHistory(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): CodeExplorationResult | null {
    console.log(`[extractExplorationFromHistory] 开始从 ${messages.length} 条消息中提取...`)
    
    // 构建一个最小的 CodeExplorationResult
    const result: CodeExplorationResult = {
      entryPoint: { handlerFile: '', handlerFunction: '', routePattern: '', framework: 'unknown' },
      fullCallChain: [],
      params: [],
      respStructure: { type: 'object', fields: [] },
      businessRules: [],
      errorPaths: [],
      externalCalls: [],
    }

    let hasUsefulData = false
    let jsonMatchCount = 0

    // 遍历对话历史，从 assistant 消息中提取有用信息
    for (const msg of messages) {
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        // 尝试从 assistant 消息中提取 JSON
        const jsonMatch = msg.content.match(/\{[\s\S]*"entryPoint"[\s\S]*\}/)
        if (jsonMatch) {
          jsonMatchCount++
          console.log(`[extractExplorationFromHistory] 找到第 ${jsonMatchCount} 个 JSON match，正在解析...`)
          try {
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.entryPoint) {
              result.entryPoint = {
                handlerFile: parsed.entryPoint.handlerFile || '',
                handlerFunction: parsed.entryPoint.handlerFunction || '',
                routePattern: parsed.entryPoint.routePattern || '',
                framework: parsed.entryPoint.framework || 'unknown',
              }
              result.fullCallChain = parsed.fullCallChain || []
              result.params = parsed.params || []
              result.respStructure = parsed.respStructure || { type: 'object', fields: [] }
              result.businessRules = parsed.businessRules || []
              result.errorPaths = parsed.errorPaths || []
              result.externalCalls = parsed.externalCalls || []
              hasUsefulData = true
              console.log('[extractExplorationFromHistory] ✅ 从对话历史中找到完整 JSON，entryPoint:', result.entryPoint)
              break
            }
          } catch (parseErr: any) {
            console.warn(`[extractExplorationFromHistory] ⚠️ JSON 解析失败（第 ${jsonMatchCount} 个 match）:`, parseErr.message)
            // JSON 解析失败，继续
          }
        }
      }
    }

    if (!hasUsefulData) {
      console.warn(`[extractExplorationFromHistory] ❌ 无法从对话历史中提取有用数据（扫描了 ${messages.length} 条消息，找到 ${jsonMatchCount} 个 JSON match）`)
      return null
    }

    return result
  }

  // ============================================================
  // Phase 2: Test Case Generator Agent
  // ============================================================

  /**
   * Phase 2: 根据代码分析结果生成测试用例
   */
  private async phase2GenerateTests(
    method: string,
    url: string,
    requestBody: string | undefined,
    requestHeaders: Record<string, string | string[]> | undefined,
    explorationResult: CodeExplorationResult,
  ): Promise<{ scenarios: AnalysisScenario[]; analysisSummary: string }> {
    // 加载 Prompt
    const systemPrompt = loadPrompt('test-generator-system')
    const userPrompt = loadPrompt('test-generator-user', {
      METHOD: method,
      PATH: url,
      URL: url,
      REQUEST_BODY: requestBody || '{}',
      REQUEST_HEADERS: requestHeaders ? JSON.stringify(requestHeaders, null, 2) : '{}',
      CODE_EXPLORATION_RESULT: JSON.stringify(explorationResult, null, 2),
    })

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    // Phase 2 不传 tools：纯推理，不需要调用工具
    let scenarios: AnalysisScenario[] = []
    let analysisSummary = ''

    try {
      this.pushAgentThinking('[测试生成] 正在推理...', 'generator')

      let stream
      try {
        stream = await this.openai!.chat.completions.create({
          model: this.modelName,
          messages,
          stream: true,
        })
      } catch (apiError: any) {
        console.error('[Phase2] ❌ API 调用失败')
        console.error('[Phase2] ❌ API 错误类型:', apiError.constructor.name)
        console.error('[Phase2] ❌ API 错误消息:', apiError.message)
        console.error('[Phase2] ❌ API 错误堆栈:', apiError.stack)
        throw apiError
      }

      let fullContent = ''
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (delta?.content) {
          fullContent += delta.content
          this.pushAgentThinking(delta.content, 'generator')
        }
        // 推理模型的思考过程
        const reasoning = (delta as any)?.reasoning_content
        if (reasoning) {
          this.pushAgentThinking(reasoning, 'generator')
        }
      }

      if (fullContent) {
        this.pushAgentThinking('[测试生成] 生成完成，正在解析结果...', 'generator')
        const parsed = this.parseScenariosResult(fullContent)
        scenarios = parsed.scenarios
        analysisSummary = parsed.analysisSummary
      }

      console.log(`[Phase2] 生成完成，${scenarios.length} 个场景`)
      return { scenarios, analysisSummary }

    } catch (error: any) {
      console.error('[Phase2] ❌ 测试用例生成失败')
      console.error('[Phase2] ❌ 错误类型:', error.constructor.name)
      console.error('[Phase2] ❌ 错误消息:', error.message)
      console.error('[Phase2] ❌ 错误堆栈:', error.stack)
      throw error
    }
  }

  /**
   * 解析 Phase 2 Test Generator 的 JSON 输出（含修复逻辑）
   */
  private parseScenariosResult(content: string): { scenarios: AnalysisScenario[]; analysisSummary: string } {
    // 1. 智能提取 JSON 字符串
    const jsonStr = this.extractJsonString(content)
    if (!jsonStr) {
      console.error('[parseScenariosResult] ❌ 未找到 JSON 字符串')
      throw new Error('AI 输出中未找到 JSON')
    }

    // 2. 尝试直接解析
    try {
      const parsed = JSON.parse(jsonStr)
      console.log('[parseScenariosResult] ✅ JSON 解析成功')
      return this.buildScenariosResult(parsed)
    } catch (parseError: any) {
      console.warn('[parseScenariosResult] ⚠️ 首次解析失败，尝试修复:', parseError.message)

      // 3. 尝试修复
      const repaired = this.repairJson(jsonStr)
      if (repaired) {
        try {
          const parsed = JSON.parse(repaired)
          console.log('[parseScenariosResult] ✅ 修复后解析成功')
          return this.buildScenariosResult(parsed)
        } catch (repairError: any) {
          console.warn('[parseScenariosResult] ⚠️ 修复后仍然失败:', repairError.message)
        }
      }

      // 4. 全部失败
      const rawPreview = content.substring(0, 2000)
      const posInfo = this.findJsonErrorPosition(jsonStr, parseError.message)
      console.error(`[parseScenariosResult] ❌ JSON 解析失败（${posInfo}）:`, parseError.message)
      console.error('[parseScenariosResult] ❌ AI 原始输出（前 2000 字符）:\n', rawPreview)
      throw new Error(`Test Generator 输出解析失败: ${parseError.message}`)
    }
  }

  /**
   * 从解析后的对象构建 scenarios 结果
   */
  private buildScenariosResult(parsed: any): { scenarios: AnalysisScenario[]; analysisSummary: string } {
    const scenarios: AnalysisScenario[] = (parsed.scenarios || []).map((s: any) => ({
      scenarioName: s.scenarioName || '未知场景',
      scenarioType: s.scenarioType || 'normal',
      expectedStatusCode: s.expectedStatusCode || 200,
      testData: s.testData || {},
      callChain: s.callChain || [],
      curlCommand: s.curlCommand || '',
      pythonAssertion: s.pythonAssertion || '',
    }))

    return {
      scenarios,
      analysisSummary: parsed.analysisSummary || '',
    }
  }

  /**
   * 构建分析摘要（合并 Phase 1 和 Phase 2 的结果）
   */
  private buildAnalysisSummary(exploration: CodeExplorationResult, testResult: { scenarios: AnalysisScenario[]; analysisSummary: string }): string {
    const ep = exploration.entryPoint
    let summary = `## 分析完成\n\n`
    summary += `**入口**: \`${ep.routePattern}\` → \`${ep.handlerFunction}()\`\n`
    summary += `**框架**: ${ep.framework}\n`
    summary += `**调用链深度**: ${exploration.fullCallChain.length} 层\n`
    summary += `**入参数量**: ${exploration.params.length} 个\n`
    summary += `**错误路径**: ${exploration.errorPaths.length} 个\n`
    summary += `**业务规则**: ${exploration.businessRules.length} 个\n`
    summary += `**外部调用**: ${exploration.externalCalls.length} 个\n`
    summary += `**生成场景**: ${testResult.scenarios.length} 个\n\n`

    if (testResult.analysisSummary) {
      summary += testResult.analysisSummary
    }

    return summary
  }

  // ============================================================
  // 工具定义（Phase 1/Phase 2 共用）
  // ============================================================

  /**
   * 获取 Function Calling 工具定义
   */
  private getTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: '列出指定目录下的所有文件和子目录。用于了解项目结构。',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '目录路径（相对于仓库根目录，如 "internal/web" 或 "." 表示根目录）',
              },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取指定文件的全部内容。用于查看文件代码。',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '文件路径（相对于仓库根目录，如 "internal/web/user_handler.go"）',
              },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_code',
          description: '在仓库中搜索包含指定关键字的代码文件。支持正则表达式。',
          parameters: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
                description: '搜索关键字或正则表达式（如 "RegisterRoutes"、".GET("）',
              },
              file_pattern: {
                type: 'string',
                description: '文件匹配模式（如 "*.go"、"*.java"），可选',
              },
            },
            required: ['keyword'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_file_tree',
          description: '获取仓库完整文件树（仅返回文件路径列表，不返回文件内容）。用于快速了解项目结构。',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ]
  }

  // ============================================================
  // 旧版单 Agent 模式（降级回退）
  // ============================================================

  /**
   * 旧版单 Agent 分析（降级回退）
   */
  private async analyzeWithAgentLegacy(request: AnalyzeRequest): Promise<AnalyzeResult> {
    const { clonePath, method, url } = request
    const toolExecutor = new AIAgentToolExecutor(clonePath)

    this.pushAgentThinking('开始分析代码仓库（单 Agent 模式）...')
    this.pushProgress('ai-agent', 'AI 正在分析代码仓库')

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: this.getLegacySystemPrompt() },
      { role: 'user', content: this.buildLegacyUserPrompt(method, url) },
    ]

    const tools = this.getTools()
    // 不再限制工具调用次数，仅保留超时保护
    const LEGACY_TIMEOUT_MS = 10 * 60 * 1000
    let toolCallCount = 0
    let finalAnalysis = ''
    let finalScenarios: AnalysisScenario[] = []
    let finalMatches: RouteMatch[] = []
    const conversationMessages = [...messages]
    const startTime = Date.now()

    try {
      while (true) {
        // 超时检查
        if (Date.now() - startTime > LEGACY_TIMEOUT_MS) {
          this.pushAgentThinking('已达到超时上限（10分钟），正在强制生成最终报告...')
          const finalResponse = await this.openai!.chat.completions.create({
            model: this.modelName,
            messages: conversationMessages,
          })
          const content = finalResponse.choices[0].message.content || '分析超时，请重试。'
          const { analysis, scenarios, matches } = this.parseLegacyAIResponse(content)
          finalAnalysis = analysis
          finalScenarios = scenarios
          finalMatches = matches
          break
        }

        this.pushAgentThinking(`正在推理（第 ${toolCallCount + 1} 轮）...`)

        const stream = await this.openai!.chat.completions.create({
          model: this.modelName,
          messages: conversationMessages,
          tools,
          tool_choice: 'auto',
          stream: true,
        })

        let fullContent = ''
        let toolCallsBuffer: Array<{ id: string; function: { name: string; arguments: string } }> = []

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          if (delta?.content) {
            fullContent += delta.content
            this.pushAgentThinking(delta.content)
          }
          // 推理模型的思考过程
          const reasoning = (delta as any)?.reasoning_content
          if (reasoning) {
            this.pushAgentThinking(reasoning)
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index || 0
              if (!toolCallsBuffer[index]) toolCallsBuffer[index] = { id: '', function: { name: '', arguments: '' } }
              if (tc.id) toolCallsBuffer[index].id = tc.id
              if (tc.function?.name) toolCallsBuffer[index].function.name += tc.function.name
              if (tc.function?.arguments) toolCallsBuffer[index].function.arguments += tc.function.arguments
            }
          }
        }

        if (toolCallsBuffer.length === 0 && fullContent) {
          this.pushAgentThinking('分析完成，正在解析结果...')
          const { analysis, scenarios, matches } = this.parseLegacyAIResponse(fullContent)
          finalAnalysis = analysis
          finalScenarios = scenarios
          finalMatches = matches
          break
        }

        if (toolCallsBuffer.length > 0) {
          const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
            role: 'assistant',
            content: fullContent || null,
            tool_calls: toolCallsBuffer.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          }
          conversationMessages.push(assistantMsg)

          for (const tc of toolCallsBuffer) {
            const toolName = tc.function.name
            let args: Record<string, any> = {}
            try { args = JSON.parse(tc.function.arguments) } catch { args = {} }

            this.pushAgentToolCall(toolName, args)
            this.pushProgress('ai-tool-call', `AI 正在调用工具: ${toolName}`)
            const result = await toolExecutor.executeTool(toolName, args)
            this.pushAgentToolResult(toolName, result)
            this.pushProgress('ai-tool-result', `工具 ${toolName} 执行完成`)

            conversationMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
            toolCallCount++

            if (!result.success) {
              console.warn(`[Legacy] 工具 ${toolName} 执行失败:`, result.error)
            }
          }
          continue
        }
        break
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      this.pushAgentComplete(finalAnalysis, finalScenarios)
      console.log(`[Legacy] 分析完成（耗时 ${elapsed}s，共 ${toolCallCount} 次工具调用）`)

      return { matches: finalMatches, analysis: finalAnalysis, scenarios: finalScenarios }
    } catch (error: any) {
      console.error('[Legacy] 分析失败:', error.message)
      this.pushError(`分析失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 旧版 System Prompt（降级回退用）
   */
  private getLegacySystemPrompt(): string {
    return `你是一个 Go 代码分析专家，擅长通过阅读代码理解 HTTP 路由注册和 Handler 实现。

你的任务是：根据用户提供的请求路径（如 /api/v1/users/:id）和 HTTP 方法（GET），在本地仓库中找到对应的 Handler 函数，并分析其业务逻辑。

分析要求：
1. 识别路由注册方式和 Handler 函数名
2. 分析 Handler 函数的业务逻辑（参数校验、权限校验、数据库操作、外部服务调用等）
3. 生成 3 个场景的调用链路分析：
   - 场景1：正常流程（200 OK）
   - 场景2：参数校验失败（400 Bad Request）
   - 场景3：权限校验失败（401 Unauthorized）
4. 为每个场景生成带参数的 curl 命令示例（多行，带换行符 \\）
5. 为每个场景生成 Python 断言示例（使用 requests 库，包含 assert 语句，有注释）

你可以使用以下工具来搜索和分析代码：
- list_directory: 列出目录内容，了解项目结构
- read_file: 读取文件内容，查看代码实现
- search_code: 搜索代码关键字，快速定位相关代码
- get_file_tree: 获取完整文件树，了解项目全貌

输出格式：请严格按照以下 JSON 格式输出，不要输出其他内容：
{
  "analysisSummary": "Markdown 格式的分析报告",
  "handlerFile": "Handler 文件路径",
  "handlerFunction": "Handler 函数名",
  "scenarios": [
    {
      "scenarioName": "正常流程",
      "scenarioType": "normal",
      "callChain": [
        {"step": 1, "component": "Router", "filePath": "xxx", "functionName": "xxx", "description": "xxx"}
      ],
      "curlCommand": "curl -X GET ...",
      "pythonAssertion": "import requests\\n..."
    }
  ]
}`
  }

  /**
   * 旧版 User Prompt（降级回退用）
   */
  private buildLegacyUserPrompt(method: string, url: string): string {
    return `请分析以下 API 请求：

请求方法：${method}
请求路径：${url}

请完成以下任务：
1. 使用工具调用（Function Calling）来了解项目结构并搜索相关代码
2. 找到请求路径对应的路由注册和 Handler 函数
3. 分析 Handler 的业务逻辑（参数校验、权限校验、数据库操作、外部服务调用等）
4. 生成完整的调用链路分析报告
5. 为每个场景生成 curl 命令和 Python 断言示例

注意：
- 使用 get_file_tree 或 list_directory 了解项目结构
- 使用 search_code 搜索路由定义（如 "Router"、"HandleFunc"、".${method}(" 等关键字）
- 使用 read_file 读取相关文件，分析代码实现
- 请自主决策，不需要询问用户许可`
  }

  /**
   * 旧版 AI 响应解析（降级回退用）
   */
  private parseLegacyAIResponse(content: string): {
    analysis: string
    scenarios: AnalysisScenario[]
    matches: RouteMatch[]
  } {
    let analysis = content
    let scenarios: AnalysisScenario[] = []
    let matches: RouteMatch[] = []

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        analysis = parsed.analysisSummary || content
        scenarios = parsed.scenarios || []
        matches = parsed.matches || []

        if (matches.length === 0 && parsed.handlerFile && parsed.handlerFunction) {
          matches.push({
            filePath: parsed.handlerFile,
            content: '',
            routePattern: '',
            handlerName: parsed.handlerFunction,
            lineNumber: 0,
          } as any)
        }
      }
    } catch (e) {
      console.warn('[Legacy] JSON 解析失败，使用 Markdown 格式')
    }

    return { analysis, scenarios, matches }
  }

  // ============================================================
  // SSE 推送工具方法
  // ============================================================

  /**
   * 推送 Agent 思考过程（流式输出）
   * @param phase 标记来源阶段：'explorer' | 'generator' | undefined（旧模式）
   */
  private pushAgentThinking(content: string, phase?: string): void {
    pushSSEEvent('agent_thinking', {
      content,
      phase: phase || 'legacy',
      timestamp: Date.now(),
    })

    if (this.progressCallback) {
      this.progressCallback('log', {
        level: 'info',
        message: content,
      })
    }
  }

  /**
   * 推送工具调用消息
   */
  private pushAgentToolCall(toolName: string, args: Record<string, any>): void {
    pushSSEEvent('agent_tool_call', {
      tool: toolName,
      args,
      timestamp: Date.now(),
    })

    if (this.progressCallback) {
      this.progressCallback('log', {
        level: 'info',
        message: `AI 调用工具: ${toolName}`,
      })
    }
  }

  /**
   * 推送工具调用结果
   */
  private pushAgentToolResult(toolName: string, result: ToolCallResult): void {
    pushSSEEvent('agent_tool_result', {
      tool: toolName,
      result,
      timestamp: Date.now(),
    })

    if (this.progressCallback) {
      this.progressCallback('log', {
        level: result.success ? 'info' : 'warn',
        message: `工具 ${toolName} ${result.success ? '执行成功' : '执行失败'}`,
      })
    }
  }

  /**
   * 推送分析完成消息
   */
  private pushAgentComplete(analysis: string, scenarios: AnalysisScenario[]): void {
    pushSSEEvent('agent_complete', {
      analysis,
      scenarios,
      timestamp: Date.now(),
    })

    if (this.progressCallback) {
      this.progressCallback('done', {
        analysis,
        scenarios,
      })
    }
  }

  /**
   * 推送进度到渲染进程和 SSE 客户端
   */
  private pushProgress(phase: string, message: string, extra?: any): void {
    // 推送 IPC 消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('ai:scan-progress', {
          phase,
          message,
          timestamp: Date.now(),
        })
      } catch (e) {
        console.error('[AIAnalyzeService] 推送进度失败:', e)
      }
    }

    // 推送 SSE 事件
    pushProgress(phase, message, extra)
  }

  /**
   * 推送日志到 SSE 客户端
   */
  private pushLog(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    pushLog(level, message)

    if (this.progressCallback) {
      this.progressCallback('log', {
        level,
        message,
      })
    }
  }

  /**
   * 推送分析完成事件到 SSE 客户端
   */
  private pushDone(result: any): void {
    pushDone(result)

    if (this.progressCallback) {
      this.progressCallback('done', {
        result,
      })
    }
  }

  /**
   * 推送分析错误事件到 SSE 客户端
   */
  private pushError(message: string): void {
    pushError(message)

    if (this.progressCallback) {
      this.progressCallback('error', {
        message,
      })
    }
  }

  /**
   * 销毁服务（应用退出时调用）
   */
  destroy(): void {
    // 纯 AI Agent 模式，无需销毁 ScanWorkerManager
    console.log('[AIAnalyzeService] 服务已销毁')
  }
}
