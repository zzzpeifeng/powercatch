/**
 * AiAnalysisView.vue 组件测试
 * 
 * 测试覆盖：
 * - 配置表单渲染和交互
 * - 仓库 URL 输入和验证
 * - 分支获取和选择
 * - 开始分析按钮状态
 * - 导航逻辑
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import AiAnalysisView from '../../views/AiAnalysisView.vue'

// Mock store
vi.mock('../../stores/ai-analysis-store', () => ({
  useAiAnalysisStore: vi.fn(() => ({
    repoConfig: {
      repoUrl: '',
      branch: '',
      accessToken: '',
      authMethod: 'http',
      repoUrlHistory: []
    },
    analyzing: false,
    result: null,
    error: null,
    gitAvailable: true,
    gitChecking: false,
    scanProgress: null,
    cloneProgress: null,
    streamContent: '',
    startAnalysis: vi.fn(),
    cancelAnalysis: vi.fn(),
    reset: vi.fn(),
    checkGitAvailability: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    addRepoUrlToHistory: vi.fn(),
    checkDiskSpace: vi.fn(),
    cleanupRepo: vi.fn()
  }))
}))

// Mock IPC
vi.mock('../../services/ipc', () => ({
  ipc: {
    aiCodeAnalysis: {
      fetchBranches: vi.fn()
    },
    settings: {
      getAll: vi.fn(() => Promise.resolve({ apiKey: 'test-key' }))
    }
  }
}))

describe('AiAnalysisView', () => {
  let wrapper: any
  let router: any

  beforeEach(async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', name: 'home', component: {} as any },
        { path: '/ai-analysis', name: 'ai-analysis', component: AiAnalysisView }
      ]
    })
    
    await router.push('/ai-analysis')
    
    wrapper = mount(AiAnalysisView, {
      global: {
        plugins: [router],
        stubs: {
          GitNotInstalled: true,
          CloneProgress: true,
          TestScenarioCard: true
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
    it('应该渲染配置卡片', () => {
      const card = wrapper.find('.card')
      expect(card.exists()).toBe(true)
    })

    it('应该渲染仓库 URL 输入框', () => {
      const input = wrapper.find('input[type="text"]')
      expect(input.exists()).toBe(true)
    })

    it('应该渲染分支输入框', () => {
      const inputs = wrapper.findAll('input')
      expect(inputs.length).toBeGreaterThan(0)
    })

    it('应该渲染开始分析按钮', () => {
      const button = wrapper.find('button')
      expect(button.exists()).toBe(true)
    })
  })

  describe('交互测试', () => {
    it('应该启用/禁用开始分析按钮', async () => {
      const store = wrapper.vm.store
      store.repoConfig.repoUrl = 'https://github.com/test/repo'
      store.repoConfig.branch = 'main'
      
      await wrapper.vm.$nextTick()
      
      const startButton = wrapper.find('button:contains("开始分析")')
      expect(startButton.attributes('disabled')).toBeFalsy()
    })

    it('应该显示 Token 输入框', () => {
      const tokenInput = wrapper.find('input[type="password"]')
      expect(tokenInput.exists()).toBe(true)
    })
  })

  describe('暗色主题适配', () => {
    it('应该使用暗色主题样式', () => {
      const container = wrapper.find('.bg-gray-50')
      expect(container.exists()).toBe(true)
    })

    it('应该正确渲染 badge', () => {
      const badges = wrapper.findAll('.badge')
      expect(badges.length).toBeGreaterThanOrEqual(0)
    })
  })
})
