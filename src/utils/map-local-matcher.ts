/**
 * Map Local URL 匹配引擎
 * 复用 breakpoint-matcher 的匹配逻辑
 */
import { matchBreakpoint } from './breakpoint-matcher'
import type { MapLocalRule, HttpMethod } from '../services/types'

/**
 * 在多个 Map Local 规则中查找第一个匹配的规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules Map Local 规则列表
 * @returns 匹配的规则，或 null
 */
export function matchMapLocal(
  url: string,
  method: HttpMethod,
  rules: MapLocalRule[]
): MapLocalRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchBreakpoint(url, method, rule as any)) return rule
  }
  return null
}
