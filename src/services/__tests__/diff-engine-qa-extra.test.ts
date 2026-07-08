/**
 * QA 独立验证补充测试（严过关 / Yan）
 * 针对「对比忽略规则」实现，补充工程师可能遗漏的边界场景，独立验证源码正确性。
 * 说明：内置确定性启发式名单（BUILTIN_IGNORE_RULES）已移除，改为对比后由 AI 弹窗建议，
 *      故本文件仅验证 applyIgnoreRules 与 mergeIgnoreRules 的「用户规则」行为。
 * 运行：npx vitest run src/services/__tests__/diff-engine-qa-extra.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  applyIgnoreRules,
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

describe('QA-Extra: mergeIgnoreRules 用户规则去重与顺序', () => {
  it('用户规则含重复项时自动去重', () => {
    const merged = mergeIgnoreRules(['*.timestamp', 'token', '*.timestamp'])
    expect(merged.filter((r) => r === '*.timestamp')).toHaveLength(1)
    expect(merged.filter((r) => r === 'token')).toHaveLength(1)
    expect(merged).toHaveLength(2)
  })

  it('用户规则含自定义项：保留且顺序稳定（用户项在前）', () => {
    const merged = mergeIgnoreRules(['*.timestamp', 'X-Custom-Rule', 'token'])
    expect(merged).toContain('X-Custom-Rule')
    expect(merged[0]).toBe('*.timestamp')
  })
})

describe('QA-Extra: 用户规则为空 / 显式忽略时不混入任何内置名单', () => {
  it('mergeIgnoreRules([]) → []，applyIgnoreRules 不剔除任何字段', () => {
    const req = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 1, id: 2 }, user: { token: 'a' } }) })
    const effective = mergeIgnoreRules([])
    expect(effective).toEqual([])
    const out = applyIgnoreRules(req, effective)
    const rb = JSON.parse(out.requestBody)
    expect(rb.data.timestamp).toBe(1)
    expect(rb.user.token).toBe('a')
  })

  it('用户显式配置 *.timestamp：timestamp 差异被剔除（无需内置名单）', () => {
    const reqA = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 111, id: 99 } }) })
    const reqB = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 222, id: 99 } }) })
    const effective = mergeIgnoreRules(['*.timestamp'])
    expect(effective.length).toBeGreaterThan(0)
    const a = applyIgnoreRules(reqA, effective)
    const b = applyIgnoreRules(reqB, effective)
    const diff = computeDiff(a, b)
    const tsDelta = (diff.requestBody.delta ?? []).find((d) => d.path === 'data.timestamp')
    expect(tsDelta).toBeUndefined()
    // 业务字段 id 相同，仍无差异
    expect((diff.requestBody.delta ?? []).find((d) => d.path === 'data.id')).toBeUndefined()
  })
})
