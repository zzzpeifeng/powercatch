import { describe, it, expect } from 'vitest'
import { buildPathTree, flattenPathTree, getPathKey, matchSearch } from '../tree-builder'
import type { CaptureRequest, HttpMethod, PathNode } from '../../services/types'

function makeReq(over: {
  id: string
  host: string
  path: string
  method?: HttpMethod
  statusCode?: number | null
  capturedAt: string
}): CaptureRequest {
  return {
    id: over.id,
    host: over.host,
    url: `https://${over.host}${over.path}`,
    path: over.path,
    method: over.method ?? 'GET',
    statusCode: over.statusCode ?? 200,
    capturedAt: over.capturedAt,
    duration: 10,
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

function findIntermediate(root: PathNode, seg: string): PathNode | undefined {
  return root.children.find((c) => c.kind === 'intermediate' && c.segment === seg)
}

function collectExpandKeys(node: PathNode, set: Set<string> = new Set()): Set<string> {
  if (node.kind !== 'leaf') set.add(node.pathKey)
  for (const c of node.children) collectExpandKeys(c, set)
  return set
}

describe('buildPathTree - 递归结构', () => {
  it('按 host 分组 → path 切段逐层建 trie（域名根 → 中间段 → 叶子）', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/sl/apps/pos/app/close-account/detail', capturedAt: '2026-01-01T00:00:00Z' }),
    ]
    const roots = buildPathTree(reqs, 'firstSeen')
    expect(roots).toHaveLength(1)

    const root = roots[0]
    expect(root.kind).toBe('domain')
    expect(root.segment).toBe('a.com')
    expect(root.pathKey).toBe('a.com')
    expect(root.descendantCount).toBe(1)

    let node = findIntermediate(root, 'sl')!
    expect(node).toBeDefined()
    node = findIntermediate(node, 'apps')!
    node = findIntermediate(node, 'pos')!
    node = findIntermediate(node, 'app')!
    node = findIntermediate(node, 'close-account')!
    expect(node.children).toHaveLength(1)
    expect(node.children[0].kind).toBe('leaf')
    expect(node.children[0].segment).toBe('detail')
    expect(node.children[0].pathKey).toBe('a.com::sl/apps/pos/app/close-account/detail')
  })

  it('动态 ID 段按原样分段（决策#6）：/order/12345/detail → order → 12345 → detail', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/order/12345/detail', capturedAt: '2026-01-01T00:00:00Z' }),
    ]
    const root = buildPathTree(reqs, 'firstSeen')[0]
    const order = findIntermediate(root, 'order')!
    const id12345 = findIntermediate(order, '12345')!
    expect(id12345).toBeDefined()
    expect(id12345.children[0].kind).toBe('leaf')
    expect(id12345.children[0].segment).toBe('detail')
  })

  it('空路径 / 归为 (root) 叶子（U8）', () => {
    const reqs = [makeReq({ id: '1', host: 'a.com', path: '/', capturedAt: '2026-01-01T00:00:00Z' })]
    const root = buildPathTree(reqs, 'firstSeen')[0]
    expect(root.children).toHaveLength(1)
    expect(root.children[0].kind).toBe('leaf')
    expect(root.children[0].segment).toBe('(root)')
    expect(root.children[0].depth).toBe(1)
  })
})

describe('buildPathTree - 同末段不同 method 不拆（决策#5）', () => {
  it('同一末段下并列多条叶子，用 request 区分', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/orders', method: 'GET', capturedAt: '2026-01-01T00:00:00Z' }),
      makeReq({ id: '2', host: 'a.com', path: '/orders', method: 'POST', capturedAt: '2026-01-02T00:00:00Z' }),
    ]
    const root = buildPathTree(reqs, 'firstSeen')[0]
    expect(root.children).toHaveLength(2)
    expect(root.children.every((c) => c.kind === 'leaf' && c.segment === 'orders')).toBe(true)
    expect(new Set(root.children.map((c) => c.request!.id)).size).toBe(2)
    expect(new Set(root.children.map((c) => c.request!.method)).size).toBe(2)
  })
})

describe('buildPathTree - firstSeen 稳定排序（决策#4）', () => {
  it('中间/叶子同级按 firstSeenCapturedAt 升序（最早在前），不随新请求跳动', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/b/second', capturedAt: '2026-01-02T00:00:00Z' }),
      makeReq({ id: '2', host: 'a.com', path: '/a/first', capturedAt: '2026-01-01T00:00:00Z' }),
    ]
    const root = buildPathTree(reqs, 'firstSeen')[0]
    // 'a' (firstSeen 01-01) 应在 'b' (01-02) 之前
    expect(root.children.map((c) => c.segment)).toEqual(['a', 'b'])
  })

  it('firstSeen 同值按 segment 字母序兜底（稳定）', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/z', capturedAt: '2026-01-01T00:00:00Z' }),
      makeReq({ id: '2', host: 'a.com', path: '/m', capturedAt: '2026-01-01T00:00:00Z' }),
      makeReq({ id: '3', host: 'a.com', path: '/a', capturedAt: '2026-01-01T00:00:00Z' }),
    ]
    const root = buildPathTree(reqs, 'firstSeen')[0]
    expect(root.children.map((c) => c.segment)).toEqual(['a', 'm', 'z'])
  })
})

describe('flattenPathTree - 折叠/展开', () => {
  it('默认全折叠（expanded 为空）仅显示域名根', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/sl/apps/pos/detail', capturedAt: '2026-01-01T00:00:00Z' }),
    ]
    const roots = buildPathTree(reqs, 'firstSeen')
    const flat = flattenPathTree(roots, new Set(), '', false)
    expect(flat).toHaveLength(1)
    expect(flat[0].nodeKind).toBe('domain')
  })

  it('展开域名根后显示其直接子节点，未展开的中间节点子树隐藏', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/x/y/z', capturedAt: '2026-01-01T00:00:00Z' }),
    ]
    const roots = buildPathTree(reqs, 'firstSeen')
    const flat = flattenPathTree(roots, new Set(['a.com']), '', false)
    expect(flat.map((r) => r.segmentLabel)).toEqual(['a.com', 'x'])
  })

  it('展开全部 pathKey 显示所有叶子', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/sl/apps/pos/app/close-account/detail', capturedAt: '2026-01-01T00:00:00Z', method: 'GET' }),
      makeReq({ id: '2', host: 'a.com', path: '/sl/apps/pos/app/order/detail', capturedAt: '2026-01-02T00:00:00Z', method: 'GET' }),
      makeReq({ id: '3', host: 'a.com', path: '/sl/apps/checkout/cart', capturedAt: '2026-01-03T00:00:00Z', method: 'GET' }),
    ]
    const roots = buildPathTree(reqs, 'firstSeen')
    const keys = collectExpandKeys(roots[0])
    const flat = flattenPathTree(roots, keys, '', false)
    expect(flat.filter((r) => r.nodeKind === 'leaf')).toHaveLength(3)
  })
})

describe('flattenPathTree - 连接线标记（isLastChild / connectorVertical）', () => {
  it('多域名根：末位域名 isLastChild=true，其余 false', () => {
    const reqs = [
      makeReq({ id: '1', host: 'a.com', path: '/x', capturedAt: '2026-01-01T00:00:00Z' }),
      makeReq({ id: '2', host: 'b.com', path: '/y', capturedAt: '2026-01-02T00:00:00Z' }),
    ]
    const roots = buildPathTree(reqs, 'firstSeen') // a.com 在前
    const flat = flattenPathTree(roots, collectExpandKeys(roots[0]), '', false)
    const a = flat.find((r) => r.nodeKind === 'domain' && r.segmentLabel === 'a.com')!
    const b = flat.find((r) => r.nodeKind === 'domain' && r.segmentLabel === 'b.com')!
    expect(a.isLastChild).toBe(false)
    expect(b.isLastChild).toBe(true)
  })

  it('分支结构：isLastChild 与 connectorVertical 正确', () => {
    const reqs = [
      makeReq({ id: '1', host: 'h.com', path: '/a/b/c', capturedAt: '2026-01-01T00:00:00Z' }),
      makeReq({ id: '2', host: 'h.com', path: '/a/d', capturedAt: '2026-01-02T00:00:00Z' }),
    ]
    // 排序：b (01-01) 在 d (01-02) 前 → a.children = [b, d]
    const roots = buildPathTree(reqs, 'firstSeen')
    const flat = flattenPathTree(roots, collectExpandKeys(roots[0]), '', false)
    const b = flat.find((r) => r.nodeKind === 'intermediate' && r.segmentLabel === 'b')!
    const c = flat.find((r) => r.nodeKind === 'leaf' && r.segmentLabel === 'c')!
    // 注意：/a/d 仅两段 → 'd' 是 a 下的叶子（非 intermediate）
    const d = flat.find((r) => r.nodeKind === 'leaf' && r.segmentLabel === 'd')!
    // b 是 a 的第一个子 → 非末位；c 是 b 的唯一子 → 末位；d 是 a 的末位子 → 末位
    expect(b.isLastChild).toBe(false)
    expect(c.isLastChild).toBe(true)
    expect(d.isLastChild).toBe(true)
    // connectorVertical 长度 = depth；a 是唯一子（无后续兄弟）→ 全 false。
    // 但 b 有后续兄弟 d（同一父 a 下），故 b 层级（c 的 connectorVertical[2]）需画 │ → true。
    expect(b.connectorVertical).toEqual([false, false])
    expect(c.connectorVertical).toEqual([false, false, true])
    expect(d.connectorVertical).toEqual([false, false])
  })
})

describe('getPathKey', () => {
  it('空段返回 host；多段返回 host::seg1/seg2', () => {
    expect(getPathKey('a.com', [])).toBe('a.com')
    expect(getPathKey('a.com', ['sl', 'apps'])).toBe('a.com::sl/apps')
  })
})

describe('flattenPathTree - 搜索聚焦式呈现（决策#7，U2）', () => {
  const reqs = [
    makeReq({ id: '1', host: 'a.com', path: '/sl/apps/pos/app/close-account/detail', capturedAt: '2026-01-01T00:00:00Z', method: 'GET' }),
    makeReq({ id: '2', host: 'a.com', path: '/sl/apps/pos/app/order/detail', capturedAt: '2026-01-02T00:00:00Z', method: 'GET' }),
    makeReq({ id: '3', host: 'a.com', path: '/sl/apps/checkout/cart', capturedAt: '2026-01-03T00:00:00Z', method: 'GET' }),
  ]
  const roots = buildPathTree(reqs, 'firstSeen')

  it('命中叶子 + 其祖先链显示，非命中同级隐藏', () => {
    const flat = flattenPathTree(roots, new Set(), 'close-account', true)
    expect(flat[0].nodeKind).toBe('domain')
    expect(flat.filter((r) => r.nodeKind === 'leaf').map((r) => r.segmentLabel)).toEqual(['detail'])
    expect(flat.filter((r) => r.nodeKind === 'intermediate').map((r) => r.segmentLabel))
      .toEqual(['sl', 'apps', 'pos', 'app', 'close-account'])
    // 非命中分支不得出现
    expect(flat.some((r) => r.segmentLabel === 'order')).toBe(false)
    expect(flat.some((r) => r.segmentLabel === 'checkout')).toBe(false)
    expect(flat.some((r) => r.segmentLabel === 'cart')).toBe(false)
  })

  it('命中行带 highlighted 标记', () => {
    const flat = flattenPathTree(roots, new Set(), 'close-account', true)
    const leaf = flat.find((r) => r.nodeKind === 'leaf')!
    expect(leaf.highlighted).toBe(true)
  })

  it('支持 method / statusCode / host 字段匹配', () => {
    expect(flattenPathTree(roots, new Set(), 'post', true).some((r) => r.nodeKind === 'leaf')).toBe(false)
    const roots2 = buildPathTree([
      makeReq({ id: '9', host: 'a.com', path: '/foo', capturedAt: '2026-01-01T00:00:00Z', method: 'POST', statusCode: 404 }),
    ], 'firstSeen')
    expect(flattenPathTree(roots2, new Set(), 'post', true).some((r) => r.nodeKind === 'leaf')).toBe(true)
    expect(flattenPathTree(roots2, new Set(), '404', true).some((r) => r.nodeKind === 'leaf')).toBe(true)
    expect(flattenPathTree(roots2, new Set(), 'a.com', true).some((r) => r.nodeKind === 'leaf')).toBe(true)
  })

  it('空查询或非搜索态不做聚焦过滤', () => {
    const focusing = flattenPathTree(roots, new Set(), 'close-account', true)
    const notSearch = flattenPathTree(roots, new Set(), 'close-account', false)
    expect(notSearch).toHaveLength(1) // 全折叠仅域名根
    expect(focusing.length).toBeGreaterThan(notSearch.length)
  })
})
