/**
 * ai-service 对比忽略规则注入单元测试
 *
 * 覆盖：
 *   1. fillPromptTemplate：非空 ignoreRules 时，Prompt 末尾追加【忽略字段】段且含每条规则
 *   2. fillPromptTemplate：空 ignoreRules 时，不追加任何【忽略字段】段
 *   3. buildIgnoreRulesAppendix：空/undefined → ''；非空 → 正确拼装
 *   4. computeStructuredDiff：传入 ignoreRules 时，命中字段不计入 diff（结构化 diff 也跳过）
 */
import { describe, it, expect } from 'vitest'
import { fillPromptTemplate, buildIgnoreRulesAppendix, computeStructuredDiff, cacheKey } from '../ai-service'
import type { CaptureRequest, CompareRequest } from '../../../src/services/types'

function makeRequest(
  overridesA: Partial<CaptureRequest> = {},
  overridesB: Partial<CaptureRequest> = {},
): CompareRequest {
  const base: CaptureRequest = {
    id: 'a',
    method: 'POST',
    url: 'https://api.example.com/order?signature=abc&page=1',
    path: '/order',
    host: 'api.example.com',
    statusCode: 200,
    duration: 10,
    requestHeaders: { 'content-type': 'application/json', 'X-Request-Id': 'req-1' },
    requestBody: JSON.stringify({ data: { timestamp: 100, id: 1 }, user: { token: 't1' } }),
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: JSON.stringify({ data: { timestamp: 200, id: 2 }, user: { token: 't2' } }),
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
  return { requestA, requestB, promptTemplate: '', modelName: 'gpt', apiUrl: 'http://x', apiKey: 'k' }
}

describe('buildIgnoreRulesAppendix', () => {
  it('空/undefined 返回空串', () => {
    expect(buildIgnoreRulesAppendix(undefined)).toBe('')
    expect(buildIgnoreRulesAppendix([])).toBe('')
  })

  it('非空返回含每条规则的段', () => {
    const s = buildIgnoreRulesAppendix(['X-Request-Id', 'data.timestamp'])
    expect(s).toContain('【忽略字段】')
    expect(s).toContain('- X-Request-Id')
    expect(s).toContain('- data.timestamp')
  })
})

describe('fillPromptTemplate 忽略规则注入', () => {
  it('非空 rules：Prompt 末尾追加【忽略字段】段且含每条规则', () => {
    const req = makeRequest()
    const template = '差异如下：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, ['X-Request-Id', 'data.timestamp'], true)

    expect(prompt).toContain('【忽略字段】')
    expect(prompt).toContain('- X-Request-Id')
    expect(prompt).toContain('- data.timestamp')
    // 注入段位于 prompt 末尾（不破坏 {diff_result} 等变量替换结果）
    expect(prompt.indexOf('【忽略字段】')).toBeGreaterThan(prompt.indexOf('[概览]'))
  })

  it('空 rules：不追加【忽略字段】段', () => {
    const req = makeRequest()
    const template = '差异如下：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, [], false)
    expect(prompt).not.toContain('【忽略字段】')
  })
})

describe('computeStructuredDiff 忽略规则生效（结构化 diff 跳过命中字段）', () => {
  it('忽略 X-Request-Id 后，该 Header 差异不计入', () => {
    const req = makeRequest(
      { requestHeaders: { 'X-Request-Id': 'req-1' } },
      { requestHeaders: { 'X-Request-Id': 'req-2' } },
    )
    const diff = computeStructuredDiff(req, ['X-Request-Id'], true)
    // 请求头差异应为空（X-Request-Id 被双方剔除）
    expect(Object.keys(diff.requestHeaders.added)).toHaveLength(0)
    expect(Object.keys(diff.requestHeaders.removed)).toHaveLength(0)
    expect(diff.requestHeaders.modified).toHaveLength(0)
    expect(diff.overview.different).not.toContain('Request Headers')
  })

  it('忽略 data.timestamp 后，该 JSON 路径差异不计入', () => {
    const req = makeRequest()
    const diff = computeStructuredDiff(req, ['data.timestamp'], true)
    const deltas = diff.responseBody.delta ?? []
    // 任何 delta 的路径都不应是 data.timestamp（被剔除）
    expect(deltas.some((d) => d.path === 'data.timestamp')).toBe(false)
  })
})

describe('mergeIgnoreRules 注入 prompt 附录（移除内置名单后）', () => {
  it('仅注入用户规则：不再自动追加内置名单（*.timestamp / x-request-id 不再出现）', () => {
    const req = makeRequest()
    const template = '差异如下：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, ['X-Request-Id'], true)
    expect(prompt).toContain('【忽略字段】')
    expect(prompt).toContain('- X-Request-Id')
    // 内置启发式名单已弃用，改为对比后 AI 弹窗建议，故不再自动追加
    expect(prompt).not.toContain('- *.timestamp')
    expect(prompt).not.toContain('- x-request-id')
  })

  it('空用户规则：不追加任何【忽略字段】段', () => {
    const req = makeRequest()
    const template = '差异如下：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, [], false)
    expect(prompt).not.toContain('【忽略字段】')
  })
})

describe('cacheKey 随 useBuiltinIgnore 变化', () => {
  it('useBuiltinIgnore 不同 → cacheKey 不同（避免命中同一缓存）', () => {
    const base = makeRequest()
    const rOn = { ...base, useBuiltinIgnore: true }
    const rOff = { ...base, useBuiltinIgnore: false }
    expect(cacheKey(rOn)).not.toBe(cacheKey(rOff))
  })

  it('useBuiltinIgnore 相同 → cacheKey 相同', () => {
    const base = makeRequest()
    const r1 = { ...base, useBuiltinIgnore: true }
    const r2 = { ...base, useBuiltinIgnore: true }
    expect(cacheKey(r1)).toBe(cacheKey(r2))
  })
})
