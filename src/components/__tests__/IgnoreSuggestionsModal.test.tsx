// @vitest-environment jsdom
/**
 * IgnoreSuggestionsModal.vue 组件测试（AI 智能忽略建议弹窗）
 *
 * 文件后缀必须为 .tsx，以便命中 vitest.config 的 environmentMatch：
 *   src 下任意 .test.tsx 会分配到 jsdom 环境（Vue 组件挂载需要 DOM）。
 *
 * 测试覆盖：
 *   1. 基础挂载：渲染全部建议行 + 默认全选 + 分类标题 + reason
 *   2. 字段展示：header/query 显示 name，body 显示 path
 *   3. 单个勾选切换 → 应用仅回传勾选项
 *   4. 全不选按钮 → 应用按钮禁用
 *   5. 取消按钮 → emit cancel（不 emit confirm）
 *   6. 空 suggestions → 显示「未发现可忽略字段」且全选按钮禁用
 */
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import IgnoreSuggestionsModal from '../IgnoreSuggestionsModal.vue'
import type { IgnoreSuggestion } from '../../services/types'

function makeSuggestions(): IgnoreSuggestion[] {
  return [
    { category: 'header', name: 'x-request-id', reason: '链路追踪头，非业务差异' },
    { category: 'header', name: 'etag', reason: '缓存校验头' },
    { category: 'query', name: 'signature', reason: '防重放签名' },
    { category: 'body', path: 'data.timestamp', reason: '易变时间戳' },
  ]
}

describe('IgnoreSuggestionsModal.vue', () => {
  it('1. 基础挂载：渲染全部建议行 + 默认全选 + 分类标题 + reason', () => {
    const wrapper = mount(IgnoreSuggestionsModal, { props: { suggestions: makeSuggestions() } })

    // 每行一个 checkbox（4 条建议）
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(4)
    boxes.forEach((b) => expect((b.element as HTMLInputElement).checked).toBe(true))

    // 分类标题（按 header / query / body 分组）
    expect(wrapper.text()).toContain('请求 / 响应头')
    expect(wrapper.text()).toContain('查询参数 (Query)')
    expect(wrapper.text()).toContain('响应体路径 (JSON)')

    // reason 文案渲染
    expect(wrapper.text()).toContain('链路追踪头，非业务差异')
  })

  it('2. 字段展示：header/query 显示 name，body 显示 path', () => {
    const wrapper = mount(IgnoreSuggestionsModal, { props: { suggestions: makeSuggestions() } })
    expect(wrapper.text()).toContain('x-request-id')
    expect(wrapper.text()).toContain('etag')
    expect(wrapper.text()).toContain('signature')
    expect(wrapper.text()).toContain('data.timestamp')
  })

  it('3. 单个勾选切换 → 应用仅回传勾选项', async () => {
    const wrapper = mount(IgnoreSuggestionsModal, { props: { suggestions: makeSuggestions() } })

    // 取消第一个（x-request-id）：用 setChecked 触发 change
    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[0].setValue(false)
    await flushPromises()
    await wrapper.vm.$nextTick()

    // 底部计数变为 3
    expect(wrapper.text()).toContain('应用选中 (3)')

    // 点击「应用选中」
    const applyBtn = wrapper.find('button.btn-primary')
    expect(applyBtn.exists()).toBe(true)
    await applyBtn.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const emitted = wrapper.emitted('confirm')
    expect(emitted).toBeTruthy()
    // wrapper.emitted 返回的是「每次 emit 的参数数组」的数组，
    // emitted('confirm')[0] 即第一次 emit 的实参数组 [chosen]，取 [0] 才是真正回传的勾选列表。
    const chosen = emitted![0][0] as IgnoreSuggestion[]
    expect(chosen).toHaveLength(3)
    // 被取消的 x-request-id 不出现
    expect(chosen.find((s) => s.name === 'x-request-id')).toBeUndefined()
    // 其余 header / query / body 均在
    expect(chosen.find((s) => s.name === 'etag')).toBeTruthy()
    expect(chosen.find((s) => s.name === 'signature')).toBeTruthy()
    expect(chosen.find((s) => s.path === 'data.timestamp')).toBeTruthy()
  })

  it('4. 全不选按钮 → 应用按钮禁用', async () => {
    const wrapper = mount(IgnoreSuggestionsModal, { props: { suggestions: makeSuggestions() } })

    // 初始为「全不选」按钮（因为默认全选）
    const allBtn = wrapper.findAll('button').find((b) => b.text() === '全不选')
    expect(allBtn).toBeTruthy()
    await allBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('应用选中 (0)')
    const applyBtn = wrapper.find('button.btn-primary')
    expect((applyBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('5. 取消按钮 → emit cancel（且未 emit confirm）', async () => {
    const wrapper = mount(IgnoreSuggestionsModal, { props: { suggestions: makeSuggestions() } })

    const cancelBtn = wrapper.findAll('button').find((b) => b.text() === '取消')
    expect(cancelBtn).toBeTruthy()
    await cancelBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('confirm')).toBeFalsy()
  })

  it('6. 空 suggestions → 显示「未发现可忽略字段」且全选按钮禁用', () => {
    const wrapper = mount(IgnoreSuggestionsModal, { props: { suggestions: [] } })

    expect(wrapper.text()).toContain('未发现可忽略的易变字段')

    const allBtn = wrapper.findAll('button').find((b) => b.text() === '全选')
    expect(allBtn).toBeTruthy()
    expect((allBtn!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('7. loading=true 时弹窗交互不被冻结：有勾选项则应用按钮仍可用', async () => {
    // 回归：修复前应用按钮 :disabled="selectedCount === 0 || loading"，
    // 若弹窗首帧 loading 偶发为 true 会导致按钮被禁用、用户感知卡住/忙碌。
    // 修复后弹窗交互与 loading 状态解耦，loading 仅控制顶部 spinner。
    const wrapper = mount(IgnoreSuggestionsModal, {
      props: { suggestions: makeSuggestions(), loading: true },
    })

    // 默认全选（4 项），即便 loading=true，应用按钮也应 enabled
    const applyBtn = wrapper.find('button.btn-primary')
    expect((applyBtn.element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.text()).toContain('应用选中 (4)')

    // 取消一项后计数变 3，按钮仍 enabled
    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[0].setValue(false)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('应用选中 (3)')
    expect((applyBtn.element as HTMLButtonElement).disabled).toBe(false)
  })
})
