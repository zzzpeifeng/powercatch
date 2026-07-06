// @vitest-environment jsdom
/**
 * settings-store 对比忽略规则单元测试
 *
 * 覆盖：
 *   1. loadSettings：compare_ignore_rules 不存在（空）时，compareIgnoreRules 保持 []
 *   2. loadSettings：compare_ignore_rules 存在（非空）时，正确解析为数组
 *   3. setCompareIgnoreRules：非空规则持久化到 'compare_ignore_rules' key（改动时写回）
 *   4. setCompareIgnoreRules：空数组同样持久化（避免脏数据残留）
 *
 * 说明：loadSettings 内部调用 applyTheme()，依赖 window.matchMedia / document，
 * 因此运行在 jsdom 环境，并对 window.matchMedia 补 stub（同 settings-store-template.test.ts）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../settings-store'

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
  mockSettings.getAll.mockResolvedValue({ theme: 'system' } as never)
  mockSettings.saveAll.mockResolvedValue(true)
  mockThrottle.setConfig.mockResolvedValue(undefined)
})

describe('settings-store 对比忽略规则', () => {
  it('1. loadSettings（空）：key 不存在时 compareIgnoreRules 保持 []', async () => {
    mockSettings.get.mockResolvedValue(null) // 覆盖 selected_template_id / prompt_templates / compare_ignore_rules
    await store.loadSettings()
    expect(store.compareIgnoreRules).toEqual([])
  })

  it('2. loadSettings（非空）：正确解析为规则数组', async () => {
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'compare_ignore_rules') return Promise.resolve(JSON.stringify(['X-Request-Id', 'data.timestamp']))
      return Promise.resolve(null)
    })
    await store.loadSettings()
    expect(store.compareIgnoreRules).toEqual(['X-Request-Id', 'data.timestamp'])
  })

  it('3. setCompareIgnoreRules（非空）：持久化到 compare_ignore_rules key', async () => {
    await store.setCompareIgnoreRules(['X-Request-Id', 'Authorization'])
    expect(store.compareIgnoreRules).toEqual(['X-Request-Id', 'Authorization'])
    expect(mockSettings.set).toHaveBeenCalledWith('compare_ignore_rules', JSON.stringify(['X-Request-Id', 'Authorization']))
  })

  it('4. setCompareIgnoreRules（空数组）：同样持久化（清空残留规则）', async () => {
    await store.setCompareIgnoreRules([])
    expect(store.compareIgnoreRules).toEqual([])
    expect(mockSettings.set).toHaveBeenCalledWith('compare_ignore_rules', '[]')
  })
})

describe('settings-store 内置智能忽略开关', () => {
  it('1. loadSettings（缺省）：key 不存在时 compareUseBuiltinIgnore 默认 true', async () => {
    mockSettings.get.mockResolvedValue(null)
    await store.loadSettings()
    expect(store.compareUseBuiltinIgnore).toBe(true)
  })

  it('2. loadSettings（显式 false）：正确解析为 false', async () => {
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'compare_use_builtin_ignore') return Promise.resolve(JSON.stringify(false))
      return Promise.resolve(null)
    })
    await store.loadSettings()
    expect(store.compareUseBuiltinIgnore).toBe(false)
  })

  it('3. setCompareUseBuiltinIgnore（true）：持久化到 compare_use_builtin_ignore key', async () => {
    await store.setCompareUseBuiltinIgnore(true)
    expect(store.compareUseBuiltinIgnore).toBe(true)
    expect(mockSettings.set).toHaveBeenCalledWith('compare_use_builtin_ignore', JSON.stringify(true))
  })

  it('4. setCompareUseBuiltinIgnore（false）：持久化到 compare_use_builtin_ignore key', async () => {
    await store.setCompareUseBuiltinIgnore(false)
    expect(store.compareUseBuiltinIgnore).toBe(false)
    expect(mockSettings.set).toHaveBeenCalledWith('compare_use_builtin_ignore', JSON.stringify(false))
  })
})
