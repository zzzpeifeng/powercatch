/**
 * 同路径请求匹配与分组工具
 * 按 method + path + query 生成 matchKey，支持自动配对
 */
import type { CaptureRequest } from '../services/types'

/**
 * 规范化查询参数排序
 * @param params URLSearchParams 对象
 * @returns 排序后的查询字符串
 */
export function normalizeQuery(params: URLSearchParams): string {
  const entries: string[] = []
  params.forEach((value, key) => {
    entries.push(`${key}=${value}`)
  })
  entries.sort()
  return entries.join('&')
}

/**
 * 生成请求匹配键
 * 相同 matchKey 的请求来自同一接口
 * @param req 抓包请求
 * @returns 匹配键字符串
 */
export function generateMatchKey(req: CaptureRequest): string {
  try {
    let pathname = req.path
    let query = ''

    if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
      const urlObj = new URL(req.url)
      pathname = urlObj.pathname
      query = normalizeQuery(urlObj.searchParams)
    } else {
      const queryIndex = req.url.indexOf('?')
      if (queryIndex >= 0) {
        const searchParams = new URLSearchParams(req.url.slice(queryIndex + 1))
        query = normalizeQuery(searchParams)
      }
    }

    return `${req.method}:${pathname}:${query}`
  } catch {
    return `${req.method}:${req.path}:`
  }
}

/**
 * 按匹配键分组请求
 * 相同接口的请求归为一组，组内按设备 IP 区分
 * @param requests 请求列表
 * @returns 分组后的 Map
 */
export function groupByMatchKey(requests: CaptureRequest[]): Map<string, CaptureRequest[]> {
  const groups = new Map<string, CaptureRequest[]>()

  for (const req of requests) {
    const key = generateMatchKey(req)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(req)
  }

  return groups
}

/**
 * 获取分组的显示信息
 * @param matchKey 匹配键
 * @returns 可读的接口信息
 */
export function parseMatchKey(matchKey: string): { method: string; path: string; query: string } {
  const parts = matchKey.split(':')
  return {
    method: parts[0] || 'GET',
    path: parts[1] || '/',
    query: parts[2] || '',
  }
}

/**
 * 查找可对比的请求对
 * 在分组中找到恰好来自两个不同设备的请求
 * @param requests 请求列表
 * @returns 可对比的请求对列表
 */
export function findComparablePairs(requests: CaptureRequest[]): Array<{
  matchKey: string
  requestA: CaptureRequest
  requestB: CaptureRequest
}> {
  const groups = groupByMatchKey(requests)
  const pairs: Array<{
    matchKey: string
    requestA: CaptureRequest
    requestB: CaptureRequest
  }> = []

  for (const [matchKey, group] of groups) {
    // 按设备 IP 分组
    const deviceGroups = new Map<string, CaptureRequest[]>()
    for (const req of group) {
      if (!deviceGroups.has(req.clientIp)) {
        deviceGroups.set(req.clientIp, [])
      }
      deviceGroups.get(req.clientIp)!.push(req)
    }

    // 需要恰好两个不同设备
    const deviceIps = Array.from(deviceGroups.keys())
    if (deviceIps.length >= 2) {
      // 取每个设备最新的请求
      const reqA = deviceGroups.get(deviceIps[0])![0]
      const reqB = deviceGroups.get(deviceIps[1])![0]
      pairs.push({ matchKey, requestA: reqA, requestB: reqB })
    }
  }

  return pairs
}
