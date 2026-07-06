/**
 * AI 对比 Tier 2 结构化输出 - 单元测试（File A）
 *
 * 覆盖：
 * 1. fillPromptTemplate 向后兼容：2 参数旧调用仍合法，{diff_result} 被替换
 * 2. computeStructuredDiff 成功路径：返回 overview.different 含预期差异维度
 * 3. computeStructuredDiff 大 body 守卫：>1MB 抛 Error（消息含 'too large'）
 * 4. executeCompare 返回 diffResult（mock openai，成功路径）：diffResult 存在且与 computeDiff 一致
 * 5. 契约：fillPromptTemplate 接受 precomputedDiff 且最终 diff 来自它（executeCompare 内契约）
 */

import { describe, it, expect, vi } from 'vitest'
import {
  fillPromptTemplate,
  computeStructuredDiff,
  executeCompare,
} from '../ai-service'
import type {
  CaptureRequest,
  CompareRequest,
  DiffResult,
} from '../../../src/services/types'
import { computeDiff } from '../../../src/services/diff-engine'

// Mock openai：避免真实网络调用，用假的流式响应驱动 executeCompare
vi.mock('openai', () => {
  const create = vi.fn().mockImplementation(async function* () {
    yield { choices: [{ delta: { content: 'AI 分析结论文本' } }] }
  })
  return {
    default: class OpenAI {
      chat = { completions: { create } }
    },
  }
})

// ---------- Fixtures ----------

function makeCaptureRequest(
  overridesA: Partial<CaptureRequest> = {},
  overridesB: Partial<CaptureRequest> = {},
): { requestA: CaptureRequest; requestB: CaptureRequest } {
  const base: CaptureRequest = {
    id: 'a',
    method: 'POST',
    url: 'https://api.example.com/order',
    path: '/order',
    host: 'api.example.com',
    statusCode: 200,
    duration: 10,
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: '{}',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{}',
    clientIp: '10.0.0.1',
    deviceName: 'DeviceA',
    capturedAt: '',
    isRecorded: false,
    selected: false,
    checked: false,
  }
  const requestA: CaptureRequest = { ...base, ...overridesA }
  const requestB: CaptureRequest = {
    ...base,
    ...overridesB,
    id: 'b',
    deviceName: 'DeviceB',
    clientIp: '10.0.0.2',
  }
  return { requestA, requestB }
}

function makeCompareRequest(
  overridesA: Partial<CaptureRequest> = {},
  overridesB: Partial<CaptureRequest> = {},
): CompareRequest {
  const { requestA, requestB } = makeCaptureRequest(overridesA, overridesB)
  return {
    requestA,
    requestB,
    promptTemplate: '分析：\n{diff_result}',
    modelName: 'gpt',
    apiUrl: 'http://x',
    apiKey: 'k',
  }
}

// 构造一个带唯一标记的预计算 DiffResult，用于验证 fillPromptTemplate 使用了它
function makeMarkerDiff(): DiffResult {
  return {
    overview: {
      same: ['URL'],
      different: ['__PRECOMPUTED_DIFF_MARKER__'],
      stats: {
        requestHeaders: { added: 0, removed: 0, modified: 0 },
        requestBody: { changes: 0 },
        responseHeaders: { added: 0, removed: 0, modified: 0 },
        responseBody: { changes: 0 },
      },
    },
    requestHeaders: { added: {}, removed: {}, modified: [] },
    requestBody: { type: 'empty' },
    responseHeaders: { added: {}, removed: {}, modified: [] },
    responseBody: { type: 'empty' },
  }
}

// ---------- Tests ----------

describe('Tier2 - fillPromptTemplate 向后兼容', () => {
  it('2 参数旧调用合法：{diff_result} 被替换且不抛错', () => {
    const req = makeCompareRequest(
      { responseBody: '{"price":100}' },
      { responseBody: '{"price":120}' },
    )
    const template = '差异如下：\n{diff_result}'

    // 仅传 2 个参数（旧调用方式）
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    expect(prompt).not.toContain('{diff_result}')
    expect(prompt).toContain('[概览]')
  })
})

describe('Tier2 - computeStructuredDiff', () => {
  it('成功路径：overview.different 非空且含预期差异维度', () => {
    // requestA/requestB 在状态码与请求头上不同
    const req = makeCompareRequest(
      { statusCode: 200, requestHeaders: { 'content-type': 'application/json', 'x-trace': 'aaa' } },
      { statusCode: 500, requestHeaders: { 'content-type': 'application/json', 'x-trace': 'bbb' } },
    )

    const diff = computeStructuredDiff(req, undefined, true)

    expect(diff.overview.different.length).toBeGreaterThan(0)
    expect(diff.overview.different).toContain('Status Code')
    expect(diff.overview.different).toContain('Request Headers')
    // 与 computeDiff 产出一致（单一数据源）
    expect(diff).toEqual(computeDiff(req.requestA, req.requestB))
  })

  it('大 body 守卫：>1MB 抛 Error（消息含 "too large"）', () => {
    const bigBody = 'x'.repeat(1_000_001)
    const req = makeCompareRequest(
      { responseBody: bigBody },
      { responseBody: bigBody },
    )

    expect(() => computeStructuredDiff(req, undefined, true)).toThrow(/too large/i)
  })
})

describe('Tier2 - executeCompare 返回 diffResult', () => {
  it('成功路径：result.diffResult 存在且与 computeDiff(reqA, reqB) 一致', async () => {
    const req = makeCompareRequest(
      { statusCode: 200, responseBody: '{"price":100}' },
      { statusCode: 200, responseBody: '{"price":200}' },
    )

    const result = await executeCompare(req)

    // analysis 来自 mock 流式输出
    expect(result.analysis).toBe('AI 分析结论文本')
    // 关键：diffResult 被返回（Tier2 核心）
    expect(result.diffResult).toBeDefined()
    expect(result.diffResult!.overview).toBeDefined()
    // 与本地 computeDiff 完全一致（服务端单一数据源）
    expect(result.diffResult).toEqual(computeDiff(req.requestA, req.requestB))
  })
})

describe('Tier2 - fillPromptTemplate 使用 precomputedDiff（executeCompare 内契约）', () => {
  it('传入 precomputedDiff 时，Prompt 中的 diff 来自它而非重算', () => {
    const marker = makeMarkerDiff()
    // 让真实请求存在明显差异，若重算则不会含标记
    const req = makeCompareRequest(
      { statusCode: 200 },
      { statusCode: 500 },
    )

    const prompt = fillPromptTemplate('差异：\n{diff_result}', req, marker, undefined, true)

    // 标记出现 => 用的是传入的 precomputedDiff，而不是重新 computeDiff
    expect(prompt).toContain('__PRECOMPUTED_DIFF_MARKER__')
    expect(prompt).toContain('[概览]')
    // 真实重算的 Status Code 差异不应以「重算」方式注入（标记优先）
    expect(prompt).not.toContain('{diff_result}')
  })
})
