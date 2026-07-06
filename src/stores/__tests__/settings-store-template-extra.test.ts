// @vitest-environment jsdom
/**
 * 补充测试：settings-store 模板库的「防御性分支」覆盖。
 *
 * 工程师的 settings-store-template.test.ts 已覆盖：
 *   - selectTemplate 同步 aiPromptTemplate + 持久化选中 id
 *   - saveCustomTemplate 加入库/选中/仅存自定义 + id 为 custom- 前缀
 *   - deleteTemplate / resetTemplates / loadSettings / commitEditorToSelected
 *
 * 本文件仅补充两个被遗漏的防御分支（不改动工程师原测试）：
 *   A. selectTemplate 对「不存在的 id」应直接 return，不抛错、状态不变
 *   B. updateCustomTemplate 对「内置 id」应直接 return，内置模板内容不被篡改
 *
 * 复用与 settings-store-template.test.ts 一致的 ipc mock + matchMedia stub。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../settings-store'

const { mockSettings, mockThrottle } = vi.hoisted(() => ({
  mockSettings: {
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(),
    saveAll: vi.fn(),
  },
  mockThrottle: { setConfig: vi.fn() },
}))

vi.mock('../../services/ipc', () => ({
  ipc: {
    settings: mockSettings,
    throttle: mockThrottle,
  },
}))

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

let store: ReturnType<typeof useSettingsStore>

beforeEach(() => {
  setActivePinia(createPinia())
  store = useSettingsStore()
  vi.clearAllMocks()
  mockSettings.get.mockResolvedValue(null)
  mockSettings.set.mockResolvedValue(true)
  mockSettings.getAll.mockResolvedValue(null)
  mockSettings.saveAll.mockResolvedValue(true)
  mockThrottle.setConfig.mockResolvedValue(undefined)
})

describe('settings-store 模板库（防御分支补充）', () => {
  it('A. selectTemplate 对不存在的 id：直接 return，不抛错、selectedTemplateId 与 aiPromptTemplate 不变', () => {
    const beforeId = store.selectedTemplateId
    const beforeTemplate = store.aiPromptTemplate

    expect(() => store.selectTemplate('definitely-not-exist')).not.toThrow()
    expect(store.selectedTemplateId).toBe(beforeId)
    expect(store.aiPromptTemplate).toBe(beforeTemplate)

    // 不应触发对新（非法）id 的持久化
    expect(mockSettings.set).not.toHaveBeenCalledWith('selected_template_id', 'definitely-not-exist')
  })

  it('B. updateCustomTemplate 对内置 id：直接 return，内置模板 name/content/builtin 均不被修改', () => {
    const v1 = store.promptTemplates.find((t) => t.id === 'builtin-v1')!
    expect(v1.builtin).toBe(true)
    const originalName = v1.name
    const originalContent = v1.content

    expect(() => store.updateCustomTemplate('builtin-v1', { name: 'hacked', content: 'hacked' })).not.toThrow()

    const after = store.promptTemplates.find((t) => t.id === 'builtin-v1')!
    expect(after.name).toBe(originalName)
    expect(after.content).toBe(originalContent)
    expect(after.builtin).toBe(true)

    // 内置不可改，故不应触发 prompt_templates 的持久化写入
    expect(mockSettings.set).not.toHaveBeenCalledWith('prompt_templates', expect.any(String))
  })
})
