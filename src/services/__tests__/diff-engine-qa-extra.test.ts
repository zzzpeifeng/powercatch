/**
 * QA 独立验证补充测试（严过关 / Yan）
 * 针对「内置智能忽略」实现，补充工程师可能遗漏的边界场景，独立验证源码正确性。
 * 运行：npx vitest run src/services/__tests__/diff-engine-qa-extra.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  applyIgnoreRules,
  BUILTIN_IGNORE_RULES,
  mergeIgnoreRules,
  computeDiff,
} from '../diff-engine'
import type { CaptureRequest } from '../../services/types'

function makeRequest(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    id: 'a',
    method: 'POST',
    url: 'https://api.example.com/order?signature=abc&page=1',
    path: '/order',
    host: 'api.example.com',
    statusCode: 200,
    duration: 10,
    requestHeaders: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-123' },
    requestBody: '{}',
    responseHeaders: { 'Content-Type': 'application/json' },
    responseBody: '{}',
    clientIp: '10.0.0.1',
    deviceName: 'DeviceA',
    capturedAt: '',
    isRecorded: false,
    selected: false,
    checked: false,
    ...overrides,
  }
}

describe('QA-Extra: applyIgnoreRules 通配精确场景（需求给定样本）', () => {
  it('{data:{timestamp,id},user:{token},list:[{nonce}]} + ["*.timestamp","*.token","*.nonce"] → 三处剔除且 id/list 保留', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({ data: { timestamp: 1, id: 2 }, user: { token: 'a' }, list: [{ nonce: 9 }] }),
      responseBody: '{}',
    })
    const out = applyIgnoreRules(req, ['*.timestamp', '*.token', '*.nonce'])
    const rb = JSON.parse(out.requestBody)
    // 三处命中字段被剔除
    expect(rb.data.timestamp).toBeUndefined()
    expect(rb.user.token).toBeUndefined()
    expect(rb.list[0].nonce).toBeUndefined()
    // 结构与非命中字段保留
    expect(rb.data.id).toBe(2)
    expect(Array.isArray(rb.list)).toBe(true)
    expect(rb.list).toHaveLength(1)
  })
})

describe('QA-Extra: mergeIgnoreRules 用户规则与内置重复去重', () => {
  it('用户规则是内置子集时自动去重，总数 = 内置数', () => {
    const merged = mergeIgnoreRules(['*.timestamp', 'token'], true)
    expect(merged.filter((r) => r === '*.timestamp')).toHaveLength(1)
    expect(merged.filter((r) => r === 'token')).toHaveLength(1)
    expect(merged.length).toBe(BUILTIN_IGNORE_RULES.length)
  })

  it('用户规则含内置命中项 + 自定义项：去重且不丢自定义，用户项在前', () => {
    const merged = mergeIgnoreRules(['*.timestamp', 'X-Custom-Rule', 'token'], true)
    expect(merged.filter((r) => r === '*.timestamp')).toHaveLength(1)
    expect(merged.filter((r) => r === 'token')).toHaveLength(1)
    expect(merged).toContain('X-Custom-Rule')
    expect(merged[0]).toBe('*.timestamp') // 用户规则优先保留在前
    // 仅多出一个自定义项
    expect(merged.length).toBe(BUILTIN_IGNORE_RULES.length + 1)
  })
})

describe('QA-Extra: useBuiltinIgnore=false 时内置完全不生效', () => {
  it('useBuiltin=false：内置通配 *.timestamp 不应用，timestamp 差异被计入', () => {
    const reqA = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 111, id: 99 } }) })
    const reqB = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 222, id: 99 } }) })
    const effective = mergeIgnoreRules([], false)
    expect(effective).toEqual([]) // 内置未并入
    const a = effective.length ? applyIgnoreRules(reqA, effective) : reqA
    const b = effective.length ? applyIgnoreRules(reqB, effective) : reqB
    const diffOff = computeDiff(a, b)
    const tsDelta = (diffOff.requestBody.delta ?? []).find((d) => d.path === 'data.timestamp')
    expect(tsDelta).toBeDefined()
  })

  it('useBuiltin=true：内置通配 *.timestamp 应用，timestamp 差异被剔除', () => {
    const reqA = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 111, id: 99 } }) })
    const reqB = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 222, id: 99 } }) })
    const effective = mergeIgnoreRules([], true)
    expect(effective.length).toBeGreaterThan(0)
    const a = applyIgnoreRules(reqA, effective)
    const b = applyIgnoreRules(reqB, effective)
    const diffOn = computeDiff(a, b)
    const tsDelta = (diffOn.requestBody.delta ?? []).find((d) => d.path === 'data.timestamp')
    expect(tsDelta).toBeUndefined()
    // 业务字段 id 相同，仍无差异
    expect((diffOn.requestBody.delta ?? []).find((d) => d.path === 'data.id')).toBeUndefined()
  })

  it('mergeIgnoreRules([], false) → []，applyIgnoreRules 不剔除任何内置字段', () => {
    const req = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 1, id: 2 }, user: { token: 'a' } }) })
    const effectiveOff = mergeIgnoreRules([], false)
    expect(effectiveOff).toEqual([])
    const outOff = applyIgnoreRules(req, effectiveOff)
    const rbOff = JSON.parse(outOff.requestBody)
    expect(rbOff.data.timestamp).toBe(1) // 内置未生效
    expect(rbOff.user.token).toBe('a')
  })
})
