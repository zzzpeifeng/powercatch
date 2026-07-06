// @vitest-environment jsdom
/**
 * settings-store 模板库单元测试
 *
 * 覆盖：
 *   1. selectTemplate 同步 aiPromptTemplate 为选中模板内容
 *   2. saveCustomTemplate 加入库并选中、持久化（仅存自定义）
 *   3. deleteTemplate 对内置无效、对自定义移除且选中回退 builtin-v1
 *   4. resetTemplates 恢复仅内置
 *   5. loadSettings 从 storage 恢复（自定义 JSON + selected id）
 *   6. commitEditorToSelected 内置克隆为自定义 / 自定义直接更新
 *
 * 注意：loadSettings 内部调用 applyTheme()，依赖 window.matchMedia / document，
 * 因此本文件运行在 jsdom 环境，并对 window.matchMedia 补 stub。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../settings-store'
import { BUILTIN_PROMPT_TEMPLATES, DEFAULT_PROMPT_V1, DEFAULT_PROMPT_V2 } from '../../services/types'

// ===== mock ipc =====
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

// jsdom 未实现 matchMedia，applyTheme 会用到，补一个 stub
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

describe('settings-store 模板库', () => {
  it('1. selectTemplate：同步 aiPromptTemplate 为选中模板内容', () => {
    store.selectTemplate('builtin-v2')
    expect(store.selectedTemplateId).toBe('builtin-v2')
    expect(store.aiPromptTemplate).toBe(DEFAULT_PROMPT_V2)
    // 持久化选中 id
    expect(mockSettings.set).toHaveBeenCalledWith('selected_template_id', 'builtin-v2')
  })

  it('2. saveCustomTemplate：加入库并选中、持久化（仅存自定义）', () => {
    const id = store.saveCustomTemplate({ name: 'My Tpl', content: 'hello world' })
    expect(id).toMatch(/^custom-/)
    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length + 1)
    expect(store.selectedTemplateId).toBe(id)
    const created = store.promptTemplates.find((t) => t.id === id)
    expect(created).toBeTruthy()
    expect(created!.content).toBe('hello world')
    expect(created!.builtin).toBe(false)
    expect(store.aiPromptTemplate).toBe('hello world')

    // persistTemplates 仅存储自定义部分
    const call = mockSettings.set.mock.calls.find((c) => c[0] === 'prompt_templates')
    expect(call).toBeTruthy()
    const parsed = JSON.parse(String(call![1])) as unknown[]
    expect(parsed).toHaveLength(1)
    expect((parsed[0] as { id: string }).id).toBe(id)
  })

  it('3. deleteTemplate：内置无效；自定义移除且选中回退 builtin-v1', () => {
    // 内置不可删
    store.deleteTemplate('builtin-v1')
    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length)

    // 自定义：删除后数量恢复、选中回退
    const id = store.saveCustomTemplate({ name: 'X', content: 'Y' })
    store.deleteTemplate(id)
    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length)
    expect(store.selectedTemplateId).toBe('builtin-v1')
    expect(store.aiPromptTemplate).toBe(DEFAULT_PROMPT_V1)
  })

  it('4. resetTemplates：恢复仅内置', () => {
    store.saveCustomTemplate({ name: 'X', content: 'Y' })
    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length + 1)
    store.resetTemplates()
    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length)
    expect(store.promptTemplates.every((t) => t.builtin)).toBe(true)
    expect(store.selectedTemplateId).toBe('builtin-v1')
    expect(store.aiPromptTemplate).toBe(DEFAULT_PROMPT_V1)
  })

  it('5. loadSettings：从 storage 恢复自定义与选中 id', async () => {
    mockSettings.getAll.mockResolvedValue({
      aiPromptTemplate: 'legacy content',
      theme: 'system',
    } as never)
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'selected_template_id') return Promise.resolve('builtin-v2')
      if (key === 'prompt_templates') {
        return Promise.resolve(
          JSON.stringify([{ id: 'custom-9', name: 'Stored', content: 'stored content', builtin: false }]),
        )
      }
      return Promise.resolve(null)
    })

    await store.loadSettings()

    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length + 1)
    expect(store.promptTemplates.find((t) => t.id === 'custom-9')).toBeTruthy()
    expect(store.selectedTemplateId).toBe('builtin-v2')
    // 选中模板内容覆盖旧安装的 legacy content
    expect(store.aiPromptTemplate).toBe(DEFAULT_PROMPT_V2)
  })

  it('6. commitEditorToSelected：内置克隆为自定义副本 / 自定义直接更新', () => {
    // 当前选中内置 -> 自动克隆
    store.selectTemplate('builtin-v1')
    store.commitEditorToSelected('edited content')
    expect(store.selectedTemplateId).not.toBe('builtin-v1')
    const cloned = store.promptTemplates.find((t) => t.id === store.selectedTemplateId)
    expect(cloned).toBeTruthy()
    expect(cloned!.builtin).toBe(false)
    expect(cloned!.name).toBe('详细版 (V1) (副本)')
    expect(cloned!.content).toBe('edited content')
    expect(store.aiPromptTemplate).toBe('edited content')

    // 当前选中自定义 -> 直接更新 content
    const id = store.saveCustomTemplate({ name: 'Orig', content: 'orig' })
    store.commitEditorToSelected('updated')
    const updated = store.promptTemplates.find((t) => t.id === id)
    expect(updated!.content).toBe('updated')
    expect(store.aiPromptTemplate).toBe('updated')
  })
})
