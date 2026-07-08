// @vitest-environment jsdom
/**
 * CompareResult.vue「AI 智能忽略」自动弹窗守卫测试（Scenarios A / B / D）
 *
 * 隔离文件，独立 mock ipc，不污染既有测试套件。
 * 验证最高风险路径：防重复弹窗 / 防重对比无限循环 / 切换对比对重新拉取。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const { ignoreSuggestions } = vi.hoisted(() => ({
  ignoreSuggestions: vi.fn(),
}))

vi.mock('../../services/ipc', () => ({
  ipc: {
    ai: { ignoreSuggestions },
    settings: { set: vi.fn() },
  },
}))

import CompareResult from '../CompareResult.vue'
import type { CaptureRequest, CompareResult as CompareResultType, DiffResult, LoadingStates } from '../../services/types'

beforeEach(() => {
  setActivePinia(createPinia())
  ignoreSuggestions.mockReset()
})

function makeReq(id: string, overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    id,
    method: 'GET',
    url: `https://api.example.com/${id}`,
    path: `/${id}`,
    host: 'api.example.com',
    statusCode: 200,
    duration: 1,
    requestHeaders: {},
    requestBody: '{}',
    responseHeaders: {},
    responseBody: '{}',
    clientIp: '1.1.1.1',
    deviceName: id,
    capturedAt: '',
    isRecorded: false,
    selected: false,
    checked: true,
    ...overrides,
  }
}

const pair1 = { requestA: makeReq('req-a'), requestB: makeReq('req-b') }
const pair2 = { requestA: makeReq('req-c'), requestB: makeReq('req-d') }
const diff: DiffResult = {
  overview: {
    same: [],
    different: [],
    stats: {
      requestHeaders: { added: 0, removed: 0, modified: 0 },
      requestBody: { changes: 0 },
      responseHeaders: { added: 0, removed: 0, modified: 0 },
      responseBody: { changes: 0 },
    },
  },
  requestHeaders: { added: {}, removed: {}, modified: [] },
  requestBody: { type: 'text', changes: [] },
  responseHeaders: { added: {}, removed: {}, modified: [] },
  responseBody: { type: 'text', changes: [] },
}
const diff2: DiffResult = {
  overview: {
    same: [],
    different: [],
    stats: {
      requestHeaders: { added: 0, removed: 0, modified: 0 },
      requestBody: { changes: 0 },
      responseHeaders: { added: 0, removed: 0, modified: 0 },
      responseBody: { changes: 0 },
    },
  },
  requestHeaders: { added: {}, removed: {}, modified: [] },
  requestBody: { type: 'text', changes: [] },
  responseHeaders: { added: {}, removed: {}, modified: [] },
  responseBody: { type: 'text', changes: [] },
}
const compareResult: CompareResultType = {
  analysis: 'ok',
  modelName: 'gpt',
  path: '/x',
  deviceA: { name: 'a', ip: '1' },
  deviceB: { name: 'b', ip: '2' },
  isStreaming: false,
}
const loadingStates: LoadingStates = {
  comparing: false,
  exporting: false,
  testingConnection: false,
  startingProxy: false,
}

function suggestionsOnce(list: any[]): void {
  ignoreSuggestions.mockResolvedValue({ success: true, suggestions: list })
}

function mountCmp(props: Record<string, unknown>): VueWrapper<any> {
  return mount(CompareResult, {
    props: { compareResult, streamingText: '', loadingStates, requestA: null, requestB: null, diffResult: null, ...props },
  })
}

describe('CompareResult AI 智能忽略守卫', () => {
  it('A: 首次对比（diffResult 就绪）自动拉 AI 并弹窗（仅新建议）', async () => {
    suggestionsOnce([{ category: 'header', name: 'X-Token', reason: 'r' }])
    const wrapper = mountCmp({ ...pair1, diffResult: null })
    await wrapper.setProps({ diffResult: diff })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(ignoreSuggestions).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('AI 智能忽略建议')
  })

  it('B: 同一对比对重对比 → 不重复拉 AI / 不重复弹窗（防无限循环）', async () => {
    suggestionsOnce([{ category: 'header', name: 'X-Token', reason: 'r' }])
    const wrapper = mountCmp({ ...pair1, diffResult: null })
    await wrapper.setProps({ diffResult: diff })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(ignoreSuggestions).toHaveBeenCalledTimes(1)
    // 模拟 MainView.handleCompare：新 diffResult 但同一对比对（recompare）
    await wrapper.setProps({ diffResult: diff2 })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(ignoreSuggestions).toHaveBeenCalledTimes(1)
  })

  it('D: 切换不同对比对 → 重新拉 AI', async () => {
    suggestionsOnce([{ category: 'header', name: 'X-Token', reason: 'r' }])
    const wrapper = mountCmp({ ...pair1, diffResult: null })
    await wrapper.setProps({ diffResult: diff })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(ignoreSuggestions).toHaveBeenCalledTimes(1)
    // 切换对比对（id 变化）
    await wrapper.setProps({ ...pair2, diffResult: diff2 })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(ignoreSuggestions).toHaveBeenCalledTimes(2)
  })
})
