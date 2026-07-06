/**
 * AI 对比 × Diff 引擎打通 - 单元测试
 *
 * 覆盖：
 * - 含 {diff_result} 的模板：Prompt 中出现 [概览] 且不出现完整原始大 body
 * - 不含 {diff_result} 的旧模板：行为不变（仍注入原始 body）
 * - computeDiff 抛错 / 响应体过大：回退原始 body 截断
 * - 二进制 body 场景：序列化输出"二进制内容，无法结构化对比"
 */

import { describe, it, expect } from 'vitest'
import { fillPromptTemplate } from '../ai-service'
import type { CaptureRequest, CompareRequest } from '../../../src/services/types'
import { DEFAULT_PROMPT_V1, DEFAULT_PROMPT_V2 } from '../../../src/services/types'
import { computeDiff, serializeDiffForPrompt } from '../../../src/services/diff-engine'

function makeRequest(
  overridesA: Partial<CaptureRequest> = {},
  overridesB: Partial<CaptureRequest> = {},
): CompareRequest {
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
  return {
    requestA,
    requestB,
    promptTemplate: '',
    modelName: 'gpt',
    apiUrl: 'http://x',
    apiKey: 'k',
  }
}

describe('fillPromptTemplate - diff_result 打通', () => {
  it('含 {diff_result} 的模板：Prompt 出现 [概览] 且不含完整原始大 body', () => {
    const rawMarker = 'UNIQUE_RAW_MARKER_XYZ'
    const req = makeRequest(
      { responseBody: `{"shared":"${rawMarker}","price":100}` },
      { responseBody: `{"shared":"${rawMarker}","price":120}` },
    )
    const template = '差异如下：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    expect(prompt).toContain('[概览]')
    // 原始大 body 不应整体出现（useDiffResult 时旧 body 变量置空，且 diff 仅含 delta）
    expect(prompt).not.toContain(rawMarker)
    expect(prompt).not.toContain(req.requestA.responseBody)
  })

  it('不含 {diff_result} 的旧模板：行为不变（仍注入原始 body）', () => {
    const rawBody = '{"price":100,"name":"old-template-body"}'
    const req = makeRequest(
      { responseBody: rawBody },
      { responseBody: '{"price":120}' },
    )
    const template = 'A: {response_a_json}\nB: {response_b_json}'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    expect(prompt).toContain(rawBody)
    expect(prompt).not.toContain('[概览]')
  })

  it('响应体过大（>1MB）：computeDiff 跳过递归，回退原始 body 截断', () => {
    const bigBody = 'x'.repeat(1_000_001)
    const req = makeRequest(
      { responseBody: bigBody },
      { responseBody: bigBody },
    )
    const template = '差异：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    expect(prompt).toContain('已回退原始报文')
    // 回退内容为原始 body 前 4000 字符
    expect(prompt).toContain(bigBody.slice(0, 4000))
    // 不应包含完整 1MB body
    expect(prompt.length).toBeLessThan(bigBody.length)
  })

  it('二进制 body 场景：序列化输出"二进制内容，无法结构化对比"', () => {
    const binary = '\u0000'.repeat(300) + 'a'.repeat(300)
    const req = makeRequest(
      { responseBody: binary },
      { responseBody: binary },
    )
    const template = '差异：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    expect(prompt).toContain('二进制内容，无法结构化对比')
  })
})

describe('fillPromptTemplate - 降本量化验证（Plan §6 缺口1）', () => {
  it('大但几乎相同的 body：{diff_result} 路径压缩 90%+ 且不泄漏原始大 body', () => {
    // 两个 body 各含一个 ~100KB 的相同字段 shared，外加一个不同字段 price
    // 单 body 长度 ~100KB << 1MB，走正常 diff 路径（不触发回退）
    const bigShared = 'A'.repeat(100_000)
    const bodyA = JSON.stringify({ shared: bigShared, price: 100 })
    const bodyB = JSON.stringify({ shared: bigShared, price: 120 })
    const req = makeRequest(
      { responseBody: bodyA },
      { responseBody: bodyB },
    )
    const template = '分析：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    const totalBodyLen = bodyA.length + bodyB.length
    // 断言 (a)：prompt 长度远小于两份 responseBody 之和（<10%，压缩 90%+ 降本生效）
    expect(prompt.length).toBeLessThan(totalBodyLen * 0.1)
    // 断言 (b)：~100KB 大字段字符串不应整体出现在 prompt 中（证明原始大 body 未被注入）
    expect(prompt).not.toContain(bigShared)
  })
})

describe('fillPromptTemplate - QA 补充覆盖（回归防护）', () => {
  it('含 {diff_result} 的模板同时引用旧 body 变量：旧变量被置空（降本生效 / 漏洞4修复）', () => {
    const leakMarker = 'LEAK_RAW_BODY_MARKER_QA'
    const req = makeRequest(
      { responseBody: `{"price":100,"tag":"${leakMarker}"}` },
      { responseBody: `{"price":120,"tag":"${leakMarker}"}` },
    )
    // 模拟漏洞4 并存场景：模板同时引用 {diff_result} 与 {response_a_json}
    const template = '差异：\n{diff_result}\n[A原始响应体]{response_a_json}[/A原始响应体]'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    // diff_result 仍正常注入结构化差异
    expect(prompt).toContain('[概览]')
    // 旧 body 变量应被置空，不能把原始 body 泄漏进 Prompt（否则降本失效）
    expect(prompt).toContain('[A原始响应体][/A原始响应体]')
    expect(prompt).not.toContain(leakMarker)
    expect(prompt).not.toContain('{response_a_json}')
  })

  it('请求体过大（>1MB）：requestBody 阈值同样触发回退（R1 四字段覆盖）', () => {
    const bigRequestBody = 'x'.repeat(1_000_001)
    const req = makeRequest(
      { requestBody: bigRequestBody },
      { requestBody: bigRequestBody },
    )
    // 注意：responseBody 很小，仅 requestBody 超限，验证阈值覆盖了 requestBody
    const template = '差异：\n{diff_result}'
    const prompt = fillPromptTemplate(template, req, undefined, undefined, true)

    expect(prompt).toContain('已回退原始报文')
    // 回退内容仅含 responseBody 前 4000 字符，不应包含完整 1MB requestBody
    expect(prompt.length).toBeLessThan(bigRequestBody.length)
    // (缺口2 强化) 内容级断言(a)：回退走的是 responseBody 路径，源码 fallback 固定含此 header
    expect(prompt).toContain('=== 请求A响应体(前4000字符) ===')
    // (缺口2 强化) 内容级断言(b)：1MB requestBody（全 'x'）没有泄漏进 prompt
    // useDiffResult 时 {request_body_a/b} 已置空，fallback 仅注入 responseBody 前 4000 字符（'{}'）
    expect(prompt).not.toContain('x'.repeat(2000))
  })

  it('默认 Prompt 模板以 {diff_result} 为核心（向后兼容主路径）', () => {
    expect(DEFAULT_PROMPT_V1).toContain('{diff_result}')
    expect(DEFAULT_PROMPT_V2).toContain('{diff_result}')
  })
})

describe('diff-engine 行为级回归（缺口3）', () => {
  it('已知单字段差异（responseBody.price 100→120）：概览/类型/delta 正确且序列化含 ~ price: 100 → 120', () => {
    const req = makeRequest(
      { responseBody: JSON.stringify({ price: 100, name: 'a' }) },
      { responseBody: JSON.stringify({ price: 120, name: 'a' }) },
    )
    const diff = computeDiff(req.requestA, req.requestB)

    // 概览：相同维度至少覆盖 URL / Method / Status Code / Request Body
    expect(diff.overview.same).toContain('URL')
    expect(diff.overview.same).toContain('Method')
    expect(diff.overview.same).toContain('Status Code')
    expect(diff.overview.same).toContain('Request Body')
    // 不同维度包含 Response Body
    expect(diff.overview.different).toContain('Response Body')

    // responseBody 为 json 类型，且仅有 1 处 delta
    expect(diff.responseBody.type).toBe('json')
    expect(diff.responseBody.delta).toBeDefined()
    expect(diff.responseBody.delta!.length).toBe(1)
    const delta0 = diff.responseBody.delta![0]
    expect(delta0.path).toBe('price')
    expect(delta0.type).toBe('modified')
    expect(delta0.oldValue).toBe(100)
    expect(delta0.newValue).toBe(120)

    // 序列化输出含 [概览] 与修改标记 ~ price: 100 → 120
    const text = serializeDiffForPrompt(diff, 200)
    expect(text).toContain('[概览]')
    expect(text).toContain('~ price: 100 → 120')
  })

  it('完全一致请求：overview.different 为空且序列化输出包含「不同: 无」', () => {
    const req = makeRequest()
    const diff = computeDiff(req.requestA, req.requestB)

    // 所有 overview 业务维度一致（id/deviceName/clientIp 不参与概览判定）
    expect(diff.overview.different.length).toBe(0)

    const text = serializeDiffForPrompt(diff, 200)
    expect(text).toContain('不同: 无')
  })
})
