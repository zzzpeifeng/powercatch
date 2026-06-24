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
import OpenAI from 'openai'
import { AIAgentToolExecutor, type ToolCallResult } from './ai-agent-tool-executor'
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

    // 直接调用 AI Agent 分析
    return this.analyzeWithAgent({
      clonePath,
      method,
      url,
    })
  }

  /**
   * AI Agent 分析（核心方法）
   *
   * 工作流程：
   * 1. 创建工具执行器（AIAgentToolExecutor）
   * 2. 构建 System Prompt 和 User Prompt
   * 3. 调用 AI API（流式输出）
   * 4. AI 通过工具调用自主搜索代码
   * 5. 实时推送分析过程到前端
   * 6. 解析最终结果
   *
   * @param request 分析请求参数
   * @returns 分析结果
   */
  private async analyzeWithAgent(request: {
    clonePath: string
    method: string
    url: string
  }): Promise<AnalyzeResult> {
    const { clonePath, method, url } = request

    // 创建工具执行器
    const toolExecutor = new AIAgentToolExecutor(clonePath)

    // 推送开始消息
    this.pushAgentThinking('开始分析代码仓库...')
    this.pushProgress('ai-agent', 'AI 正在分析代码仓库（纯 Agent 模式）')

    // 构建 AI 请求
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.getSystemPrompt(),
      },
      {
        role: 'user',
        content: this.buildUserPrompt(method, url),
      },
    ]

    // 工具定义（Function Calling）
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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

    // 工具调用循环（最多 20 次，不限时）
    const MAX_TOOL_CALLS = 20
    let toolCallCount = 0
    let finalAnalysis = ''
    let finalScenarios: AnalysisScenario[] = []
    let finalMatches: RouteMatch[] = []

    // 用于存储工具调用响应的消息历史
    const conversationMessages = [...messages]

    try {
      // 循环处理工具调用
      while (toolCallCount < MAX_TOOL_CALLS) {
        // 调用 AI API（流式输出）
        this.pushAgentThinking(`正在推理（第 ${toolCallCount + 1} 轮）...`)

        const stream = await this.openai.chat.completions.create({
          model: this.modelName,
          messages: conversationMessages,
          tools,
          tool_choice: 'auto',
          stream: true,
        })

        // 用于收集完整响应
        let fullContent = ''
        let toolCallsBuffer: Array<{
          id: string
          function: { name: string; arguments: string }
        }> = []
        let currentToolCallIndex = -1

        // 处理流式响应
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta

          // 处理文本内容
          if (delta?.content) {
            fullContent += delta.content
            // 实时推送推理过程
            this.pushAgentThinking(delta.content)
          }

          // 处理工具调用
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index || 0

              // 初始化工具调用缓冲区
              if (!toolCallsBuffer[index]) {
                toolCallsBuffer[index] = {
                  id: '',
                  function: { name: '', arguments: '' },
                }
              }

              // 收集工具调用 ID
              if (toolCallDelta.id) {
                toolCallsBuffer[index].id = toolCallDelta.id
              }

              // 收集工具名称
              if (toolCallDelta.function?.name) {
                toolCallsBuffer[index].function.name += toolCallDelta.function.name
              }

              // 收集工具参数
              if (toolCallDelta.function?.arguments) {
                toolCallsBuffer[index].function.arguments += toolCallDelta.function.arguments
              }
            }
          }
        }

        // 如果没有工具调用，说明 AI 已生成最终报告
        if (toolCallsBuffer.length === 0 && fullContent) {
          this.pushAgentThinking('分析完成，正在解析结果...')
          const { analysis, scenarios, matches } = this.parseAIResponse(fullContent)
          finalAnalysis = analysis
          finalScenarios = scenarios
          finalMatches = matches
          break
        }

        // 处理工具调用
        if (toolCallsBuffer.length > 0) {
          // 将 AI 的响应添加到对话历史
          const assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
            role: 'assistant',
            content: fullContent || null,
            tool_calls: toolCallsBuffer.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          }
          conversationMessages.push(assistantMessage)

          // 执行每个工具调用
          for (const toolCall of toolCallsBuffer) {
            const toolName = toolCall.function.name
            let args: Record<string, any> = {}

            try {
              args = JSON.parse(toolCall.function.arguments)
            } catch (error) {
              console.error(`[AIAnalyzeService] 解析工具参数失败: ${toolCall.function.arguments}`, error)
              args = {}
            }

            // 推送工具调用消息
            this.pushAgentToolCall(toolName, args)
            this.pushProgress('ai-tool-call', `AI 正在调用工具: ${toolName}`, { tool: toolName, args })

            // 执行工具
            const toolResult = await toolExecutor.executeTool(toolName, args)

            // 推送工具调用结果
            this.pushAgentToolResult(toolName, toolResult)
            this.pushProgress('ai-tool-result', `工具 ${toolName} 执行完成`, { tool: toolName, result: toolResult })

            // 将工具执行结果添加到对话历史
            conversationMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            })

            toolCallCount++

            // 如果工具执行失败，记录警告
            if (!toolResult.success) {
              console.warn(`[AIAnalyzeService] 工具 ${toolName} 执行失败:`, toolResult.error)
            }
          }

          // 继续下一轮推理
          continue
        }

        // 如果没有工具调用也没有内容，跳出循环
        break
      }

      // 达到最大工具调用次数，强制生成报告
      if (toolCallCount >= MAX_TOOL_CALLS && !finalAnalysis) {
        this.pushAgentThinking('达到最大工具调用次数，正在生成最终报告...')

        const finalResponse = await this.openai.chat.completions.create({
          model: this.modelName,
          messages: conversationMessages,
        })

        const content = finalResponse.choices[0].message.content || '分析超时，请重试。'
        const { analysis, scenarios, matches } = this.parseAIResponse(content)
        finalAnalysis = analysis
        finalScenarios = scenarios
        finalMatches = matches
      }

      // 推送完成消息
      this.pushAgentComplete(finalAnalysis, finalScenarios)
      this.pushDone({
        analysis: finalAnalysis,
        scenarios: finalScenarios,
        matches: finalMatches,
      })

      console.log(`[AIAnalyzeService] 分析完成，共执行 ${toolCallCount} 次工具调用`)

      return {
        matches: finalMatches,
        analysis: finalAnalysis,
        scenarios: finalScenarios,
      }
    } catch (error: any) {
      console.error('[AIAnalyzeService] 分析失败:', error.message)
      this.pushError(`分析失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取 System Prompt
   */
  private getSystemPrompt(): string {
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
   * 构建 User Prompt
   */
  private buildUserPrompt(method: string, url: string): string {
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
   * 解析 AI 响应，提取分析报告和结构化场景
   */
  private parseAIResponse(content: string): {
    analysis: string
    scenarios: AnalysisScenario[]
    matches: RouteMatch[]
  } {
    let analysis = content
    let scenarios: AnalysisScenario[] = []
    let matches: RouteMatch[] = []

    try {
      // 提取 JSON 部分（AI 可能会在 JSON 前后添加说明文字）
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        analysis = parsed.analysisSummary || content
        scenarios = parsed.scenarios || []
        matches = parsed.matches || []

        // 如果没有 matches，尝试从 handlerFile 和 handlerFunction 构建
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
      // JSON 解析失败，使用原始内容作为分析报告
      console.warn('[AIAnalyzeService] JSON 解析失败，使用 Markdown 格式')
    }

    return { analysis, scenarios, matches }
  }

  /**
   * 推送 Agent 思考过程（流式输出）
   */
  private pushAgentThinking(content: string): void {
    pushSSEEvent('agent_thinking', {
      content,
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
