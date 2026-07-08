/**
 * analyzeIgnoreSuggestions 单元测试（mock OpenAI）
 *
 * 覆盖：
 * 1. 正常返回：模型 JSON 被正确解析为 IgnoreSuggestion[]
 * 2. 过滤非法 category / 缺失 name(path) 的条目
 * 3. JSON 被额外说明文字包裹时仍能提取
 * 4. 无效 JSON → 返回 []
 * 5. 空 suggestions → 返回 []
 * 6. OpenAI 抛错 → 返回 []（绝不抛异常）
 * 7. 调用时传入 response_format=json_object 与正确 model
 */
import { describe, it, expect, vi } from 'vitest'
import { analyzeIgnoreSuggestions } from '../ai-service'
import type { CaptureRequest } from '../../../src/services/types'

const mockCreate = vi.fn()

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mockCreate } }
  },
}))

function makeCaptureRequest(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    id: 'a',
    method: 'POST',
    url: 'https://api.example.com/order?signature=abc&page=1',
    path: '/order',
    host: 'api.example.com',
    statusCode: 200,
    duration: 10,
    requestHeaders: { 'content-type': 'application/json', 'X-Request-Id': 'req-1' },
    requestBody: '{}',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: JSON.stringify({ data: { timestamp: 100 }, token: 't1' }),
    clientIp: '10.0.0.1',
    deviceName: 'DeviceA',
    capturedAt: '',
    isRecorded: false,
    selected: false,
    checked: false,
    ...overrides,
  }
}

const aiConfig = { apiUrl: 'http://x', apiKey: 'k', modelName: 'gpt' }

/** 构造一条模型返回的 suggestions JSON 文本 */
function jsonSuggestions(list: unknown[]): string {
  return JSON.stringify({ suggestions: list })
}

describe('analyzeIgnoreSuggestions', () => {
  it('1. 正常返回：模型 JSON 被解析为 IgnoreSuggestion[]', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: jsonSuggestions([
        { category: 'header', name: 'x-request-id', reason: '链路追踪头' },
        { category: 'query', name: 'signature', reason: '防重放签名' },
        { category: 'body', path: 'data.timestamp', reason: '易变时间戳' },
      ]) } }],
    })
    const reqA = makeCaptureRequest()
    const reqB = makeCaptureRequest({ id: 'b', deviceName: 'DeviceB', responseBody: JSON.stringify({ data: { timestamp: 200 }, token: 't2' }) })
    const res = await analyzeIgnoreSuggestions(reqA, reqB, aiConfig)
    expect(res).toHaveLength(3)
    expect(res[0]).toMatchObject({ category: 'header', name: 'x-request-id' })
    expect(res[1]).toMatchObject({ category: 'query', name: 'signature' })
    expect(res[2]).toMatchObject({ category: 'body', path: 'data.timestamp' })
  })

  it('2. 过滤非法 category / 缺字段的条目', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: jsonSuggestions([
        { category: 'header', name: 'x-request-id' },          // 合法
        { category: 'body' },                                   // 缺 path → 过滤
        { category: 'weird', name: 'foo' },                     // 非法 category → 过滤
        { category: 'query' },                                  // 缺 name → 过滤
      ]) } }],
    })
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('x-request-id')
  })

  it('3. JSON 被额外说明文字包裹时仍能提取', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '好的，这是建议：\n' + jsonSuggestions([{ category: 'header', name: 'etag', reason: '缓存校验' }]) + '\n以上。' } }],
    })
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('etag')
  })

  it('4. 无效 JSON → 返回 []', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '这不是 JSON' } }] })
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toEqual([])
  })

  it('5. 空 suggestions → 返回 []', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: jsonSuggestions([]) } }] })
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toEqual([])
  })

  it('6. OpenAI 抛错 → 返回 []（不抛异常，便于前端静默失败）', async () => {
    mockCreate.mockRejectedValueOnce(new Error('network down'))
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toEqual([])
  })

  it('7. 传入 response_format=json_object 与正确 model', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: jsonSuggestions([]) } }] })
    await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    // mockCreate 在多个用例间累积调用，取「最后一次调用」校验入参
    const calls = mockCreate.mock.calls
    const lastArg = calls[calls.length - 1][0]
    expect(lastArg.response_format).toEqual({ type: 'json_object' })
    expect(lastArg.model).toBe('gpt')
  })

  it('8. JSON 被 ```json markdown 代码块包裹时仍能解析（代码围栏容错）', async () => {
    const fenced = '```json\n' + jsonSuggestions([{ category: 'header', name: 'etag', reason: '缓存校验' }]) + '\n```'
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: fenced } }] })
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('etag')
  })

  it('9. AI 截断（尾部残缺、无闭合括号）返回 [] 而非抛异常', async () => {
    const truncated = '{"suggestions":[{"category":"header"'
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: truncated } }],
    })
    const res = await analyzeIgnoreSuggestions(makeCaptureRequest(), makeCaptureRequest({ id: 'b' }), aiConfig)
    expect(res).toEqual([])
  })
})
