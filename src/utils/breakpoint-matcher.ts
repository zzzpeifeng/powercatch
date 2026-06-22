/**
 * 断点匹配引擎
 * 用于检查请求是否匹配断点规则
 */
import type { BreakpointRule, HttpMethod } from '../services/types'

/**
 * 检查请求是否匹配断点规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rule 断点规则
 * @returns 是否匹配
 */
export function matchBreakpoint(url: string, method: HttpMethod, rule: BreakpointRule): boolean {
  // 规则未启用则跳过
  if (!rule.enabled) return false

  // 方法过滤
  if (rule.match.methods.length > 0 && !rule.match.methods.includes(method)) {
    return false
  }

  // URL 匹配
  const pattern = rule.match.urlPattern
  if (!pattern) return false

  try {
    // 解析 URL，提取 host + pathname（不含 query string）
    const parsed = new URL(url)
    const target = `${parsed.host}${parsed.pathname}`

    // 将通配符模式转换为正则表达式
    // 1. 转义正则特殊字符（保留 *）
    // 2. 将 * 转换为 .*
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    // 使用 includes 语义（不加 ^ $），这样 *api.shopline.com* 可以匹配子串
    return new RegExp(regexPattern, 'i').test(target)
  } catch {
    // URL 解析失败，尝试直接匹配原始 URL
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    return new RegExp(regexPattern, 'i').test(url)
  }
}

/**
 * 从请求 URL 生成断点匹配模式
 * @param url 请求 URL
 * @returns 匹配模式（如 *api.shopline.com/v1/products*）
 */
export function generatePatternFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // 使用 host + pathname，不含 query string，两端加通配符
    return `*${parsed.host}${parsed.pathname}*`
  } catch {
    // URL 解析失败，直接用原始 URL
    return `*${url}*`
  }
}

/**
 * 验证断点规则
 * @param rule 规则（部分字段）
 * @returns 错误信息数组，空数组表示验证通过
 */
export function validateRule(rule: Partial<BreakpointRule>): string[] {
  const errors: string[] = []

  if (!rule.match?.urlPattern?.trim()) {
    errors.push('URL 匹配模式不能为空')
  }

  if (rule.match?.urlPattern?.trim() === '*') {
    errors.push('URL 匹配模式不能为 *（会拦截所有流量）')
  }

  if (!rule.name?.trim()) {
    errors.push('规则名称不能为空')
  }

  if (!rule.stage) {
    errors.push('拦截阶段不能为空')
  }

  return errors
}

/**
 * 在多个规则中查找第一个匹配的规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules 断点规则列表
 * @returns 匹配的规则，或 null
 */
export function findMatchingRule(
  url: string,
  method: HttpMethod,
  rules: BreakpointRule[]
): BreakpointRule | null {
  for (const rule of rules) {
    if (matchBreakpoint(url, method, rule)) {
      return rule
    }
  }
  return null
}
