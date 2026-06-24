/**
 * AiAnalysisResultView.vue 组件测试
 * 
 * 测试覆盖：
 * - 结果页面渲染
 * - 分析摘要显示
 * - 场景链路分析表格
 * - curl 和 Python 断言面板
 * - 重新分析和清理功能
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import AiAnalysisResultView from '../../views/AiAnalysisResultView.vue'

// Mock store
vi.mock('../../stores/ai-analysis-store', () => ({
  useAiAnalysisStore: vi.fn(() => ({
    result: {
      repoName: 'test-repo',
      handlerFunction: 'GetUserHandler',
      modelName: 'deepseek-chat',
      routeInfo: 'GET /api/user/:id',
      analysisSummary: '# 分析报告\n\n## 调用链路\n\n1. Handler\n2. Service\n3. Repository',
      scenarios: [
        {
          scenarioName: '场景1：正常流程',
          curlCommand: 'curl -X GET http://localhost:8080/api/user/1',
          pythonAssertion: 'assert response.status_code == 200'
        }
      ]
    },
    cleanupStatus: 'idle',
    reset: vi.fn(),
    cleanupRepo: vi.fn()
  }))
}))

// Mock 子组件
vi.mock('../../components/ScenarioTable.vue', () => ({
  default: {
    name: 'ScenarioTable',
    template: '<div class="mock-scenario-table"></div>',
    props: ['scenarios']
  }
}))

vi.mock('../../components/CurlAssertionPanel.vue', () => ({
  default: {
    name: 'CurlAssertionPanel',
    template: '<div class="mock-curl-panel"></div>',
    props: ['scenarioIndex', 'scenarioName', 'curlCommand', 'pythonAssertion']
  }
}))

describe('AiAnalysisResultView', () => {
  let wrapper: any
  let router: any

  beforeEach(async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', name: 'home', component: {} as any },
        { path: '/ai-analysis/result', name: 'ai-analysis-result', component: AiAnalysisResultView }
      ]
    })
    
    await router.push('/ai-analysis/result')
    
    wrapper = mount(AiAnalysisResultView, {
      global: {
        plugins: [router],
        stubs: {
          ScenarioTable: true,
          CurlAssertionPanel: true
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
    it('应该渲染分析摘要卡片', () => {
      const card = wrapper.find('.card')
      expect(card.exists()).toBe(true)
    })

    it('应该显示 Handler 信息', () => {
      const text = wrapper.text()
      expect(text).toContain('GetUserHandler')
    })

    it('应该显示模型名称', () => {
      const text = wrapper.text()
      expect(text).toContain('deepseek-chat')
    })

    it('应该渲染场景表格', () => {
      const table = wrapper.findComponent({ name: 'ScenarioTable' })
      expect(table.exists()).toBe(true)
    })

    it('应该渲染 curl 面板', () => {
      const panel = wrapper.findComponent({ name: 'CurlAssertionPanel' })
      expect(panel.exists()).toBe(true)
    })
  })

  describe('操作按钮', () => {
    it('应该渲染重新分析按钮', () => {
      const button = wrapper.find('button:contains("重新分析")')
      expect(button.exists()).toBe(true)
    })

    it('应该渲染清理临时仓库按钮', () => {
      const button = wrapper.find('button:contains("清理临时仓库")')
      expect(button.exists()).toBe(true)
    })
  })

  describe('暗色主题适配', () => {
    it('应该使用暗色背景', () => {
      const container = wrapper.find('.bg-\\[\\#1a1a2e\\]')
      expect(container.exists()).toBe(true)
    })

    it('应该正确渲染 Markdown 内容', () => {
      const prose = wrapper.find('.prose')
      expect(prose.exists()).toBe(true)
    })
  })

  describe('路由信息显示', () => {
    it('应该显示路由信息', () => {
      const text = wrapper.text()
      expect(text).toContain('GET /api/user/:id')
    })
  })
})
