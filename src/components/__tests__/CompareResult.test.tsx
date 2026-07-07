// @vitest-environment jsdom
/**
 * CompareResult.vue 组件测试（AI 对比结果面板 - 三 Tab UI）
 *
 * 文件后缀必须为 .tsx，以便命中 vitest.config 的 environmentMatch：
 *   匹配模式 src 下任意 .test.tsx 会分配到 jsdom 环境（Vue 组件挂载需要 DOM）。
 *
 * 测试覆盖：
 *   1. 基础挂载（默认 AI 分析 Tab）
 *   2. 概览条（same/different chips + 四项 stats 徽章 + 差异计数）
 *   3. Tab 切换 - 结构化差异（概览 / 请求头 / 请求体 / 响应体 差异）
 *   4. Tab 切换 - 原始报文 A·B
 *   5. 边界 - 无 diffResult
 *   6. 边界 - 无原始请求
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import CompareResult from '../CompareResult.vue'
import { useSettingsStore } from '../../stores/settings-store'
import type {
  CaptureRequest,
  CompareResult as CompareResultType,
  DiffResult,
  LoadingStates,
} from '../../services/types'

// 全局：CompareResult 现依赖 settings store（Pinia），为所有用例提供独立 Pinia 实例，避免跨测试串扰。
beforeEach(() => {
  setActivePinia(createPinia())
})

// ===== Fixtures =====

const baseLoadingStates: LoadingStates = {
  comparing: false,
  exporting: false,
  testingConnection: false,
  startingProxy: false,
}

function makeCaptureRequest(overrides: Partial<CaptureRequest>): CaptureRequest {
  return {
    id: 'req-a',
    method: 'GET',
    url: 'https://api.example.com/order/1',
    path: '/order/1',
    host: 'api.example.com',
    statusCode: 200,
    duration: 120,
    requestHeaders: { 'Content-Type': 'application/json', 'X-Token': 'aaa' },
    requestBody: '{"a":1}',
    responseHeaders: { 'Content-Type': 'application/json' },
    responseBody: '{"id":1,"name":"order-a"}',
    clientIp: '192.168.1.10',
    deviceName: 'iPhone-A',
    capturedAt: '2025-01-01T00:00:00.000Z',
    isRecorded: false,
    selected: false,
    checked: true,
    ...overrides,
  }
}

const requestA: CaptureRequest = makeCaptureRequest({})
const requestB: CaptureRequest = makeCaptureRequest({
  id: 'req-b',
  url: 'https://api.example.com/order/2',
  path: '/order/2',
  statusCode: 404,
  duration: 200,
  requestHeaders: { 'Content-Type': 'application/json', 'X-Token': 'bbb', 'X-New': 'new' },
  requestBody: '{"a":2}',
  responseHeaders: { 'Content-Type': 'application/json' },
  responseBody: '{"id":2,"name":"order-b"}',
  clientIp: '192.168.1.11',
  deviceName: 'iPhone-B',
})

const compareResult: CompareResultType = {
  analysis: '## 对比分析\n设备A与设备B请求存在差异',
  modelName: 'gpt-4',
  path: '/order/1',
  deviceA: { name: 'iPhone-A', ip: '192.168.1.10' },
  deviceB: { name: 'iPhone-B', ip: '192.168.1.11' },
  isStreaming: false,
}

// 手填已知数值，便于精确断言计数：
// same=['方法','路径']、different=['请求头','状态码']
// requestHeaders {+1,-1,~1}、responseHeaders {+0,-0,~0}、requestBody changes=2、responseBody changes=1
// => 差异 1+1+1 + 2 + 0+0+0 + 1 = 6 处
const diffResult: DiffResult = {
  overview: {
    same: ['方法', '路径'],
    different: ['请求头', '状态码'],
    stats: {
      requestHeaders: { added: 1, removed: 1, modified: 1 },
      requestBody: { changes: 2 },
      responseHeaders: { added: 0, removed: 0, modified: 0 },
      responseBody: { changes: 1 },
    },
  },
  requestHeaders: {
    added: { 'X-New': 'new' },
    removed: { 'X-Old': 'old' },
    modified: [{ key: 'X-Token', old: 'aaa', new: 'bbb' }],
  },
  requestBody: {
    type: 'text',
    changes: [
      { value: 'req-change-1', added: true },
      { value: 'req-change-2', removed: true },
    ],
  },
  responseHeaders: {
    added: {},
    removed: {},
    modified: [],
  },
  responseBody: {
    type: 'text',
    changes: [{ value: 'resp-change-1', added: true }],
  },
}

// ===== Helpers =====

function mountDefault(props: Partial<{
  compareResult: CompareResultType | null
  streamingText: string
  loadingStates: LoadingStates
  requestA: CaptureRequest | null
  requestB: CaptureRequest | null
  diffResult: DiffResult | null
}> = {}): VueWrapper<any> {
  return mount(CompareResult, {
    props: {
      compareResult,
      streamingText: '',
      loadingStates: baseLoadingStates,
      requestA,
      requestB,
      diffResult,
      ...props,
    },
  })
}

async function clickTab(wrapper: VueWrapper<any>, index: number): Promise<void> {
  const tabs = wrapper.findAll('.tab-item')
  await tabs[index].trigger('click')
  await wrapper.vm.$nextTick()
}

// ===== Tests =====

describe('CompareResult.vue', () => {
  let wrapper: VueWrapper<any>

  beforeEach(() => {
    if (wrapper) wrapper.unmount()
  })

  it('1. 基础挂载：标题存在且默认激活 AI 分析 Tab', () => {
    wrapper = mountDefault()

    // 标题渲染
    expect(wrapper.text()).toContain('AI 对比结果')

    // 三个 Tab 均存在
    const tabs = wrapper.findAll('.tab-item')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].text()).toBe('AI 分析')
    expect(tabs[1].text()).toBe('结构化差异')
    expect(tabs[2].text()).toBe('原始报文 A·B')

    // 默认激活第一个 Tab（AI 分析），且 AI 内容（Markdown 渲染）已显示
    expect(tabs[0].classes()).toContain('active')
    expect(wrapper.text()).toContain('对比分析')
    expect(wrapper.text()).toContain('设备A与设备B请求存在差异')
  })

  it('2. 概览条：green/amber chips + 四项 stats 徽章 + 差异计数', () => {
    wrapper = mountDefault()

    const text = wrapper.text()

    // 相同维度 green chip
    expect(text).toContain('✓ 方法')
    expect(text).toContain('✓ 路径')
    // 不同维度 amber chip
    expect(text).toContain('~ 请求头')
    expect(text).toContain('~ 状态码')

    // 四个 stats 徽章标题
    expect(text).toContain('请求头')
    expect(text).toContain('响应头')
    expect(text).toContain('请求体')
    expect(text).toContain('响应体')

    // 请求头徽章计数 +1 ~1 -1
    expect(text).toContain('+1')
    expect(text).toContain('-1')
    expect(text).toContain('~1')

    // 差异总数汇总
    expect(text).toContain('差异 6 处')
  })

  it('3. Tab 切换 - 结构化差异：概览 + 请求头/请求体/响应体 差异渲染', async () => {
    wrapper = mountDefault()
    await clickTab(wrapper, 1)

    const text = wrapper.text()

    // 概览卡片
    expect(text).toContain('概览')

    // 请求头差异区块：新增/删除/修改
    expect(text).toContain('+ 新增')
    expect(text).toContain('- 删除')
    expect(text).toContain('~ 修改')
    expect(text).toContain('X-New: new') // added
    expect(text).toContain('X-Old: old') // removed
    expect(text).toContain('X-Token: aaa → bbb') // modified

    // 请求体 / 响应体 差异区块渲染
    expect(text).toContain('req-change-1')
    expect(text).toContain('req-change-2')
    expect(text).toContain('resp-change-1')
  })

  it('4. Tab 切换 - 原始报文：请求 A / 请求 B 两栏且含 fixture 文本', async () => {
    wrapper = mountDefault()
    await clickTab(wrapper, 2)

    const text = wrapper.text()

    // 两栏标题
    expect(text).toContain('请求 A')
    expect(text).toContain('请求 B')

    // 请求 A 的 method/url/requestBody 文本
    expect(text).toContain('GET https://api.example.com/order/1')
    expect(text).toContain('{"a":1}')
    // 请求 B 的 url
    expect(text).toContain('https://api.example.com/order/2')
  })

  it('5. 边界 - 无 diffResult：结构化差异 Tab 显示占位', async () => {
    wrapper = mountDefault({ diffResult: null })
    await clickTab(wrapper, 1)

    expect(wrapper.text()).toContain('暂无结构化差异数据')
    // 概览条不应出现
    expect(wrapper.text()).not.toContain('差异 6 处')
  })

  it('6. 边界 - 无原始请求：原始报文 Tab 显示占位', async () => {
    wrapper = mountDefault({ requestA: null, requestB: null })
    await clickTab(wrapper, 2)

    expect(wrapper.text()).toContain('勾选两个请求后点击')
    // 不应出现请求 A 栏
    expect(wrapper.text()).not.toContain('请求 A')
  })
})

// ===== 改动 A：降级提示徽标 =====
// 标题栏在 deviceA vs deviceB 之后新增一枚琥珀色徽标，仅当
// compareResult?.degraded 为真时显示，文本为「⚠ 降级结果」。
describe('CompareResult.vue 降级徽标（改动 A）', () => {
  let wrapper: VueWrapper<any>

  afterEach(() => {
    if (wrapper) wrapper.unmount()
  })

  it('A-1 正向：compareResult.degraded 为真时显示「降级结果」徽标', () => {
    // 基于既有 fixture，仅追加 degraded: true
    const degraded = { ...compareResult, degraded: true }
    wrapper = mountDefault({ compareResult: degraded })

    // 断言 1：徽标文本出现在文档中
    expect(wrapper.text()).toContain('降级结果')

    // 徽标带 amber 样式类与「降级结果」文案（注意：标题栏新增的模板切换 <select> 也带 title，
    // 因此改用「文案」定位降级徽标，避免误命中 select）
    const badge = wrapper.findAll('span').find((el) => el.text().includes('降级结果'))
    expect(badge).toBeTruthy()
    expect(badge!.classes()).toContain('bg-amber-100')
    expect(badge!.classes()).toContain('text-amber-700')
  })

  it('A-2 负向：compareResult.degraded 为 false 时不显示降级徽标', () => {
    const notDegraded = { ...compareResult, degraded: false }
    wrapper = mountDefault({ compareResult: notDegraded })

    expect(wrapper.text()).not.toContain('降级结果')
    expect(wrapper.findAll('span').some((el) => el.text().includes('降级结果'))).toBe(false)
  })

  it('A-3 负向：compareResult 省略 degraded 字段时不显示降级徽标', () => {
    // 默认 fixture 不含 degraded 字段（undefined，falsy）
    wrapper = mountDefault()

    expect(wrapper.text()).not.toContain('降级结果')
    expect(wrapper.findAll('span').some((el) => el.text().includes('降级结果'))).toBe(false)
  })
})

// ===== 改动 B：标题栏模板快速切换下拉（从工具栏移入）=====
describe('CompareResult.vue 标题栏模板快速切换（改动 B）', () => {
  let wrapper: VueWrapper<any>

  beforeEach(() => {
    wrapper = mountDefault()
  })

  afterEach(() => {
    if (wrapper) wrapper.unmount()
  })

  it('B-1 标题栏存在「AI 对比结果」标题与模板切换下拉', () => {
    // 1. 标题存在
    expect(wrapper.text()).toContain('AI 对比结果')

    // 2. 下拉 select 存在且始终渲染（不依赖 compareResult / loadingStates）
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    expect(select.isVisible()).toBe(true)
  })

  it('B-2 下拉选项数量 == settingsStore.promptTemplates.length 且至少 2', () => {
    const store = useSettingsStore()
    const options = wrapper.findAll('select option')
    expect(options.length).toBe(store.promptTemplates.length)
    expect(options.length).toBeGreaterThanOrEqual(2)
  })

  it('B-3 下拉 value 绑定当前 selectedTemplateId（默认 builtin-v1）', () => {
    const store = useSettingsStore()
    const select = wrapper.find('select')
    expect((select.element as HTMLSelectElement).value).toBe(store.selectedTemplateId)
    expect(store.selectedTemplateId).toBe('builtin-v1')
  })

  it('B-4 切换行为：选中非默认模板后 store.selectedTemplateId 更新并回写 select', async () => {
    const store = useSettingsStore()
    const select = wrapper.find('select')

    // 前置：默认选中 builtin-v1
    expect(store.selectedTemplateId).toBe('builtin-v1')

    // 模拟用户在下拉中切换到 builtin-v2
    await select.setValue('builtin-v2')
    await wrapper.vm.$nextTick()

    // 1. store 选中态已切换（驱动主进程对比链路的核心不变量）
    expect(store.selectedTemplateId).toBe('builtin-v2')
    // 2. 主进程对比读取的 aiPromptTemplate 已同步为对应模板内容
    const v2 = store.promptTemplates.find((t) => t.id === 'builtin-v2')
    expect(store.aiPromptTemplate).toBe(v2?.content)
    // 3. select 的 :value 绑定随 store 回写，UI 与 store 保持一致
    expect((select.element as HTMLSelectElement).value).toBe('builtin-v2')
  })
})

// ===== 改动 C：一键加忽略规则（Click-to-Ignore）=====
describe('CompareResult.vue 一键加忽略（改动 C）', () => {
  let wrapper: VueWrapper<any>

  beforeEach(() => {
    wrapper = mountDefault()
  })

  afterEach(() => {
    if (wrapper) wrapper.unmount()
  })

  it('C-1 结构化差异 Tab 的 header 差异行提供「忽略」按钮', async () => {
    await clickTab(wrapper, 1)
    // added(X-New) + removed(X-Old) + modified(X-Token) 各一个 = 3
    const ignoreBtns = wrapper.findAll('button[title="加入忽略规则"]')
    expect(ignoreBtns.length).toBe(3)
  })

  it('C-2 点击 header modified 的「忽略」→ 规则入库 + 本地重算剔除差异 + 内联反馈', async () => {
    await clickTab(wrapper, 1)
    const store = useSettingsStore()

    // 前置：点击前该 modified 差异可见
    expect(wrapper.text()).toContain('X-Token: aaa → bbb')
    const before = store.compareIgnoreRules.slice()

    // modified 行为第 3 个忽略按钮（added/removed/modified 顺序）
    const ignoreBtns = wrapper.findAll('button[title="加入忽略规则"]')
    await ignoreBtns[2].trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    // 1. 规则已加入用户忽略列表（去重）
    expect(store.compareIgnoreRules).toContain('X-Token')
    expect(store.compareIgnoreRules.length).toBe(before.length + 1)

    // 2. 本地重算后该 header 差异从视图消失
    expect(wrapper.text()).not.toContain('X-Token: aaa → bbb')

    // 3. 内联反馈提示出现
    expect(wrapper.text()).toContain('已加入忽略规则：X-Token')
  })
})
