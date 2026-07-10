/**
 * AIAnalyzeService 细分降级决策树验证（v2.1 根因修复核心）
 *
 * 采用「spy 替换阶段方法」而非整套 OpenAI 流式 mock，规避旧 ai-analyze-service.test.ts
 * 的 fs / openai 装配问题，同时聚焦验证「analyze() 的 catch 降级决策」这一本次核心逻辑：
 *
 * ① 根因①（降级达标）：Phase1 成功 + Phase2 失败 → 走 phase2-fallback-legacy，
 *    且仍产出 scenarios（不整体降级为空）。这是当初搁置的根因，必须端到端验证。
 * ② 降级决策树分支：Phase1 失败 → 走 phase1-fallback-legacy（整体降级单 Agent）。
 *
 * 运行：npx vitest run electron/__tests__/ai-analyze-degradation.test.ts
 */
/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIAnalyzeService } from '../services/ai-analyze-service'
import type { CodeExplorationResult } from '../services/types'

// openai 仅被构造函数使用；本测试通过 spy 替换 phase1/phase2 方法，不会真正调用 create。
vi.mock('openai', () => ({
  default: class {
    constructor() {
      return { chat: { completions: { create: vi.fn() } } }
    }
  },
}))

// sse-manager 推送函数全部 no-op，避免真实 SSE 副作用（本测试通过 spy 私有 pushProgress 捕获警告）
vi.mock('../sse-manager', () => ({
  pushLog: vi.fn(),
  pushProgress: vi.fn(),
  pushDone: vi.fn(),
  pushError: vi.fn(),
  pushSSEEvent: vi.fn(),
}))

/** 构造一个可靠的 Phase1 探索结果（满足 assertExplorationReliable 的入口/终端节点要求） */
function makeExploration(): CodeExplorationResult {
  return {
    entryPoint: {
      handlerFile: 'internal/web/order_handler.go',
      handlerFunction: 'GetOrderDetail',
      routePattern: 'GET /api/v1/orders/:id',
      framework: 'gin',
    },
    fullCallChain: [],
    params: [],
    respStructure: { type: 'object', fields: [] },
    businessRules: [],
    errorPaths: [
      {
        statusCode: 400,
        errorCode: 'INVALID_PARAM',
        condition: '必填字段缺失',
        file: 'internal/web/order_handler.go',
        line: 52,
      },
    ],
    externalCalls: [],
    parseStatus: 'complete',
    parseWarnings: [],
  }
}

describe('AIAnalyzeService 细分降级决策树', () => {
  let service: AIAnalyzeService
  let mockMainWindow: any

  beforeEach(() => {
    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: vi.fn() },
    }
    service = new AIAnalyzeService(mockMainWindow, 'test-key', 'https://api.test.com')
    vi.restoreAllMocks()
  })

  describe('根因①：Phase1 成功 + Phase2 失败 → 复用 Phase1 兜底仍出 scenarios', () => {
    it('应走 phase2-fallback-legacy，且 analyze() 返回非空 scenarios（不降级为空）', async () => {
      const pushProgressSpy = vi.spyOn(service as any, 'pushProgress')

      // Phase1 成功（返回可靠探索结果）
      vi.spyOn(service as any, 'phase1ExploreCode').mockResolvedValue(makeExploration())
      // Phase2 失败（模拟生成器再次失败）
      vi.spyOn(service as any, 'phase2GenerateTests').mockRejectedValue(
        new Error('Phase2 generator failed'),
      )

      const result = await service.analyze({
        clonePath: '/repo',
        method: 'GET',
        url: 'http://example.com/api/v1/orders/123',
      })

      // 关键断言：仍产出 scenarios（1 个 normal + 1 个 errorPath 兜底）
      expect(result.scenarios.length).toBeGreaterThan(0)
      const normal = result.scenarios.find((s: any) => s.scenarioType === 'normal')
      expect(normal).toBeDefined()
      expect(normal.sourceRefs?.length).toBeGreaterThan(0)

      // 关键断言：降级模式为 phase2-fallback-legacy
      const warnCalls = pushProgressSpy.mock.calls.filter((c: any[]) => c[0] === 'warning')
      expect(warnCalls.length).toBe(1)
      expect(warnCalls[0][2].mode).toBe('phase2-fallback-legacy')
      expect(warnCalls[0][2].reason).toContain('Phase2')
    })

    it('根因①反向确认：Phase2 成功时直接走两阶段 Pipeline，不触发降级', async () => {
      const pushProgressSpy = vi.spyOn(service as any, 'pushProgress')
      vi.spyOn(service as any, 'phase1ExploreCode').mockResolvedValue(makeExploration())
      vi.spyOn(service as any, 'phase2GenerateTests').mockResolvedValue({
        scenarios: [{ scenarioName: '正常流程', scenarioType: 'normal', sourceRefs: [] }],
        analysisSummary: 'ok',
      })

      const result = await service.analyze({
        clonePath: '/repo',
        method: 'GET',
        url: 'http://example.com/api/v1/orders/123',
      })

      expect(result.scenarios.length).toBe(1)
      const warnCalls = pushProgressSpy.mock.calls.filter((c: any[]) => c[0] === 'warning')
      expect(warnCalls.length).toBe(0)
    })
  })

  describe('降级决策树分支：Phase1 失败 → phase1-fallback-legacy（整体降级单 Agent）', () => {
    it('应走 phase1-fallback-legacy，且调用单 Agent 兜底（不带探索结果）', async () => {
      const pushProgressSpy = vi.spyOn(service as any, 'pushProgress')
      vi.spyOn(service as any, 'phase1ExploreCode').mockRejectedValue(
        new Error('Phase1 explore failed'),
      )
      // 隔离：直接 stub 单 Agent 兜底，避免触发真实 legacy openai 调用
      const legacySpy = vi
        .spyOn(service as any, 'analyzeWithAgentLegacy')
        .mockResolvedValue({ matches: [], analysis: '', scenarios: [] })

      await service.analyze({
        clonePath: '/repo',
        method: 'GET',
        url: 'http://example.com/api/v1/orders/123',
      })

      const warnCalls = pushProgressSpy.mock.calls.filter((c: any[]) => c[0] === 'warning')
      expect(warnCalls.length).toBe(1)
      expect(warnCalls[0][2].mode).toBe('phase1-fallback-legacy')

      // 单 Agent 兜底应以「无探索结果」调用（第二参数为 undefined）
      expect(legacySpy).toHaveBeenCalledTimes(1)
      expect(legacySpy.mock.calls[0][1]).toBeUndefined()
    })
  })
})
