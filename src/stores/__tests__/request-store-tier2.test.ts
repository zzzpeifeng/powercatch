/**
 * AI 对比 Tier 2 结构化输出 - 单元测试（File C：request-store.doCompare）
 *
 * 验证 doCompare 中 diffResult 的两分支：
 *  - 客户端兜底：AI 调用失败时，diffResult 仍由本地 computeDiff 生成（Tab 可用）
 *  - 服务端优先：AI 返回 result.diffResult 时，store.diffResult 采用服务端单一数据源
 *
 * 运行环境：node（store 在 typeof window==='undefined' 时不启动定时器/订阅）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRequestStore } from '../request-store'
import type { CaptureRequest, CompareResult, DiffResult } from '../../services/types'

// Mock ipc.ai.compare，使其可控制在 node 环境下返回成功/失败
// 注意：本测试文件位于 src/stores/__tests__/，需 ../.. 才能指向 src/services/ipc
vi.mock('../../services/ipc', () => {
  const compare = vi.fn()
  return {
    ipc: {
      ai: { compare },
    },
  }
})

// 重新导入以获取 mock 实例
import { ipc } from '../../services/ipc'

function makeCaptureRequest(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    method: 'GET',
    url: 'https://example.com/api/x',
    path: '/api/x',
    host: 'example.com',
    statusCode: 200,
    duration: 10,
    requestHeaders: {},
    requestBody: '',
    responseHeaders: {},
    responseBody: '{"price":100}',
    clientIp: '192.168.1.1',
    deviceName: 'DeviceA',
    capturedAt: new Date().toISOString(),
    isRecorded: true,
    selected: false,
    checked: false,
    ...overrides,
  }
}

function makeServerDiff(): DiffResult {
  return {
    overview: {
      same: [],
      different: ['__STORE_SERVER_MARKER__'],
      stats: {
        requestHeaders: { added: 0, removed: 0, modified: 0 },
        requestBody: { changes: 0 },
        responseHeaders: { added: 0, removed: 0, modified: 0 },
        responseBody: { changes: 0 },
      },
    },
    requestHeaders: { added: {}, removed: {}, modified: [] },
    requestBody: { type: 'empty' },
    responseHeaders: { added: {}, removed: {}, modified: [] },
    responseBody: { type: 'empty' },
  }
}

describe('Tier2 - doCompare diffResult 分支', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(ipc.ai.compare).mockReset()
  })

  it('AI 失败时：diffResult 仍可用（客户端 computeDiff 兜底）', async () => {
    const store = useRequestStore()
    const reqA = makeCaptureRequest({ id: 'a', responseBody: '{"price":100}' })
    const reqB = makeCaptureRequest({ id: 'b', responseBody: '{"price":200}' })
    store.toggleCheck(reqA)
    store.toggleCheck(reqB)

    // AI 调用失败
    vi.mocked(ipc.ai.compare).mockResolvedValueOnce({ success: false, error: 'boom' })

    await expect(store.doCompare()).rejects.toThrow()

    // 客户端兜底：diffResult 非 null，且反映真实差异
    expect(store.diffResult).not.toBeNull()
    expect(store.diffResult!.overview.different).toContain('Response Body')
  })

  it('AI 成功且返回 diffResult 时：store.diffResult 优先采用服务端单一数据源', async () => {
    const store = useRequestStore()
    const reqA = makeCaptureRequest({ id: 'a', responseBody: '{"price":100}' })
    const reqB = makeCaptureRequest({ id: 'b', responseBody: '{"price":200}' })
    store.toggleCheck(reqA)
    store.toggleCheck(reqB)

    const serverDiff = makeServerDiff()
    const result: CompareResult = {
      analysis: '分析文本',
      modelName: 'gpt',
      path: '/api/x',
      deviceA: { name: 'DeviceA', ip: '192.168.1.1' },
      deviceB: { name: 'DeviceB', ip: '192.168.1.2' },
      isStreaming: false,
      diffResult: serverDiff,
    }
    vi.mocked(ipc.ai.compare).mockResolvedValueOnce({ success: true, result })

    await store.doCompare()

    expect(store.compareResult).toEqual(result)
    // 优先服务端 diffResult（含标记），而非本地重算
    expect(store.diffResult).toEqual(serverDiff)
    expect(store.diffResult!.overview.different).toContain('__STORE_SERVER_MARKER__')
  })
})
