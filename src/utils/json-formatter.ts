/**
 * JSON 格式化与差异高亮工具
 */

/** 格式化的 JSON 节点 */
export interface FormattedNode {
  key: string
  value: any
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
  depth: number
  isExpandable: boolean
  children?: FormattedNode[]
}

/** 差异类型 */
export type DiffType = 'added' | 'removed' | 'changed' | 'unchanged'

/** 差异结果项 */
export interface DiffItem {
  path: string
  type: DiffType
  valueA: any
  valueB: any
  description: string
}

/** 差异结果 */
export interface DiffResult {
  items: DiffItem[]
  summary: {
    added: number
    removed: number
    changed: number
    unchanged: number
  }
}

/**
 * 判断值的类型
 */
function getValueType(value: any): FormattedNode['type'] {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value as FormattedNode['type']
}

/**
 * 构建 JSON 树
 */
export function buildTree(
  obj: any,
  depth: number = 0,
  maxDepth: number = 3,
  key: string = 'root'
): FormattedNode[] {
  const nodes: FormattedNode[] = []

  if (depth >= maxDepth) {
    return [{
      key,
      value: typeof obj === 'object' ? '...' : obj,
      type: getValueType(obj),
      depth,
      isExpandable: false,
    }]
  }

  if (obj === null || obj === undefined) {
    return [{
      key,
      value: 'null',
      type: 'null',
      depth,
      isExpandable: false,
    }]
  }

  if (Array.isArray(obj)) {
    return [{
      key,
      value: `Array(${obj.length})`,
      type: 'array',
      depth,
      isExpandable: obj.length > 0,
      children: obj.map((item, index) => {
        const childNodes = buildTree(item, depth + 1, maxDepth, String(index))
        return childNodes[0] || {
          key: String(index),
          value: String(item),
          type: getValueType(item),
          depth: depth + 1,
          isExpandable: false,
        }
      }),
    }]
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj)
    return entries.map(([k, v]) => {
      const childNodes = buildTree(v, depth + 1, maxDepth, k)
      return {
        key: k,
        value: typeof v === 'object' && v !== null ? (Array.isArray(v) ? `Array(${v.length})` : '{...}') : String(v),
        type: getValueType(v),
        depth,
        isExpandable: typeof v === 'object' && v !== null,
        children: typeof v === 'object' && v !== null ? childNodes : undefined,
      }
    })
  }

  return [{
    key,
    value: String(obj),
    type: getValueType(obj),
    depth,
    isExpandable: false,
  }]
}

/**
 * 格式化 JSON 字符串
 */
export function formatJson(json: string, maxDepth: number = 3): FormattedNode[] {
  try {
    const parsed = JSON.parse(json)
    return buildTree(parsed, 0, maxDepth)
  } catch {
    return [{
      key: 'raw',
      value: json,
      type: 'string',
      depth: 0,
      isExpandable: false,
    }]
  }
}

/**
 * 格式化 JSON 字符串（美化输出）
 */
export function prettyJson(json: string, indent: number = 2): string {
  try {
    return JSON.stringify(JSON.parse(json), null, indent)
  } catch {
    return json
  }
}

/**
 * 判断是否为动态字段（ID、时间戳、URL）
 */
function isDynamicField(key: string): boolean {
  const lowerKey = key.toLowerCase()
  // ID 类
  if (lowerKey.endsWith('id') || lowerKey.endsWith('ids') || lowerKey === 'id') return true
  if (lowerKey.endsWith('seq')) return true
  // 时间类
  if (lowerKey.includes('time') || lowerKey.includes('date') || lowerKey.includes('created') || lowerKey.includes('updated')) return true
  // 链接类
  if (lowerKey.includes('url') || lowerKey.includes('link') || lowerKey.includes('href')) return true
  // Trace 类
  if (lowerKey.includes('trace') || lowerKey.includes('requestid')) return true
  return false
}

/**
 * 递归比较两个对象的差异
 */
function diffObjects(
  objA: any,
  objB: any,
  path: string = '',
  items: DiffItem[] = []
): DiffItem[] {
  // 处理 null/undefined
  if (objA === null || objA === undefined) {
    if (objB !== null && objB !== undefined) {
      items.push({ path, type: 'added', valueA: objA, valueB: objB, description: `字段在 B 中存在，A 中不存在` })
    }
    return items
  }
  if (objB === null || objB === undefined) {
    items.push({ path, type: 'removed', valueA: objA, valueB: objB, description: `字段在 A 中存在，B 中不存在` })
    return items
  }

  // 类型不同
  if (typeof objA !== typeof objB) {
    items.push({ path, type: 'changed', valueA: typeof objA, valueB: typeof objB, description: `类型不同: A=${typeof objA}, B=${typeof objB}` })
    return items
  }

  // 基本类型
  if (typeof objA !== 'object') {
    if (objA !== objB) {
      const isDynamic = isDynamicField(path.split('.').pop() || '')
      if (!isDynamic) {
        items.push({ path, type: 'changed', valueA: objA, valueB: objB, description: `值不同: A=${objA}, B=${objB}` })
      }
    } else {
      items.push({ path, type: 'unchanged', valueA: objA, valueB: objB, description: `值相同` })
    }
    return items
  }

  // 数组
  if (Array.isArray(objA) && Array.isArray(objB)) {
    const maxLen = Math.max(objA.length, objB.length)
    for (let i = 0; i < maxLen; i++) {
      const subPath = `${path}[${i}]`
      if (i >= objA.length) {
        items.push({ path: subPath, type: 'added', valueA: undefined, valueB: objB[i], description: `数组项在 B 中存在` })
      } else if (i >= objB.length) {
        items.push({ path: subPath, type: 'removed', valueA: objA[i], valueB: undefined, description: `数组项在 A 中存在` })
      } else {
        diffObjects(objA[i], objB[i], subPath, items)
      }
    }
    return items
  }

  // 对象
  const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)])
  for (const key of allKeys) {
    const subPath = path ? `${path}.${key}` : key
    if (!(key in objA)) {
      items.push({ path: subPath, type: 'added', valueA: undefined, valueB: objB[key], description: `字段在 B 中存在，A 中不存在` })
    } else if (!(key in objB)) {
      items.push({ path: subPath, type: 'removed', valueA: objA[key], valueB: undefined, description: `字段在 A 中存在，B 中不存在` })
    } else {
      diffObjects(objA[key], objB[key], subPath, items)
    }
  }

  return items
}

/**
 * 高亮两个 JSON 的差异
 */
export function highlightDiff(jsonA: string, jsonB: string): DiffResult {
  let parsedA: any
  let parsedB: any

  try {
    parsedA = JSON.parse(jsonA)
  } catch {
    parsedA = { _raw: jsonA }
  }

  try {
    parsedB = JSON.parse(jsonB)
  } catch {
    parsedB = { _raw: jsonB }
  }

  const items = diffObjects(parsedA, parsedB)

  const summary = {
    added: items.filter((i) => i.type === 'added').length,
    removed: items.filter((i) => i.type === 'removed').length,
    changed: items.filter((i) => i.type === 'changed').length,
    unchanged: items.filter((i) => i.type === 'unchanged').length,
  }

  return { items, summary }
}

/**
 * 尝试解析 JSON，失败返回纯文本
 */
export function tryParseJson(text: string): { isJson: boolean; data: any } {
  try {
    const data = JSON.parse(text)
    return { isJson: true, data }
  } catch {
    return { isJson: false, data: text }
  }
}
