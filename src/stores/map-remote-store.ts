/**
 * Map Remote 规则状态管理
 * 管理远程映射规则的增删改查和持久化
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { MapRemoteRule, HttpMethod } from '../services/types'
import { ipc } from '../services/ipc'

/** 最大规则数 */
const MAX_RULES = 50

export const useMapRemoteStore = defineStore('map-remote', () => {
  // ===== State =====

  /** Map Remote 规则列表 */
  const rules = ref<MapRemoteRule[]>([])

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
      if (settings?.mapRemoteRules) {
        rules.value = settings.mapRemoteRules
      }
      loaded.value = true
    } catch (error) {
      console.error('Failed to load map remote rules:', error)
    }
  }

  /** 保存规则到持久化存储 */
  async function saveRules(): Promise<void> {
    try {
      await ipc.settings.saveAll({ mapRemoteRules: rules.value })
      // 同步到主进程 proxy 层（仅同步启用的规则）
      await ipc.mapRemote.syncRules(rules.value.filter(r => r.enabled))
    } catch (error) {
      console.error('Failed to save map remote rules:', error)
    }
  }

  /** 验证规则 */
  function validateRule(rule: {
    name?: string
    match?: { urlPattern?: string }
    target?: { protocol?: string; host?: string }
  }): string[] {
    const errors: string[] = []

    if (!rule.name?.trim()) {
      errors.push('规则名称不能为空')
    }

    if (!rule.match?.urlPattern?.trim()) {
      errors.push('URL 匹配模式不能为空')
    }

    if (rule.match?.urlPattern?.trim() === '*') {
      errors.push('URL 匹配模式不能仅为 *，这会映射所有流量。请添加更多限定条件。')
    }

    if (!rule.target?.host?.trim()) {
      errors.push('目标主机不能为空')
    }

    if (rule.target?.protocol && !['http', 'https'].includes(rule.target.protocol)) {
      errors.push('目标协议必须是 http 或 https')
    }

    return errors
  }

  /** 添加规则 */
  async function addRule(rule: Omit<MapRemoteRule, 'id' | 'createdAt'>): Promise<{
    success: boolean
    rule?: MapRemoteRule
    errors: string[]
  }> {
    const errors = validateRule(rule)
    if (errors.length > 0) {
      return { success: false, errors }
    }

    if (rules.value.length >= MAX_RULES) {
      return { success: false, errors: ['Map Remote 规则最多 50 条'] }
    }

    const newRule: MapRemoteRule = {
      ...rule,
      id: `map_remote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
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
  async function updateRule(ruleId: string, updates: Partial<MapRemoteRule>): Promise<{
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
