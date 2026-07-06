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
import { mount, type VueWrapper } from '@vue/test-utils'
import CompareResult from '../CompareResult.vue'
import type {
  CaptureRequest,
  CompareResult as CompareResultType,
  DiffResult,
  LoadingStates,
} from '../../services/types'

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

    // 徽标带 title 说明与 amber 样式类
    const badge = wrapper.find('[title]')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('bg-amber-100')
    expect(badge.classes()).toContain('text-amber-700')
  })

  it('A-2 负向：compareResult.degraded 为 false 时不显示降级徽标', () => {
    const notDegraded = { ...compareResult, degraded: false }
    wrapper = mountDefault({ compareResult: notDegraded })

    expect(wrapper.text()).not.toContain('降级结果')
    expect(wrapper.find('[title]').exists()).toBe(false)
  })

  it('A-3 负向：compareResult 省略 degraded 字段时不显示降级徽标', () => {
    // 默认 fixture 不含 degraded 字段（undefined，falsy）
    wrapper = mountDefault()

    expect(wrapper.text()).not.toContain('降级结果')
    expect(wrapper.find('[title]').exists()).toBe(false)
  })
})
