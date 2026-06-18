import type { CaptureRequest, DomainNode, DomainSortMode, FlatTreeNode } from '../services/types'
import { formatHostWithProtocol } from './url-formatter'

/**
 * 树状结构构建工具
 * 从扁平 CaptureRequest[] 派生域名分组树，并展平为虚拟滚动行
 */

/**
 * 搜索匹配：path/method/statusCode/host(带协议)
 * @param req 请求对象
 * @param query 搜索关键词（已转小写）
 * @returns 是否匹配
 */
export function matchSearch(req: CaptureRequest, query: string): boolean {
  return (
    req.path.toLowerCase().includes(query) ||
    req.method.toLowerCase().includes(query) ||
    String(req.statusCode).includes(query) ||
    formatHostWithProtocol(req.host, req.url).toLowerCase().includes(query)
  )
}

/**
 * 按 host 分组构建域名树
 * @param requests 已排序的请求列表（newest first）
 * @param sortMode 域名排序模式
 * @returns 域名节点数组
 */
export function buildDomainTree(requests: CaptureRequest[], sortMode: DomainSortMode): DomainNode[] {
  const map = new Map<string, CaptureRequest[]>()
  for (const req of requests) {
    const host = req.host || '(unknown)'
    if (!map.has(host)) map.set(host, [])
    map.get(host)!.push(req)
  }

  const domains: DomainNode[] = []
  for (const [host, children] of map) {
    // children 按 capturedAt 降序（newest first）
    children.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())

    domains.push({
      type: 'domain',
      host,
      children,
      count: children.length,
      hasError: children.some(r => r.statusCode !== null && r.statusCode >= 400),
      pendingCount: children.filter(r => r.statusCode === null).length,
      latestCapturedAt: children[0]?.capturedAt || '',
      hasSelected: children.some(r => r.selected),
      hasChecked: children.some(r => r.checked),
    })
  }

  return sortDomains(domains, sortMode)
}

/**
 * 域名排序
 * @param domains 域名节点数组
 * @param mode 排序模式
 * @returns 排序后的域名节点数组
 */
export function sortDomains(domains: DomainNode[], mode: DomainSortMode): DomainNode[] {
  const sorted = [...domains]
  switch (mode) {
    case 'latest':
      sorted.sort((a, b) => new Date(b.latestCapturedAt).getTime() - new Date(a.latestCapturedAt).getTime())
      break
    case 'count':
      sorted.sort((a, b) => b.count - a.count)
      break
    case 'alphabetical':
      sorted.sort((a, b) => a.host.localeCompare(b.host))
      break
  }
  // '(unknown)' 始终排最后
  const unknownIdx = sorted.findIndex(d => d.host === '(unknown)')
  if (unknownIdx !== -1) {
    const [unknown] = sorted.splice(unknownIdx, 1)
    sorted.push(unknown)
  }
  return sorted
}

/**
 * 展平树为虚拟滚动行数组
 * @param domains 域名节点数组
 * @param collapsedDomains 已折叠的域名集合
 * @param searchQuery 搜索关键词
 * @returns 展平后的行数组
 */
export function flattenTree(
  domains: DomainNode[],
  collapsedDomains: Set<string>,
  searchQuery: string
): FlatTreeNode[] {
  const query = searchQuery.trim().toLowerCase()
  const rows: FlatTreeNode[] = []

  for (const domain of domains) {
    // 搜索时过滤子节点
    const children = query
      ? domain.children.filter(req => matchSearch(req, query))
      : domain.children

    // 搜索时无匹配子节点的域名 → 隐藏
    if (query && children.length === 0) continue

    // 搜索时强制展开；否则按折叠状态
    const expanded = query ? true : !collapsedDomains.has(domain.host)

    // 从第一个子请求的 url 推断协议
    const displayHost = formatHostWithProtocol(domain.host, domain.children[0]?.url || '')

    rows.push({
      type: 'domain',
      key: `domain:${domain.host}`,
      depth: 0,
      host: domain.host,
      displayHost,
      count: query ? children.length : domain.count,
      totalCount: query ? domain.count : undefined,
      hasError: domain.hasError,
      pendingCount: domain.pendingCount,
      expanded,
      hasSelected: domain.hasSelected,
      hasChecked: domain.hasChecked,
    })

    if (expanded) {
      for (const req of children) {
        rows.push({
          type: 'request',
          key: req.id,
          depth: 1,
          request: req,
        })
      }
    }
  }

  return rows
}
