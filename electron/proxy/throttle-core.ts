/**
 * 带宽限流（网络节流）核心纯函数
 * 不依赖 electron，便于单元测试。
 */

import type { ThrottleConfig } from '../../src/services/types'

/**
 * 域名匹配逻辑（OR 匹配，支持 * 通配符 glob 风格）
 * 与 src/stores/request-store.ts 中的 filteredRequests 逻辑保持一致
 * @param host 请求域名（可带端口）
 * @param filters 过滤规则列表（空数组表示匹配所有）
 */
export function matchDomain(host: string, filters: string[]): boolean {
  if (filters.length === 0) return true // 无过滤器时匹配所有

  return filters.some((filter) => {
    // 通配符匹配：支持 * 作为任意字符通配符
    if (filter.includes('*')) {
      const pattern = filter
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符（保留 *）
        .replace(/\*/g, '.*')                   // * → 匹配任意字符
      return new RegExp(`^${pattern}$`, 'i').test(host)
    }
    // 精确匹配
    return host === filter
  })
}

/**
 * 检查是否对指定请求启用节流
 * @param host 请求域名
 * @param config 节流配置
 * @returns 是否启用节流
 */
export function shouldThrottle(host: string, config: ThrottleConfig): boolean {
  if (!config.enabled) return false
  if (config.domainFilter.length === 0) return true
  return matchDomain(host, config.domainFilter)
}

/**
 * 应用请求延迟（上行）
 * 延迟通过可注入的 scheduler 执行，便于测试使用假定时器。
 * @param cb 延迟结束后回调（即继续请求转发）
 * @param config 节流配置
 * @param scheduler 调度器（默认 setTimeout），测试可注入
 */
export function applyRequestDelay(
  cb: () => void,
  config: ThrottleConfig,
  scheduler: (fn: () => void, ms: number) => void = setTimeout,
): void {
  const delay = config.requestDelay
  if (delay <= 0) return cb()
  scheduler(cb, delay)
}

/**
 * 应用响应延迟（下行）
 * @param cb 延迟结束后回调（即继续响应回传）
 * @param config 节流配置
 * @param scheduler 调度器（默认 setTimeout），测试可注入
 */
export function applyResponseDelay(
  cb: () => void,
  config: ThrottleConfig,
  scheduler: (fn: () => void, ms: number) => void = setTimeout,
): void {
  const delay = config.responseDelay
  if (delay <= 0) return cb()
  scheduler(cb, delay)
}
