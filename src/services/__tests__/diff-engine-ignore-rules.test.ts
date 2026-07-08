/**
 * diff-engine.applyIgnoreRules 单元测试（纯函数）
 *
 * 覆盖规则约定：
 *   - 含 '.' → JSON body 路径（点号表示法），如 'data.timestamp'
 *   - 不含 '.' → Header 名 或 Query 参数名（大小写不敏感），如 'X-Request-Id'
 *
 * 用例：
 *   1. Header 剔除（大小写不敏感）：requestHeaders / responseHeaders
 *   2. Query 参数剔除：URL query string（大小写不敏感）
 *   3. JSON body 路径剔除：requestBody / responseBody（点号路径，叶子字段删除后重新序列化）
 *   4. 空规则：原样返回，不修改入参（零开销）
 */
import { describe, it, expect } from 'vitest'
import { applyIgnoreRules, mergeIgnoreRules } from '../diff-engine'
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
    requestHeaders: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-123', Authorization: 'Bearer tk' },
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

describe('applyIgnoreRules', () => {
  it('1. Header 剔除（大小写不敏感）：请求头 + 响应头均命中', () => {
    const req = makeRequest()
    const out = applyIgnoreRules(req, ['x-request-id', 'Authorization'])

    // 请求头：两个 header 均被剔除（大小写不敏感匹配 'x-request-id'）
    expect(out.requestHeaders).not.toHaveProperty('X-Request-Id')
    expect(out.requestHeaders).not.toHaveProperty('Authorization')
    expect(out.requestHeaders['Content-Type']).toBe('application/json')

    // 响应头：X-Request-Id 被剔除，Content-Type 保留
    expect(out.responseHeaders).not.toHaveProperty('X-Request-Id')
    expect(out.responseHeaders['Content-Type']).toBe('application/json')
  })

  it('2. Query 参数剔除：URL 中命中的 query 参数被移除（大小写不敏感）', () => {
    const req = makeRequest({ url: 'https://api.example.com/order?signature=abc&page=1&X-TOKEN=zzz' })
    const out = applyIgnoreRules(req, ['signature', 'x-token'])

    expect(out.url).not.toContain('signature')
    expect(out.url).not.toContain('x-token')
    expect(out.url).toContain('page=1')
  })

  it('3. JSON body 路径剔除：request/response body 点号路径叶子被删除并重新序列化', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({ data: { timestamp: 1700000000, id: 1 }, user: { token: 't', name: 'n' } }),
      responseBody: JSON.stringify({ data: { timestamp: 1700000001 }, keep: true }),
    })
    const out = applyIgnoreRules(req, ['data.timestamp', 'user.token'])

    const rb = JSON.parse(out.requestBody)
    expect(rb.data.timestamp).toBeUndefined()
    expect(rb.data.id).toBe(1) // 同层其它字段保留
    expect(rb.user.token).toBeUndefined()
    expect(rb.user.name).toBe('n')

    const resp = JSON.parse(out.responseBody)
    expect(resp.data.timestamp).toBeUndefined()
    expect(resp.keep).toBe(true)
  })

  it('4. 空规则：原样返回且不修改入参（零开销）', () => {
    const req = makeRequest()
    const before = JSON.stringify(req)
    const out = applyIgnoreRules(req, [])
    // 返回的是同一引用（未做无意义拷贝）
    expect(out).toBe(req)
    expect(JSON.stringify(req)).toBe(before)
  })

  it('5. 混合规则：Header 名 + JSON 路径同时生效', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({ data: { timestamp: 1 } }),
    })
    const out = applyIgnoreRules(req, ['X-Request-Id', 'data.timestamp'])

    expect(out.requestHeaders).not.toHaveProperty('X-Request-Id')
    expect(JSON.parse(out.requestBody).data.timestamp).toBeUndefined()
  })
})

// ===== 合并（内置启发式名单已移除，仅处理用户规则） =====

describe('mergeIgnoreRules', () => {
  it('去重并保持原有顺序', () => {
    const merged = mergeIgnoreRules(['X-Request-Id', 'data.timestamp', 'X-Request-Id'])
    expect(merged).toHaveLength(2)
    expect(merged).toEqual(['X-Request-Id', 'data.timestamp'])
  })

  it('空 / undefined / null userRules 不报错，返回 []', () => {
    expect(mergeIgnoreRules(undefined as unknown as string[])).toEqual([])
    expect(mergeIgnoreRules(null as unknown as string[])).toEqual([])
    expect(mergeIgnoreRules([])).toEqual([])
  })

  it('内置名单已移除：不再自动追加 *.timestamp / x-request-id 等内置规则', () => {
    const merged = mergeIgnoreRules(['X-Request-Id'])
    expect(merged).toContain('X-Request-Id')
    expect(merged).toHaveLength(1)
    expect(merged).not.toContain('*.timestamp')
    expect(merged).not.toContain('x-request-id')
  })
})

describe('applyIgnoreRules - *. 通配路径', () => {
  it('*.timestamp / *.token 剔除任意父路径下的同名叶子字段', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({ data: { timestamp: 1, id: 2 }, user: { token: 'a' } }),
      responseBody: '{}',
    })
    const out = applyIgnoreRules(req, ['*.timestamp', '*.token'])
    const rb = JSON.parse(out.requestBody)
    expect(rb.data.timestamp).toBeUndefined()
    expect(rb.user.token).toBeUndefined()
    // 非命中字段保留
    expect(rb.data.id).toBe(2)
    expect(rb.user).toEqual({})
  })

  it('精确规则 data.timestamp 仍生效（向后兼容）', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({ data: { timestamp: 1, id: 2 }, user: { token: 'a' } }),
      responseBody: '{}',
    })
    const out = applyIgnoreRules(req, ['data.timestamp'])
    const rb = JSON.parse(out.requestBody)
    expect(rb.data.timestamp).toBeUndefined()
    expect(rb.data.id).toBe(2)
    // user.token 不受影响（仅精确路径）
    expect(rb.user.token).toBe('a')
  })

  it('通配不影响非命中字段（嵌套数组也安全）', () => {
    const req = makeRequest({
      requestBody: JSON.stringify({
        list: [{ timestamp: 1, name: 'a' }, { timestamp: 2, name: 'b' }],
        meta: { token: 'x' },
      }),
      responseBody: '{}',
    })
    const out = applyIgnoreRules(req, ['*.timestamp', '*.token'])
    const rb = JSON.parse(out.requestBody)
    expect(rb.list[0].timestamp).toBeUndefined()
    expect(rb.list[0].name).toBe('a')
    expect(rb.list[1].timestamp).toBeUndefined()
    expect(rb.list[1].name).toBe('b')
    expect(rb.meta.token).toBeUndefined()
  })
})
