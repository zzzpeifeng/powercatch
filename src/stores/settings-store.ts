/**
 * 设置状态管理
 */
import { defineStore } from 'pinia'
import { ref, toRaw, watch } from 'vue'
import type { AppSettings, ThrottleConfig, PromptTemplate } from '../services/types'
import { DEFAULT_PROMPT_V1, DEFAULT_PROMPT_V2, THROTTLE_PRESETS, BUILTIN_PROMPT_TEMPLATES } from '../services/types'
import { ipc } from '../services/ipc'
import { useDebounce } from '../composables/useDebounce'

export const useSettingsStore = defineStore('settings', () => {
  // ===== State =====

  /** API 地址 */
  const apiUrl = ref<string>('https://api.openai.com/v1')

  /** API Key */
  const apiKey = ref<string>('')

  /** 模型名称 */
  const modelName = ref<string>('gpt-4o')

  /** 代理端口 */
  const proxyPort = ref<number>(8888)

  /** 设备别名 */
  const deviceAliases = ref<Record<string, string>>({})

  /** AI Prompt 模板 */
  const aiPromptTemplate = ref<string>(DEFAULT_PROMPT_V1)

  /** 当前选择的模板版本 */
  const promptVersion = ref<'v1' | 'v2'>('v1')

  /** AI 对比 Prompt 模板库（内置 + 自定义） */
  const promptTemplates = ref<PromptTemplate[]>(BUILTIN_PROMPT_TEMPLATES)

  /** 当前选中的模板 id（内置为 'builtin-v1'/'builtin-v2'，自定义为随机串） */
  const selectedTemplateId = ref<string>('builtin-v1')

  /** 域名过滤器 */
  const domainFilters = ref<string[]>([])

  /** 本机 IP */
  const localIp = ref<string>('127.0.0.1')

  /** CA 证书是否已生成 */
  const caCertGenerated = ref<boolean>(false)

  /** 主题设置：'light' | 'dark' | 'system' */
  const theme = ref<'light' | 'dark' | 'system'>('system')

  // ===== 带宽限流（网络节流）状态 =====
  /** 是否启用节流 */
  const throttleEnabled = ref<boolean>(false)
  /** 当前预设：off / 3g / 4g / 5g / slow / offline / custom */
  const throttlePreset = ref<string>('off')
  /** 请求延迟（上行，毫秒） */
  const throttleRequestDelay = ref<number>(0)
  /** 响应延迟（下行，毫秒） */
  const throttleResponseDelay = ref<number>(0)
  /** 域名过滤（空 = 全部） */
  const throttleDomainFilter = ref<string[]>([])
  /** 离线模式（返回 503） */
  const throttleOfflineMode = ref<boolean>(false)

  /** 是否已加载 */
  const loaded = ref<boolean>(false)

  // ===== 自动保存：关键配置变更时触发防抖保存 =====
  watch(apiUrl, () => {
    if (loaded.value) debouncedSave()
  })
  watch(apiKey, () => {
    if (loaded.value) debouncedSave()
  })
  watch(modelName, () => {
    if (loaded.value) debouncedSave()
  })
  watch(proxyPort, () => {
    if (loaded.value) debouncedSave()
  })
  watch(aiPromptTemplate, () => {
    if (loaded.value) debouncedSave()
  })
  watch(theme, () => {
    if (loaded.value) debouncedSave()
  })

  // 带宽限流：任一节流配置变更时，防抖推送到代理并持久化
  watch(
    [throttleEnabled, throttlePreset, throttleRequestDelay, throttleResponseDelay, throttleDomainFilter, throttleOfflineMode],
    () => {
      if (loaded.value) updateThrottleConfig()
    },
    { deep: true },
  )

  // ===== Actions =====

  /** 加载所有设置 */
  async function loadSettings(): Promise<void> {
    try {
      const settings = await ipc.settings.getAll()
      if (settings) {
        apiUrl.value = settings.apiUrl
        apiKey.value = settings.apiKey
        modelName.value = settings.modelName
        proxyPort.value = settings.proxyPort
        deviceAliases.value = settings.deviceAliases
        aiPromptTemplate.value = settings.aiPromptTemplate || DEFAULT_PROMPT_V1
        domainFilters.value = settings.domainFilters
        localIp.value = settings.localIp
        caCertGenerated.value = settings.caCertGenerated
        // 加载主题设置，默认为 'system'
        theme.value = settings.theme || 'system'
        // 立即应用主题（无需刷新）
        applyTheme()

        // 加载带宽限流配置（独立 key，避免改动 AppSettings schema）
        try {
          const raw = await ipc.settings.get('throttle_config')
          if (raw) {
            const t = JSON.parse(raw) as ThrottleConfig
            throttleEnabled.value = t.enabled
            throttlePreset.value = t.preset
            throttleRequestDelay.value = t.requestDelay
            throttleResponseDelay.value = t.responseDelay
            throttleDomainFilter.value = t.domainFilter || []
            throttleOfflineMode.value = t.offlineMode || false
          }
        } catch (e) {
          console.error('Failed to load throttle config:', e)
        }

        // 加载 AI 对比模板库（独立 key，避免改动 AppSettings schema）
        try {
          const storedId = await ipc.settings.get('selected_template_id')
          const rawTpl = await ipc.settings.get('prompt_templates')
          if (rawTpl) {
            const custom = JSON.parse(rawTpl) as PromptTemplate[]
            promptTemplates.value = [...BUILTIN_PROMPT_TEMPLATES, ...custom.filter((t) => !t.builtin)]
          }
          selectedTemplateId.value =
            storedId && promptTemplates.value.some((t) => t.id === storedId) ? storedId : 'builtin-v1'
          syncActiveFromSelected()
        } catch (e) {
          console.error('Failed to load prompt templates:', e)
        }
      }
      loaded.value = true

      // 将已加载的节流配置推送到代理，确保代理启动即生效
      try {
        await updateThrottleConfig()
      } catch (e) {
        console.error('Failed to sync throttle config to proxy:', e)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  /** 保存所有设置 */
  async function saveSettings(): Promise<void> {
    try {
      await ipc.settings.saveAll({
        apiUrl: apiUrl.value,
        apiKey: apiKey.value,
        modelName: modelName.value,
        proxyPort: proxyPort.value,
        deviceAliases: toRaw(deviceAliases.value),
        aiPromptTemplate: aiPromptTemplate.value,
        domainFilters: toRaw(domainFilters.value),
        localIp: localIp.value,
        caCertGenerated: caCertGenerated.value,
        theme: theme.value,
      })
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  /** 防抖保存 */
  const debouncedSave = useDebounce(saveSettings, 500)

  // ===== 带宽限流（网络节流）=====

  /** 构造纯 ThrottleConfig 对象 */
  function buildThrottleConfig(): ThrottleConfig {
    return {
      enabled: throttleEnabled.value,
      preset: throttlePreset.value as ThrottleConfig['preset'],
      requestDelay: throttleRequestDelay.value,
      responseDelay: throttleResponseDelay.value,
      domainFilter: toRaw(throttleDomainFilter.value),
      offlineMode: throttleOfflineMode.value,
    }
  }

  /**
   * 推送节流配置到代理（实时生效）并持久化到独立 setting key
   */
  async function updateThrottleConfig(): Promise<void> {
    const config = buildThrottleConfig()
    try {
      await ipc.throttle.setConfig(config)
    } catch (e) {
      console.error('Failed to push throttle config:', e)
    }
    try {
      await ipc.settings.set('throttle_config', JSON.stringify(config))
    } catch (e) {
      console.error('Failed to persist throttle config:', e)
    }
  }

  /**
   * 应用预设：填充延迟/离线模式并启用节流
   * @param preset 预设 key
   */
  function applyThrottlePreset(preset: string): void {
    const p = THROTTLE_PRESETS[preset]
    if (!p) return
    throttlePreset.value = preset
    if (preset === 'off') {
      throttleEnabled.value = false
      throttleRequestDelay.value = 0
      throttleResponseDelay.value = 0
      throttleOfflineMode.value = false
      return
    }
    throttleEnabled.value = true
    throttleRequestDelay.value = p.requestDelay ?? 0
    throttleResponseDelay.value = p.responseDelay ?? 0
    throttleOfflineMode.value = p.offlineMode ?? false
  }

  /** 保存域名过滤器（防抖） */
  function saveDomainFilters(filters: string[]): void {
    domainFilters.value = filters
    ipc.settings.set('domain_filters', JSON.stringify(filters))
  }

  /** 设置设备别名 */
  async function setDeviceAlias(ip: string, alias: string): Promise<void> {
    deviceAliases.value = { ...deviceAliases.value, [ip]: alias }
    await ipc.device.setAlias(ip, alias)
    debouncedSave()
  }

  /**
   * 核心不变量：将 aiPromptTemplate 同步为「当前选中模板的内容」。
   * 主进程 compare handler 始终读取 settings.aiPromptTemplate，因此只需在此同步。
   */
  function syncActiveFromSelected(): void {
    const tpl = promptTemplates.value.find((t) => t.id === selectedTemplateId.value)
    aiPromptTemplate.value = tpl?.content ?? DEFAULT_PROMPT_V1
  }

  /** 仅持久化自定义模板（内置不重复存储） */
  async function persistTemplates(): Promise<void> {
    try {
      const custom = promptTemplates.value.filter((t) => !t.builtin)
      await ipc.settings.set('prompt_templates', JSON.stringify(custom))
    } catch (e) {
      console.error('Failed to persist prompt templates:', e)
    }
  }

  /** 持久化当前选中模板 id */
  async function persistSelectedId(): Promise<void> {
    try {
      await ipc.settings.set('selected_template_id', selectedTemplateId.value)
    } catch (e) {
      console.error('Failed to persist selected template id:', e)
    }
  }

  /** 选择模板：切换选中并同步 aiPromptTemplate 与持久化 */
  function selectTemplate(id: string): void {
    if (!promptTemplates.value.some((t) => t.id === id)) return
    selectedTemplateId.value = id
    syncActiveFromSelected()
    debouncedSave()
    persistSelectedId()
  }

  /** 新建自定义模板，自动选中并同步，返回新模板 id */
  function saveCustomTemplate(input: { name: string; content: string }): string {
    const id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const tpl: PromptTemplate = {
      id,
      name: input.name || '未命名模板',
      content: input.content,
      builtin: false,
    }
    promptTemplates.value = [...promptTemplates.value, tpl]
    selectedTemplateId.value = id
    syncActiveFromSelected()
    persistTemplates()
    persistSelectedId()
    debouncedSave()
    return id
  }

  /** 更新自定义模板（仅自定义生效） */
  function updateCustomTemplate(id: string, patch: { name?: string; content?: string }): void {
    const idx = promptTemplates.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    if (promptTemplates.value[idx].builtin) return
    const next = [...promptTemplates.value]
    next[idx] = {
      ...next[idx],
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
    }
    promptTemplates.value = next
    const isSelected = selectedTemplateId.value === id
    if (isSelected) syncActiveFromSelected()
    persistTemplates()
    if (isSelected) debouncedSave()
  }

  /** 删除模板：内置不可删；删除当前选中项时回退到 builtin-v1 */
  function deleteTemplate(id: string): void {
    const tpl = promptTemplates.value.find((t) => t.id === id)
    if (!tpl || tpl.builtin) return
    promptTemplates.value = promptTemplates.value.filter((t) => t.id !== id)
    if (selectedTemplateId.value === id) {
      selectedTemplateId.value = 'builtin-v1'
      syncActiveFromSelected()
      debouncedSave()
    }
    persistTemplates()
    persistSelectedId()
  }

  /** 恢复仅内置默认模板 */
  function resetTemplates(): void {
    promptTemplates.value = [...BUILTIN_PROMPT_TEMPLATES]
    selectedTemplateId.value = 'builtin-v1'
    syncActiveFromSelected()
    persistTemplates()
    persistSelectedId()
    debouncedSave()
  }

  /**
   * 将编辑器内容写回模板库（供 SettingsView 保存时调用）。
   * - 当前选中为内置：自动克隆为自定义副本并选中
   * - 当前选中为自定义：直接更新其 content
   */
  function commitEditorToSelected(content: string): void {
    const current = promptTemplates.value.find((t) => t.id === selectedTemplateId.value)
    if (current && current.builtin) {
      const id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      promptTemplates.value = [
        ...promptTemplates.value,
        { id, name: current.name + ' (副本)', content, builtin: false },
      ]
      selectedTemplateId.value = id
      syncActiveFromSelected()
    } else if (current) {
      updateCustomTemplate(current.id, { content })
    }
    persistTemplates()
    persistSelectedId()
    debouncedSave()
  }

  /** 重置 Prompt 为默认模板（委托为选中对应内置模板，保持向后兼容） */
  function resetPrompt(version: 'v1' | 'v2' = 'v1'): void {
    promptVersion.value = version
    selectTemplate(version === 'v1' ? 'builtin-v1' : 'builtin-v2')
  }

  /** 测试 AI 连接 */
  async function testConnection(): Promise<{ success: boolean; message: string }> {
    return await ipc.ai.testConnection(apiUrl.value, apiKey.value, modelName.value)
  }

  /** 生成 CA 证书 */
  async function generateCACert(): Promise<boolean> {
    const result = await ipc.ca.generate()
    if (result.success) {
      caCertGenerated.value = true
      return true
    }
    return false
  }

  /** 获取 CA 证书状态 */
  async function loadCAStatus(): Promise<void> {
    caCertGenerated.value = await ipc.ca.getStatus()
  }

  /** 获取本机 IP */
  async function loadLocalIp(): Promise<void> {
    localIp.value = await ipc.system.getLocalIp()
  }

  /** 应用主题到 DOM */
  function applyTheme(): void {
    const root = document.documentElement
    
    if (theme.value === 'system') {
      // 跟随系统
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.toggle('dark', prefersDark)
      
      // 监听系统主题变化
      const handleSystemThemeChange = (e: MediaQueryListEvent) => {
        if (theme.value === 'system') {
          root.classList.toggle('dark', e.matches)
        }
      }
      
      // 移除旧监听器（如果存在）
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', handleSystemThemeChange)
      // 添加新监听器
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', handleSystemThemeChange)
    } else {
      // 手动设置
      root.classList.toggle('dark', theme.value === 'dark')
    }
  }

  /** 设置主题并应用 */
  function setTheme(newTheme: 'light' | 'dark' | 'system'): void {
    theme.value = newTheme
    applyTheme()
    debouncedSave()
  }

  return {
    // State
    apiUrl,
    apiKey,
    modelName,
    proxyPort,
    deviceAliases,
    aiPromptTemplate,
    promptVersion,
    promptTemplates,
    selectedTemplateId,
    domainFilters,
    localIp,
    caCertGenerated,
    theme,
    loaded,
    // 带宽限流状态
    throttleEnabled,
    throttlePreset,
    throttleRequestDelay,
    throttleResponseDelay,
    throttleDomainFilter,
    throttleOfflineMode,
    // Actions
    loadSettings,
    saveSettings,
    debouncedSave,
    saveDomainFilters,
    setDeviceAlias,
    resetPrompt,
    selectTemplate,
    saveCustomTemplate,
    updateCustomTemplate,
    deleteTemplate,
    resetTemplates,
    commitEditorToSelected,
    testConnection,
    generateCACert,
    loadCAStatus,
    loadLocalIp,
    // 带宽限流 Actions
    updateThrottleConfig,
    applyThrottlePreset,
    // Theme Actions
    applyTheme,
    setTheme,
  }
})
