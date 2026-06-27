/**
 * 请求重写规则 URL 匹配引擎
 * 复用 breakpoint-matcher 的匹配逻辑
 */
import { matchBreakpoint } from './breakpoint-matcher'
import type { RewriteRule, HttpMethod } from '../services/types'

/**
 * 在多个重写规则中查找所有匹配的规则
 * 与 MapLocal/MapRemote/AutoResponder 不同，Rewrite Rules 支持多个规则同时生效
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules 重写规则列表
 * @returns 匹配的规则数组
 */
export function matchRewriteRules(
  url: string,
  method: HttpMethod,
  rules: RewriteRule[]
): RewriteRule[] {
  const matched: RewriteRule[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchBreakpoint(url, method, rule as any)) {
      matched.push(rule)
    }
  }
  return matched
}
