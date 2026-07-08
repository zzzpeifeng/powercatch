import { describe, it, expect } from 'vitest'
import { buildDomainTree, sortDomains } from '../tree-builder'
import type { CaptureRequest, DomainNode } from '../../services/types'

function makeReq(id: string, host: string, capturedAt: string): CaptureRequest {
  return {
    id,
    host,
    url: `https://${host}/`,
    path: '/',
    method: 'GET',
    statusCode: 200,
    capturedAt,
    duration: 1,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: '',
    responseBody: '',
    clientIp: '127.0.0.1',
    deviceName: '127.0.0.1',
    isRecorded: true,
    selected: false,
    checked: false,
  }
}

function hostsOf(domains: DomainNode[]): string[] {
  return domains.map((d) => d.host)
}

describe('sortDomains - firstSeen 稳定性', () => {
  it('已有域名新增请求时，其相对顺序不变（与 latest 对比）', () => {
    const reqs = [
      makeReq('1', 'a.com', '2026-07-08T10:00:00Z'),
      makeReq('2', 'b.com', '2026-07-08T10:01:00Z'),
      makeReq('3', 'c.com', '2026-07-08T10:02:00Z'),
    ]
    // 初始 firstSeen 顺序：a, b, c
    const base = sortDomains(buildDomainTree(reqs, 'firstSeen'), 'firstSeen')
    expect(hostsOf(base)).toEqual(['a.com', 'b.com', 'c.com'])

    // 给 b.com 追加一条最新请求（最新活动应当把它顶到最前）
    const withNew = [...reqs, makeReq('4', 'b.com', '2026-07-08T11:00:00Z')]
    const latest = sortDomains(buildDomainTree(withNew, 'latest'), 'latest')
    expect(hostsOf(latest)).toEqual(['b.com', 'c.com', 'a.com'])

    // firstSeen 下 b.com 仍排在 a、c 之后，位置不变
    const firstSeen = sortDomains(buildDomainTree(withNew, 'firstSeen'), 'firstSeen')
    expect(hostsOf(firstSeen)).toEqual(['a.com', 'b.com', 'c.com'])
  })

  it('新域名追加到列表底部（首次出现时间最新）', () => {
    const reqs = [
      makeReq('1', 'a.com', '2026-07-08T10:00:00Z'),
      makeReq('2', 'b.com', '2026-07-08T10:01:00Z'),
    ]
    const withNew = [...reqs, makeReq('3', 'd.com', '2026-07-08T10:05:00Z')]
    const firstSeen = sortDomains(buildDomainTree(withNew, 'firstSeen'), 'firstSeen')
    expect(hostsOf(firstSeen)).toEqual(['a.com', 'b.com', 'd.com'])
  })

  it('(unknown) 始终置底', () => {
    const reqs = [
      makeReq('1', '(unknown)', '2026-07-08T09:00:00Z'),
      makeReq('2', 'a.com', '2026-07-08T10:00:00Z'),
    ]
    const firstSeen = sortDomains(buildDomainTree(reqs, 'firstSeen'), 'firstSeen')
    expect(hostsOf(firstSeen)).toEqual(['a.com', '(unknown)'])
  })

  it('domain 节点携带 firstSeenCapturedAt（最早一条请求时间）', () => {
    const reqs = [
      makeReq('1', 'a.com', '2026-07-08T10:00:00Z'),
      makeReq('2', 'a.com', '2026-07-08T12:00:00Z'), // 更新的请求
    ]
    const domains = buildDomainTree(reqs, 'firstSeen')
    expect(domains[0].firstSeenCapturedAt).toBe('2026-07-08T10:00:00Z')
    expect(domains[0].latestCapturedAt).toBe('2026-07-08T12:00:00Z')
  })
})
