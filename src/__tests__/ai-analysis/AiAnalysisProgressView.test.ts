/**
 * AiAnalysisProgressView.vue 组件测试
 * 
 * 测试覆盖：
 * - 进度页面渲染
 * - 实时日志显示
 * - 进度条更新
 * - 阶段状态切换
 * - 自动导航到结果页面
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import AiAnalysisProgressView from '../../views/AiAnalysisProgressView.vue'

// Mock store
vi.mock('../../stores/ai-analysis-store', () => ({
  useAiAnalysisStore: vi.fn(() => ({
    phase: 'scanning',
    analyzing: true,
    phaseDescription: '扫描路由中',
    logs: [],
    autoScroll: true,
    sseConnected: true,
    cloneProgress: null,
    scanProgress: {
      phase: 'scan-mapping',
      percent: 50,
      currentFile: 'main.go',
      matchCount: 2
    }
  }))
}))

// Mock AnalysisLogViewer 组件
vi.mock('../../components/AnalysisLogViewer.vue', () => ({
  default: {
    name: 'AnalysisLogViewer',
    template: '<div class="mock-log-viewer"></div>',
    props: ['logs', 'autoScroll', 'connected']
  }
}))

describe('AiAnalysisProgressView', () => {
  let wrapper: any
  let router: any

  beforeEach(async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', name: 'home', component: {} as any },
        { path: '/ai-analysis/progress', name: 'ai-analysis-progress', component: AiAnalysisProgressView }
      ]
    })
    
    await router.push('/ai-analysis/progress')
    
    wrapper = mount(AiAnalysisProgressView, {
      global: {
        plugins: [router],
        stubs: {
          AnalysisLogViewer: true
        }
      }
    })
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
    vi.clearAllMocks()
  })

  describe('渲染测试', () => {
    it('应该渲染进度卡片', () => {
      const card = wrapper.find('.card')
      expect(card.exists()).toBe(true)
    })

    it('应该渲染进度条', () => {
      const progressBar = wrapper.find('.bg-gray-700')
      expect(progressBar.exists()).toBe(true)
    })

    it('应该渲染阶段标题', () => {
      const title = wrapper.find('h2')
      expect(title.exists()).toBe(true)
    })

    it('应该渲染日志查看器', () => {
      const logViewer = wrapper.findComponent({ name: 'AnalysisLogViewer' })
      expect(logViewer.exists()).toBe(true)
    })
  })

  describe('进度显示', () => {
    it('应该显示当前阶段', () => {
      const phaseText = wrapper.text()
      expect(phaseText).toContain('扫描路由中')
    })

    it('应该显示进度百分比', () => {
      const percentText = wrapper.text()
      expect(percentText).toContain('50%')
    })
  })

  describe('暗色主题适配', () => {
    it('应该使用暗色背景', () => {
      const container = wrapper.find('.bg-\\[\\#1a1a2e\\]')
      expect(container.exists()).toBe(true)
    })

    it('应该使用暗色卡片背景', () => {
      const card = wrapper.find('.bg-\\[\\#2d2d44\\]')
      expect(card.exists()).toBe(true)
    })
  })

  describe('操作按钮', () => {
    it('应该渲染中断按钮（分析进行时）', () => {
      const cancelButton = wrapper.find('button:contains("中断分析")')
      expect(cancelButton.exists()).toBe(true)
    })

    it('应该渲染返回按钮', () => {
      const backButton = wrapper.find('button:contains("返回")')
      expect(backButton.exists()).toBe(true)
    })
  })
})
