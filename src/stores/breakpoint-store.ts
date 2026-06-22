/**
 * 断点状态管理
 * 管理断点规则和拦截会话
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BreakpointRule, InterceptSession, HttpMethod, CaptureRequest } from '../services/types'
import { ipc } from '../services/ipc'
import { generatePatternFromUrl, validateRule } from '../utils/breakpoint-matcher'

/** 最大队列数 */
const MAX_QUEUE_SIZE = 20

/** 最大规则数 */
const MAX_RULES = 50

export const useBreakpointStore = defineStore('breakpoint', () => {
  // ===== State =====

  /** 断点规则列表 */
  const rules = ref<BreakpointRule[]>([])

  /** 活跃的拦截会话队列（FIFO） */
  const activeSessions = ref<InterceptSession[]>([])

  /** 当前显示的会话索引 */
  const currentSessionIndex = ref<number>(0)

  /** 是否已加载 */
  const loaded = ref<boolean>(false)

  // ===== Getters =====

  /** 启用的规则数量 */
  const enabledRulesCount = computed(() => rules.value.filter(r => r.enabled).length)

  /** 当前会话 */
  const currentSession = computed(() => activeSessions.value[currentSessionIndex.value] || null)

  /** 是否有等待中的会话 */
  const hasPendingSessions = computed(() => activeSessions.value.some(s => s.status === 'waiting'))

  /** 等待中的会话数量 */
  const pendingSessionsCount = computed(() => activeSessions.value.filter(s => s.status === 'waiting').length)

  // ===== Actions =====

  /** 加载断点规则 */
  async function loadRules(): Promise<void> {
    try {
      const settings = await ipc.settings.getAll()
      if (settings?.breakpointRules) {
        rules.value = settings.breakpointRules
      }
      loaded.value = true
    } catch (error) {
      console.error('Failed to load breakpoint rules:', error)
    }
  }

  /** 保存断点规则到持久化存储 */
  async function saveRules(): Promise<void> {
    try {
      await ipc.settings.saveAll({ breakpointRules: rules.value })
      // 同步到主进程 proxy 层
      await ipc.breakpoint.syncRules(rules.value)
    } catch (error) {
      console.error('Failed to save breakpoint rules:', error)
    }
  }

  /** 添加断点规则 */
  async function addRule(rule: Omit<BreakpointRule, 'id' | 'createdAt'>): Promise<{ success: boolean; errors: string[] }> {
    // 验证规则
    const errors = validateRule(rule)
    if (errors.length > 0) {
      return { success: false, errors }
    }

    // 检查规则数量限制
    if (rules.value.length >= MAX_RULES) {
      return { success: false, errors: ['断点规则最多 50 条'] }
    }

    const newRule: BreakpointRule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    }

    rules.value.push(newRule)
    await saveRules()
    return { success: true, errors: [] }
  }

  /** 删除断点规则 */
  async function removeRule(ruleId: string): Promise<void> {
    rules.value = rules.value.filter(r => r.id !== ruleId)
    await saveRules()
  }

  /** 更新断点规则 */
  async function updateRule(ruleId: string, updates: Partial<BreakpointRule>): Promise<{ success: boolean; errors: string[] }> {
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

  /** 从请求快速添加断点规则 */
  async function addBreakpointFromRequest(
    request: CaptureRequest,
    stage: 'request' | 'response' | 'both'
  ): Promise<{ success: boolean; errors: string[] }> {
    const pattern = generatePatternFromUrl(request.url)
    const ruleName = `断点 - ${request.method} ${request.path}`

    return addRule({
      name: ruleName,
      enabled: true,
      match: {
        urlPattern: pattern,
        methods: [request.method],
      },
      stage,
    })
  }

  /** 添加拦截会话 */
  function addSession(session: InterceptSession): void {
    // 检查队列大小限制
    if (activeSessions.value.length >= MAX_QUEUE_SIZE) {
      console.warn('[Breakpoint] 拦截队列已满，自动放行')
      return
    }

    activeSessions.value.push(session)

    // 如果是第一个会话，自动设为当前
    if (activeSessions.value.length === 1) {
      currentSessionIndex.value = 0
    }
  }

  /** 恢复会话（放行） */
  function resumeSession(sessionId: string, modified?: InterceptSession['editable']): void {
    const session = activeSessions.value.find(s => s.id === sessionId)
    if (session) {
      session.status = 'resumed'
      if (modified) {
        session.editable = modified
      }
      // 从队列中移除
      removeSession(sessionId)
    }
  }

  /** 中止会话（丢弃） */
  function abortSession(sessionId: string): void {
    const session = activeSessions.value.find(s => s.id === sessionId)
    if (session) {
      session.status = 'aborted'
      // 从队列中移除
      removeSession(sessionId)
    }
  }

  /** 从队列移除会话 */
  function removeSession(sessionId: string): void {
    const index = activeSessions.value.findIndex(s => s.id === sessionId)
    if (index !== -1) {
      activeSessions.value.splice(index, 1)
      // 调整当前索引
      if (currentSessionIndex.value >= activeSessions.value.length) {
        currentSessionIndex.value = Math.max(0, activeSessions.value.length - 1)
      }
    }
  }

  /** 恢复原始数据 */
  function restoreOriginal(sessionId: string): void {
    const session = activeSessions.value.find(s => s.id === sessionId)
    if (session) {
      session.editable = { ...session.original }
    }
  }

  /** 跳过当前会话（直接放行，不编辑） */
  function skipCurrentSession(): void {
    if (currentSession.value) {
      resumeSession(currentSession.value.id)
    }
  }

  /** 清空所有会话 */
  function clearAllSessions(): void {
    activeSessions.value = []
    currentSessionIndex.value = 0
  }

  return {
    // State
    rules,
    activeSessions,
    currentSessionIndex,
    loaded,
    // Getters
    enabledRulesCount,
    currentSession,
    hasPendingSessions,
    pendingSessionsCount,
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
    addBreakpointFromRequest,
    addSession,
    resumeSession,
    abortSession,
    removeSession,
    restoreOriginal,
    skipCurrentSession,
    clearAllSessions,
  }
})
