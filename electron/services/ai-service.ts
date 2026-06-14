/**
 * AI 大模型 API 调用服务
 * 支持 OpenAI 兼容接口（GPT/Claude/国产大模型）
 */
import OpenAI from 'openai'
import type { CompareRequest, CompareResult, TemplateVariable } from '../../src/services/types'
import { TEMPLATE_VARIABLES } from '../../src/services/types'

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
 * @returns 填充后的 Prompt
 */
function fillPromptTemplate(template: string, request: CompareRequest): string {
  const { requestA, requestB } = request

  const variables: Record<string, string> = {
    '{path}': requestA.path,
    '{device_a_name}': requestA.deviceName || requestA.clientIp,
    '{device_b_name}': requestB.deviceName || requestB.clientIp,
    '{client_ip_a}': requestA.clientIp,
    '{client_ip_b}': requestB.clientIp,
    '{response_a_json}': requestA.responseBody,
    '{response_b_json}': requestB.responseBody,
    '{request_method}': requestA.method,
    '{request_headers_a}': JSON.stringify(requestA.requestHeaders, null, 2),
    '{request_headers_b}': JSON.stringify(requestB.requestHeaders, null, 2),
  }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(key).join(value)
  }

  return result
}

/**
 * 执行 AI 对比（流式）
 * @param request 对比请求参数
 * @param onChunk 流式 token 回调
 * @param onEnd 完成回调
 * @returns 对比结果
 */
export async function executeCompare(
  request: CompareRequest,
  onChunk?: (chunk: string) => void,
  onEnd?: (result: CompareResult) => void
): Promise<CompareResult> {
  if (isComparing) {
    throw new Error('AI 对比正在进行中，请等待完成后再试。')
  }

  isComparing = true

  // 创建带超时的客户端（60 秒）
  const client = new OpenAI({
    baseURL: request.apiUrl,
    apiKey: request.apiKey,
    timeout: 60000,
  })

  try {
    const prompt = fillPromptTemplate(request.promptTemplate, request)

    console.log('[AI Service] 开始调用 AI 对比，模型:', request.modelName, 'API:', request.apiUrl)

    const stream = await client.chat.completions.create({
      model: request.modelName,
      messages: [
        { role: 'system', content: '你是一个专业的接口数据对比分析专家，擅长分析 JSON 数据差异。' },
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
        if (onChunk) {
          onChunk(content)
        }
      }
    }

    console.log('[AI Service] AI 对比完成，结果长度:', fullContent.length)

    const result: CompareResult = {
      analysis: fullContent,
      modelName: request.modelName,
      path: request.requestA.path,
      deviceA: {
        name: request.requestA.deviceName || request.requestA.clientIp,
        ip: request.requestA.clientIp,
      },
      deviceB: {
        name: request.requestB.deviceName || request.requestB.clientIp,
        ip: request.requestB.clientIp,
      },
      isStreaming: false,
    }

    if (onEnd) {
      onEnd(result)
    }

    return result
  } catch (error: any) {
    const errorMessage = error?.message || String(error)
    console.error('[AI Service] AI 对比失败:', errorMessage, error)
    throw new Error(`AI 对比失败: ${errorMessage}`)
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

    const content = response.choices[0]?.message?.content || ''
    if (content) {
      return { success: true, message: `连接成功！模型响应: ${content}` }
    } else {
      return { success: false, message: '连接成功但模型无响应内容，请检查模型名称。' }
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
