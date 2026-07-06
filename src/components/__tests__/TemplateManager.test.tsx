// @vitest-environment jsdom
/**
 * TemplateManager.vue 组件测试（AI 对比模板管理弹窗）
 *
 * 参考 CompareResult.test.tsx 的风格：
 *   1. 渲染内置模板列表，内置项的删除按钮 disabled
 *   2. 新建模板并保存后，模板库增加、新模板删除按钮可用
 *   3. 点击关闭按钮 emit('close')
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import TemplateManager from '../TemplateManager.vue'
import { useSettingsStore } from '../../stores/settings-store'
import { BUILTIN_PROMPT_TEMPLATES } from '../../services/types'

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

function findByText(wrapper: VueWrapper<any>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))
}

describe('TemplateManager.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockSettings.get.mockResolvedValue(null)
    mockSettings.set.mockResolvedValue(true)
    mockSettings.getAll.mockResolvedValue(null)
    mockSettings.saveAll.mockResolvedValue(true)
    mockThrottle.setConfig.mockResolvedValue(undefined)
  })

  it('1. 渲染内置模板，内置删除按钮 disabled', () => {
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    expect(wrapper.text()).toContain('详细版 (V1)')
    expect(wrapper.text()).toContain('精简版 (V2)')

    const delBtns = wrapper.findAll('[data-testid="delete-btn"]')
    expect(delBtns).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length)
    for (const btn of delBtns) {
      expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('2. 新建模板并保存后库增加、新模板删除按钮可用', async () => {
    const store = useSettingsStore()
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    // 点击「新建模板」
    const newBtn = findByText(wrapper, '新建模板')
    expect(newBtn).toBeTruthy()
    await newBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    // 填写名称与内容
    const nameInput = wrapper.find('input')
    await nameInput.setValue('我的模板')
    const textarea = wrapper.find('textarea')
    await textarea.setValue('对比 {diff_result}')

    // 点击「保存」
    const saveBtn = findByText(wrapper, '保存')
    expect(saveBtn).toBeTruthy()
    await saveBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    // 模板库增加
    expect(store.promptTemplates).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length + 1)
    expect(
      store.promptTemplates.some(
        (t) => t.name === '我的模板' && t.content === '对比 {diff_result}',
      ),
    ).toBe(true)

    // 新模板的删除按钮可用（最后一个）
    const delBtns = wrapper.findAll('[data-testid="delete-btn"]')
    expect(delBtns).toHaveLength(BUILTIN_PROMPT_TEMPLATES.length + 1)
    expect((delBtns[delBtns.length - 1].element as HTMLButtonElement).disabled).toBe(false)
  })

  it('3. 点击关闭按钮 emit close', async () => {
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    const closeBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('title') === '关闭')
    expect(closeBtn).toBeTruthy()
    await closeBtn!.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('4. 弹窗标题为 AI对比Prompt管理（与入口一致）', () => {
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    expect(wrapper.text()).toContain('AI对比Prompt管理')
    expect(wrapper.text()).not.toContain('AI 对比模板管理')
  })

  it('5. 展开按钮隐藏左侧列表、收起后恢复', async () => {
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    // 内容框（textarea）默认存在
    expect(wrapper.find('textarea').exists()).toBe(true)

    // 左侧列表容器默认可见
    const list = wrapper.find('div.w-56')
    expect(list.exists()).toBe(true)
    expect((list.element as HTMLElement).style.display).not.toBe('none')

    // 点击「展开」按钮（title 随 expanded 变化）
    const expandBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('title') === '展开内容框（隐藏列表）')
    expect(expandBtn).toBeTruthy()
    await expandBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    // 展开后左侧列表隐藏（v-show 表现为 display:none）
    const listAfter = wrapper.find('div.w-56')
    expect((listAfter.element as HTMLElement).style.display).toBe('none')
    // 内容框仍可见
    expect(wrapper.find('textarea').exists()).toBe(true)

    // 再点「收起」按钮恢复可见
    const collapseBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('title') === '收起内容框')
    expect(collapseBtn).toBeTruthy()
    await collapseBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect((wrapper.find('div.w-56').element as HTMLElement).style.display).not.toBe('none')
  })

  it('6. 内容框放大：textarea 含 min-h-[360px] 与 text-sm', () => {
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    const classes = textarea.classes()
    // 改动 B：内容框字号放大、最小高度放大
    expect(classes).toContain('min-h-[360px]')
    expect(classes).toContain('text-sm')
  })

  it('7. 弹窗加宽加高：dialog 含 w-[940px] 与 max-h-[92vh]', () => {
    const wrapper = mount(TemplateManager, { props: { visible: true } })

    const h3 = wrapper.find('h3')
    expect(h3.exists()).toBe(true)
    // h3 -> 标题栏 div -> 弹窗 dialog div
    const dialog = h3.element.parentElement?.parentElement as HTMLElement
    expect(dialog).toBeTruthy()
    // 改动 B：弹窗尺寸由 w-[860px] max-h-[86vh] 放大
    expect(dialog.className).toContain('w-[940px]')
    expect(dialog.className).toContain('max-h-[92vh]')
  })
})
