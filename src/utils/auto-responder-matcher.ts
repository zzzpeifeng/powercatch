/**
 * 自动响应器 URL 匹配引擎
 * 复用 breakpoint-matcher 的匹配逻辑
 */
import { matchBreakpoint } from './breakpoint-matcher'
import type { AutoResponderRule, HttpMethod } from '../services/types'

/**
 * 在多个自动响应器规则中查找第一个匹配的规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules 自动响应器规则列表
 * @returns 匹配的规则，或 null
 */
export function matchAutoResponder(
  url: string,
  method: HttpMethod,
  rules: AutoResponderRule[]
): AutoResponderRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    // 复用 breakpoint-matcher 的匹配逻辑
    // AutoResponderRule 和 BreakpointRule 都有 match.urlPattern 和 match.methods
    if (matchBreakpoint(url, method, rule as any)) return rule
  }
  return null
}
