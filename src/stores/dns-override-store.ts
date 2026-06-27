/**
 * DNS 覆盖规则状态管理
 * 管理 DNS 覆盖规则的增删改查和持久化
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DnsOverrideRule } from '../services/types'
import { ipc } from '../services/ipc'

/** 最大规则数 */
const MAX_RULES = 50

export const useDnsOverrideStore = defineStore('dns-override', () => {
  // ===== State =====

  /** DNS 覆盖规则列表 */
  const rules = ref<DnsOverrideRule[]>([])

  /** 是否已加载 */
  const loaded = ref<boolean>(false)

  // ===== Getters =====

  /** 启用的规则数量 */
  const enabledRulesCount = computed(() => rules.value.filter(r => r.enabled).length)

  // ===== Actions =====

  /** 加载规则 */
  async function loadRules(): Promise<void> {
    try {
      const settings = await ipc.settings.getAll()
      if (settings?.dnsOverrideRules) {
        rules.value = settings.dnsOverrideRules
      }
      loaded.value = true
    } catch (error) {
      console.error('Failed to load DNS override rules:', error)
    }
  }

  /** 保存规则到持久化存储 */
  async function saveRules(): Promise<void> {
    try {
      await ipc.settings.saveAll({ dnsOverrideRules: rules.value })
      // 同步到主进程 proxy 层（仅同步启用的规则）
      await ipc.dnsOverride.syncRules(rules.value.filter(r => r.enabled))
    } catch (error) {
      console.error('Failed to save DNS override rules:', error)
    }
  }

  /** 验证规则 */
  function validateRule(rule: { domain?: string; ip?: string }): string[] {
    const errors: string[] = []

    if (!rule.domain?.trim()) {
      errors.push('域名不能为空')
    }

    if (!rule.ip?.trim()) {
      errors.push('IP 地址不能为空')
    } else if (!isValidIp(rule.ip.trim())) {
      errors.push('IP 地址格式不正确')
    }

    return errors
  }

  /** 验证 IP 地址格式 */
  function isValidIp(ip: string): boolean {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
    if (ipv4Regex.test(ip)) {
      return ip.split('.').every(part => {
        const num = parseInt(part, 10)
        return num >= 0 && num <= 255
      })
    }
    // IPv6（简化验证）
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
    return ipv6Regex.test(ip)
  }

  /** 添加规则 */
  async function addRule(rule: Omit<DnsOverrideRule, 'id' | 'createdAt'>): Promise<{
    success: boolean
    rule?: DnsOverrideRule
    errors: string[]
  }> {
    const errors = validateRule(rule)
    if (errors.length > 0) {
      return { success: false, errors }
    }

    if (rules.value.length >= MAX_RULES) {
      return { success: false, errors: ['DNS 覆盖规则最多 50 条'] }
    }

    const newRule: DnsOverrideRule = {
      ...rule,
      id: `dns_override_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    }

    rules.value.push(newRule)
    await saveRules()
    return { success: true, rule: newRule, errors: [] }
  }

  /** 删除规则 */
  async function removeRule(ruleId: string): Promise<void> {
    rules.value = rules.value.filter(r => r.id !== ruleId)
    await saveRules()
  }

  /** 更新规则 */
  async function updateRule(ruleId: string, updates: Partial<DnsOverrideRule>): Promise<{
    success: boolean
    errors: string[]
  }> {
    const index = rules.value.findIndex(r => r.id === ruleId)
    if (index === -1) {
      return { success: false, errors: ['规则不存在'] }
    }

    const updatedRule = { ...rules.value[index], ...updates }
    const errors = validateRule(updatedRule)
    if (errors.length > 0) {
      return { success: false, errors }
    }

    rules.value[index] = updatedRule
    await saveRules()
    return { success: true, errors: [] }
  }

  /** 切换规则启用状态 */
  async function toggleRule(ruleId: string): Promise<void> {
    const rule = rules.value.find(r => r.id === ruleId)
    if (rule) {
      rule.enabled = !rule.enabled
      await saveRules()
    }
  }

  /** 全部启用 */
  async function enableAllRules(): Promise<void> {
    rules.value.forEach(r => r.enabled = true)
    await saveRules()
  }

  /** 全部禁用 */
  async function disableAllRules(): Promise<void> {
    rules.value.forEach(r => r.enabled = false)
    await saveRules()
  }

  /** 清空所有规则 */
  async function clearAllRules(): Promise<void> {
    rules.value = []
    await saveRules()
  }

  return {
    // State
    rules,
    loaded,
    // Getters
    enabledRulesCount,
    // Actions
    loadRules,
    saveRules,
    addRule,
    removeRule,
    updateRule,
    toggleRule,
    enableAllRules,
    disableAllRules,
    clearAllRules,
  }
})
