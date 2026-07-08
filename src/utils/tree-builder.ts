import type { CaptureRequest, DomainNode, DomainSortMode, FlatTreeNode, PathNode, TreePathKind } from '../services/types'
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
    // 预计算时间戳，避免排序时反复 new Date
    const timestamps = new Map<CaptureRequest, number>()
    for (const r of children) {
      timestamps.set(r, new Date(r.capturedAt).getTime())
    }
    // children 按 capturedAt 降序（newest first）
    children.sort((a, b) => timestamps.get(b)! - timestamps.get(a)!)

    // 单次遍历完成所有统计
    let hasError = false
    let pendingCount = 0
    let hasSelected = false
    let hasChecked = false
    for (const r of children) {
      if (r.statusCode !== null && r.statusCode >= 400) hasError = true
      if (r.statusCode === null) pendingCount++
      if (r.selected) hasSelected = true
      if (r.checked) hasChecked = true
      // 提前退出：所有标志都已为 true 时不再遍历
      if (hasError && pendingCount > 0 && hasSelected && hasChecked) break
    }

    domains.push({
      type: 'domain',
      host,
      children,
      count: children.length,
      hasError,
      pendingCount,
      latestCapturedAt: children[0]?.capturedAt || '',
      // children 已按 capturedAt 降序，取到最早一条（数组末位）作为首次出现时间
      firstSeenCapturedAt: children[children.length - 1]?.capturedAt || '',
      hasSelected,
      hasChecked,
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
    case 'latest': {
      // 预计算时间戳
      const ts = new Map<DomainNode, number>()
      for (const d of sorted) ts.set(d, new Date(d.latestCapturedAt).getTime())
      sorted.sort((a, b) => ts.get(b)! - ts.get(a)!)
      break
    }
    case 'count':
      sorted.sort((a, b) => b.count - a.count)
      break
    case 'alphabetical':
      sorted.sort((a, b) => a.host.localeCompare(b.host))
      break
    case 'firstSeen': {
      // 首次出现顺序：按域名下最早一条请求的 capturedAt 升序（最早出现排最前）
      // 已有域名收到新请求不改变其 firstSeenCapturedAt，故相对顺序稳定
      const ts = new Map<DomainNode, number>()
      for (const d of sorted) ts.set(d, new Date(d.firstSeenCapturedAt).getTime())
      sorted.sort((a, b) => ts.get(a)! - ts.get(b)!)
      break
    }
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

// ======================================================================
// ===== tree 模式：路径递归树（trie）+ N 层展平 + 搜索聚焦式呈现 =====
// ======================================================================

/**
 * 生成逻辑路径标识（pathKey）
 * - domain：`host`
 * - intermediate / leaf：`host::seg1/seg2/...`（用 `::` 避免与 path 斜杠歧义）
 * @param host 域名
 * @param segments 路径段数组（已按 `/` 切分并过滤空串）
 * @returns pathKey
 */
export function getPathKey(host: string, segments: string[]): string {
  return segments.length > 0 ? `${host}::${segments.join('/')}` : host
}

/**
 * 后序计算子树聚合字段（descendantCount / firstSeenCapturedAt / latestCapturedAt /
 * hasErrorDescendant / pendingCount / hasSelectedDescendant / hasCheckedDescendant），
 * 并对子节点按 firstSeenCapturedAt 升序（同值按 segment 字母序兜底）做稳定排序。
 * @param node 待聚合的 PathNode（会就地修改）
 */
function computeAggregates(node: PathNode): void {
  if (node.kind === 'leaf') {
    const req = node.request!
    node.firstSeenCapturedAt = req.capturedAt
    node.latestCapturedAt = req.capturedAt
    node.descendantCount = 1
    node.hasErrorDescendant = req.statusCode !== null && req.statusCode >= 400
    node.pendingCount = req.statusCode === null ? 1 : 0
    node.hasSelectedDescendant = req.selected
    node.hasCheckedDescendant = req.checked
    return
  }

  let minTime = Infinity
  let maxTime = -Infinity
  let descendantCount = 0
  let hasError = false
  let pending = 0
  let hasSelected = false
  let hasChecked = false

  for (const child of node.children) {
    computeAggregates(child)
    const t = new Date(child.firstSeenCapturedAt).getTime()
    if (t < minTime) minTime = t
    const lt = new Date(child.latestCapturedAt).getTime()
    if (lt > maxTime) maxTime = lt
    descendantCount += child.descendantCount
    hasError = hasError || child.hasErrorDescendant
    pending += child.pendingCount
    hasSelected = hasSelected || child.hasSelectedDescendant
    hasChecked = hasChecked || child.hasCheckedDescendant
  }

  node.firstSeenCapturedAt = minTime === Infinity ? '' : new Date(minTime).toISOString()
  node.latestCapturedAt = maxTime === -Infinity ? '' : new Date(maxTime).toISOString()
  node.descendantCount = descendantCount
  node.hasErrorDescendant = hasError
  node.pendingCount = pending
  node.hasSelectedDescendant = hasSelected
  node.hasCheckedDescendant = hasChecked

  // 稳定排序：firstSeenCapturedAt 升序（决策#4），同值按 segment 字母序兜底
  node.children.sort((a, b) => {
    const ta = new Date(a.firstSeenCapturedAt).getTime()
    const tb = new Date(b.firstSeenCapturedAt).getTime()
    if (ta !== tb) return ta - tb
    return a.segment.localeCompare(b.segment)
  })
}

/**
 * 域名根排序（复用 sortDomains 思路，作用于 PathNode 根）
 */
function sortPathRoots(roots: PathNode[], mode: DomainSortMode): PathNode[] {
  const sorted = [...roots]
  switch (mode) {
    case 'latest': {
      const ts = new Map<PathNode, number>()
      for (const d of sorted) ts.set(d, new Date(d.latestCapturedAt).getTime())
      sorted.sort((a, b) => ts.get(b)! - ts.get(a)!)
      break
    }
    case 'count':
      sorted.sort((a, b) => b.descendantCount - a.descendantCount)
      break
    case 'alphabetical':
      sorted.sort((a, b) => a.host.localeCompare(b.host))
      break
    case 'firstSeen': {
      const ts = new Map<PathNode, number>()
      for (const d of sorted) ts.set(d, new Date(d.firstSeenCapturedAt).getTime())
      sorted.sort((a, b) => ts.get(a)! - ts.get(b)!)
      break
    }
  }
  // '(unknown)' 始终置底
  const unknownIdx = sorted.findIndex(d => d.host === '(unknown)')
  if (unknownIdx !== -1) {
    const [unknown] = sorted.splice(unknownIdx, 1)
    sorted.push(unknown)
  }
  return sorted
}

/**
 * 按 host 分组 → path 以 `/` 切段递归建 trie → 叶子挂 CaptureRequest。
 * 同末段不同 method 不拆（决策#5）：并列多条叶子，用 method 徽章区分。
 * 动态 ID 段按原样分段（决策#6）：`/order/12345/detail` → order → 12345 → detail。
 * @param requests 已过滤+反转的请求列表
 * @param sortMode 域名根排序模式
 * @returns 域名根 PathNode 数组（按 sortMode 排序）
 */
export function buildPathTree(requests: CaptureRequest[], sortMode: DomainSortMode): PathNode[] {
  const byHost = new Map<string, CaptureRequest[]>()
  for (const req of requests) {
    const host = req.host || '(unknown)'
    let bucket = byHost.get(host)
    if (!bucket) {
      bucket = []
      byHost.set(host, bucket)
    }
    bucket.push(req)
  }

  const roots: PathNode[] = []
  for (const [host, reqs] of byHost) {
    const displayHost = formatHostWithProtocol(host, reqs[0]?.url || '')
    const root: PathNode = {
      kind: 'domain',
      segment: host,
      depth: 0,
      host,
      pathKey: host,
      children: [],
      descendantCount: 0,
      hasErrorDescendant: false,
      pendingCount: 0,
      hasSelectedDescendant: false,
      hasCheckedDescendant: false,
      firstSeenCapturedAt: '',
      latestCapturedAt: '',
      displayHost,
    }

    for (const req of reqs) {
      const segments = req.path.split('/').filter(Boolean)
      let parent = root

      // 中间段：segments[0..n-2] 建/取 intermediate（trie）
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]
        let found = parent.children.find(c => c.kind === 'intermediate' && c.segment === seg)
        if (!found) {
          found = {
            kind: 'intermediate',
            segment: seg,
            depth: i + 1,
            host,
            pathKey: getPathKey(host, segments.slice(0, i + 1)),
            children: [],
            descendantCount: 0,
            hasErrorDescendant: false,
            pendingCount: 0,
            hasSelectedDescendant: false,
            hasCheckedDescendant: false,
            firstSeenCapturedAt: '',
            latestCapturedAt: '',
          }
          parent.children.push(found)
        }
        parent = found
      }

      // 叶子：末段作为 leaf（携带 CaptureRequest）；空路径 → '(root)'（U8）
      const leafSeg = segments.length ? segments[segments.length - 1] : '(root)'
      const leafSegments = segments.length ? segments : []
      parent.children.push({
        kind: 'leaf',
        segment: leafSeg,
        depth: segments.length ? segments.length : 1,
        host,
        pathKey: getPathKey(host, leafSegments),
        children: [],
        descendantCount: 0,
        hasErrorDescendant: false,
        pendingCount: 0,
        hasSelectedDescendant: false,
        hasCheckedDescendant: false,
        firstSeenCapturedAt: req.capturedAt,
        latestCapturedAt: req.capturedAt,
        request: req,
      })
    }

    computeAggregates(root)
    roots.push(root)
  }

  return sortPathRoots(roots, sortMode)
}

/**
 * 收集搜索命中叶子的祖先链 pathKey 集合（仅含 domain/intermediate，不含叶子自身 pathKey），
 * 用于聚焦式呈现：仅显示命中叶子 + 其祖先链，非命中同级隐藏。
 */
function collectAncestorKeys(roots: PathNode[], query: string): Set<string> {
  const set = new Set<string>()
  function walk(node: PathNode, ancestorStack: string[]): void {
    if (node.kind === 'leaf') {
      if (matchSearch(node.request!, query)) {
        for (const key of ancestorStack) set.add(key)
      }
      return
    }
    const nextStack = node.kind === 'domain' ? [node.pathKey] : [...ancestorStack, node.pathKey]
    for (const child of node.children) walk(child, nextStack)
  }
  for (const root of roots) walk(root, [])
  return set
}

/**
 * 将递归 PathNode 树展平为 N 层虚拟滚动行。
 * - 非搜索态：仅输出「已展开节点」（由 expanded 决定），并计算连接线标记。
 * - 搜索态（searchMode=true 且 query 非空）：聚焦式——仅输出命中叶子 + 其祖先链，
 *   祖先强制展开，命中行带 highlighted 标记。
 * 连接线：connectorVertical[i]=祖先 i 是否有后续兄弟（true=│）；isLastChild=自身是否末位（true=└─）。
 * @param roots 域名根 PathNode 数组
 * @param expanded 已展开节点 pathKey 集合（存「已展开」，默认空=全折叠，决策#2）
 * @param query 搜索关键词
 * @param searchMode 是否搜索聚焦模式
 * @returns 展平后的 FlatTreeNode[]（tree 模式专用）
 */
export function flattenPathTree(
  roots: PathNode[],
  expanded: Set<string>,
  query: string,
  searchMode = false,
): FlatTreeNode[] {
  const rows: FlatTreeNode[] = []
  const q = query.trim().toLowerCase()
  const useSearch = searchMode && q.length > 0
  const ancestorKeys = useSearch ? collectAncestorKeys(roots, q) : null

  for (let di = 0; di < roots.length; di++) {
    const domain = roots[di]
    const dIsLast = di === roots.length - 1
    if (useSearch && !ancestorKeys!.has(domain.pathKey)) continue
    const dExpanded = useSearch ? true : expanded.has(domain.pathKey)
    rows.push({
      type: 'domain',
      nodeKind: 'domain',
      key: domain.pathKey,
      depth: 0,
      host: domain.host,
      displayHost: domain.displayHost,
      count: domain.descendantCount,
      totalCount: undefined,
      hasError: domain.hasErrorDescendant,
      pendingCount: domain.pendingCount,
      expanded: dExpanded,
      hasSelected: domain.hasSelectedDescendant,
      hasChecked: domain.hasCheckedDescendant,
      segmentLabel: domain.segment,
      pathKey: domain.pathKey,
      descendantCount: domain.descendantCount,
      hasErrorDescendant: domain.hasErrorDescendant,
      hasSelectedDescendant: domain.hasSelectedDescendant,
      hasCheckedDescendant: domain.hasCheckedDescendant,
      connectorVertical: [],
      isLastChild: dIsLast,
      highlighted: false,
    })
    if (dExpanded) recurse(domain, [!dIsLast])
  }

  return rows

  function recurse(node: PathNode, connectorStack: boolean[]): void {
    node.children.forEach((child, i) => {
      const isLast = i === node.children.length - 1
      if (child.kind === 'leaf') {
        if (useSearch && !matchSearch(child.request!, q)) return
        rows.push({
          type: 'request',
          nodeKind: 'leaf',
          key: child.request!.id,
          depth: child.depth,
          host: child.host,
          segmentLabel: child.segment,
          pathKey: child.pathKey,
          isLeaf: true,
          connectorVertical: connectorStack,
          isLastChild: isLast,
          highlighted: useSearch ? matchSearch(child.request!, q) : false,
          request: child.request,
        })
      } else {
        if (useSearch && !ancestorKeys!.has(child.pathKey)) return
        const cExpanded = useSearch ? true : expanded.has(child.pathKey)
        rows.push({
          type: 'request',
          nodeKind: 'intermediate',
          key: child.pathKey,
          depth: child.depth,
          host: child.host,
          segmentLabel: child.segment,
          pathKey: child.pathKey,
          descendantCount: child.descendantCount,
          hasErrorDescendant: child.hasErrorDescendant,
          pendingCount: child.pendingCount,
          hasSelectedDescendant: child.hasSelectedDescendant,
          hasCheckedDescendant: child.hasCheckedDescendant,
          connectorVertical: connectorStack,
          isLastChild: isLast,
          expanded: cExpanded,
          highlighted: false,
        })
        if (cExpanded) recurse(child, [...connectorStack, !isLast])
      }
    })
  }
}
