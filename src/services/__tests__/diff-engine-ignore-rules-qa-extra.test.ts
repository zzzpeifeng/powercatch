/**
 * QA 补充边界测试（严过关 / Edward）
 * 针对工程师已交付的 applyIgnoreRules 边界用例做独立补充验证：
 *   - 深层 3 级嵌套 JSON 路径剔除的准确性
 *   - 规则列表含空字符串 / 纯空白项时是否仍然健壮（不崩溃、不误剔除）
 *   - Header 规则大小写不敏感：大写规则命中小写实际 Header（反向确认）
 *
 * 运行：npx vitest run src/services/__tests__/diff-engine-ignore-rules-qa-extra.test.ts
 */
import { describe, it, expect } from 'vitest'
import { applyIgnoreRules } from '../diff-engine'
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
    requestHeaders: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-123', 'x-token': 'tok' },
    requestBody: '{}',
    responseHeaders: { 'Content-Type': 'application/json', 'X-Request-Id': 'resp-456' },
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

describe('applyIgnoreRules — QA 边界补充', () => {
  it('1. 深层 3 级嵌套 JSON 路径剔除（user.profile.token）', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({
        user: { profile: { token: 't-1', name: 'n' }, id: 'u1' },
        keep: true,
      }),
    })
    const out = applyIgnoreRules(req, ['user.profile.token'])

    const rb = JSON.parse(out.requestBody)
    expect(rb.user.profile.token).toBeUndefined()
    // 同级 / 祖父级其它字段保留
    expect(rb.user.profile.name).toBe('n')
    expect(rb.user.id).toBe('u1')
    expect(rb.keep).toBe(true)
  })

  it('2. 规则含空字符串与纯空白项：不崩溃、不误剔除字段', () => {
    const req = makeRequest({ requestBody: JSON.stringify({ data: { timestamp: 1 } }) })
    const before = JSON.parse(JSON.stringify(req))

    // 空串 + 空白项 + 一条有效规则混排
    const out = applyIgnoreRules(req, ['', '   ', 'X-Request-Id', '   '])

    // 有效规则仍生效
    expect(out.requestHeaders).not.toHaveProperty('X-Request-Id')
    // 空串/空白项是无效规则，不应误剔除任何 header / query / JSON 字段
    expect(out.requestHeaders['Content-Type']).toBe('application/json')
    expect(out.requestHeaders['x-token']).toBe('tok')
    expect(out.url).toContain('signature=abc')
    expect(JSON.parse(out.requestBody).data.timestamp).toBe(1)
    // 入参未被修改
    expect(JSON.stringify(req)).toBe(JSON.stringify(before))
  })

  it('3. Header 规则大小写不敏感（反向）：大写规则命中小写实际 Header', () => {
    // 实际 Header 为小写 'x-token'，规则用大写 'X-TOKEN'
    const req = makeRequest()
    const out = applyIgnoreRules(req, ['X-TOKEN'])

    expect(out.requestHeaders).not.toHaveProperty('x-token')
    // 其余 header 不受影响
    expect(out.requestHeaders['Content-Type']).toBe('application/json')
    expect(out.requestHeaders['X-Request-Id']).toBe('req-123')
  })
})
