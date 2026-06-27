/**
 * DNS 覆盖域名匹配引擎
 * 支持精确匹配和通配符匹配（如 *.example.com）
 */
import type { DnsOverrideRule } from '../services/types'

/**
 * 在多个 DNS 覆盖规则中查找第一个匹配的规则
 * @param hostname 请求的域名
 * @param rules DNS 覆盖规则列表（仅启用的）
 * @returns 匹配的规则，或 null
 */
export function matchDnsOverride(
  hostname: string,
  rules: DnsOverrideRule[]
): DnsOverrideRule | null {
  const host = hostname.toLowerCase()
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchDomain(host, rule.domain)) return rule
  }
  return null
}

/**
 * 域名匹配逻辑
 * 支持精确匹配和 * 通配符匹配
 * - example.com 精确匹配 example.com
 * - *.example.com 匹配 sub.example.com、a.b.example.com
 * - example.com 不匹配 sub.example.com（子域名不自动匹配）
 */
function matchDomain(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase()

  // 精确匹配
  if (host === p) return true

  // 通配符匹配
  if (p.includes('*')) {
    const regexPattern = p
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^.]*')
    return new RegExp(`^${regexPattern}$`, 'i').test(host)
  }

  return false
}
