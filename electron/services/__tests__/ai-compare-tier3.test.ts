/**
 * AI 对比 Tier 3（重试 / 降级 / 缓存）- 单元测试
 *
 * 覆盖行为（基于 electron/services/ai-service.ts 实现）：
 * T3-1 缓存命中跳过 AI 调用
 * T3-2 可重试错误触发重试（指数退避 await sleep）
 * T3-3 重试耗尽降级不抛错
 * T3-4 不可重试错误立即降级
 * T3-5 已下发 chunk 后出错不重试直接降级
 * T3-6 clearCompareCache 导出可用
 * T3-7 degraded 字段类型为 boolean（来自 src/services/types.ts）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  executeCompare,
  clearCompareCache,
} from '../ai-service'
import type { CaptureRequest, CompareRequest } from '../../../src/services/types'

/**
 * 用 vi.hoisted 创建可在 vi.mock 工厂与测试用例间共享的 mock 函数。
 * 工厂仅定义 OpenAI 类的 chat.completions.create 指向同一个 mockCreate，
 * 各用例通过 mockImplementation / mockRejectedValue 控制其行为。
 */
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mockCreate } }
  },
}))

// ---------- Fixtures（与 tier2 保持一致，便于对照）----------

function makeCaptureRequest(
  overridesA: Partial<CaptureRequest> = {},
  overridesB: Partial<CaptureRequest> = {},
): { requestA: CaptureRequest; requestB: CaptureRequest } {
  const base: CaptureRequest = {
    id: 'a',
    method: 'POST',
    url: 'https://api.example.com/order',
    path: '/order',
    host: 'api.example.com',
    statusCode: 200,
    duration: 10,
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: '{}',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{}',
    clientIp: '10.0.0.1',
    deviceName: 'DeviceA',
    capturedAt: '',
    isRecorded: false,
    selected: false,
    checked: false,
  }
  const requestA: CaptureRequest = { ...base, ...overridesA }
  const requestB: CaptureRequest = {
    ...base,
    ...overridesB,
    id: 'b',
    deviceName: 'DeviceB',
    clientIp: '10.0.0.2',
  }
  return { requestA, requestB }
}

function makeCompareRequest(
  overridesA: Partial<CaptureRequest> = {},
  overridesB: Partial<CaptureRequest> = {},
): CompareRequest {
  const { requestA, requestB } = makeCaptureRequest(overridesA, overridesB)
  return {
    requestA,
    requestB,
    promptTemplate: '分析：\n{diff_result}',
    modelName: 'gpt',
    apiUrl: 'http://x',
    apiKey: 'k',
  }
}

/** 成功流式：yield 一段 content */
function successStream(text = 'AI 分析结论文本') {
  return (async function* () {
    yield { choices: [{ delta: { content: text } }] }
  })()
}

// ---------- 隔离 ----------

beforeEach(() => {
  // 重置 mock 行为，避免用例间泄漏
  mockCreate.mockReset()
  // 清理缓存，保证用例独立
  clearCompareCache()
})

afterEach(() => {
  clearCompareCache()
})

// ---------- T3-1 缓存命中跳过 AI 调用 ----------

describe('T3-1 缓存命中跳过 AI 调用', () => {
  it('相同 request 第二次调用命中缓存，不再次调用 AI', async () => {
    mockCreate.mockImplementation(() => successStream())

    const req = makeCompareRequest({ statusCode: 200 }, { statusCode: 200 })

    const r1 = await executeCompare(req)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(r1.degraded).toBeUndefined()

    // 第二次调用相同 request
    const r2 = await executeCompare(req)

    // 关键：缓存命中，AI 调用不应被再次触发
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(r2.analysis).toBe(r1.analysis)
    expect(r2.degraded).toBeUndefined()
  })
})

// ---------- T3-2 可重试错误触发重试 ----------

describe('T3-2 可重试错误触发重试', () => {
  it('第一次失败（网络错误）第二次成功，mock 被调用 2 次且确实 await sleep(50)', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    mockCreate
      .mockRejectedValueOnce(new Error('fetch failed')) // 第一次可重试错误
      .mockImplementationOnce(() => successStream('retry-ok')) // 第二次成功

    const req = makeCompareRequest()
    const result = await executeCompare(req)

    // 最终成功
    expect(result.analysis).toBe('retry-ok')
    expect(result.degraded).toBeUndefined()
    // 重试确实发生：共 2 次调用（1 初始 + 1 重试）
    expect(mockCreate).toHaveBeenCalledTimes(2)
    // 指数退避：第 1 次重试 delay = RETRY_BASE_DELAY_MS * 2^0 = 50ms
    // 验证 sleep 真的被 await（而非同步跳过）
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50)

    setTimeoutSpy.mockRestore()
  })
})

// ---------- T3-3 重试耗尽降级不抛错 ----------

describe('T3-3 重试耗尽降级不抛错', () => {
  it('连续 3 次可重试错误 → 不 reject，degraded === true 且 diffResult 存在', async () => {
    // 每次都抛可重试错误（总尝试 = MAX_RETRIES + 1 = 3）
    mockCreate.mockRejectedValue(new Error('fetch failed'))

    const req = makeCompareRequest({ statusCode: 200 }, { statusCode: 500 })
    const p = executeCompare(req)

    // 关键：不 reject（若抛错，此 await 将失败）
    await expect(p).resolves.toBeDefined()

    const result = await p
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result.degraded).toBe(true)
    expect(result.diffResult).toBeDefined()
    expect(result.diffResult!.overview).toBeDefined()
  })
})

// ---------- T3-4 不可重试错误立即降级 ----------

describe('T3-4 不可重试错误立即降级', () => {
  it('抛 401 错误 → 仅调用 1 次，degraded === true，不进入重试循环', async () => {
    // 401 不在 isRetryableError 的可重试清单中
    mockCreate.mockRejectedValue(new Error('401 Unauthorized'))

    const req = makeCompareRequest({ statusCode: 200 }, { statusCode: 500 })
    const result = await executeCompare(req)

    // 不可重试错误：不应重试
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(result.degraded).toBe(true)
    expect(result.diffResult).toBeDefined()
  })
})

// ---------- T3-5 已下发 chunk 后出错不重试直接降级 ----------

describe('T3-5 已下发 chunk 后出错不重试直接降级', () => {
  it('第一次先 onChunk 再抛可重试错误 → 不重试，mock 调用 1 次，degraded === true', async () => {
    mockCreate
      // 第一次：先下发一个 chunk，再抛可重试错误
      .mockImplementationOnce(async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] }
        throw new Error('fetch failed')
      })
      // 护栏：若实现错误地继续重试，将抛出一个「不应出现」的错误
      .mockImplementationOnce(() => {
        throw new Error('SECOND_CALL_SHOULD_NOT_HAPPEN')
      })

    const chunks: string[] = []
    const req = makeCompareRequest({ statusCode: 200 }, { statusCode: 500 })
    const result = await executeCompare(req, (c) => chunks.push(c))

    // 关键约束：已下发过 chunk，即便错误可重试也不再重试，避免 UI 内容错乱
    expect(mockCreate).toHaveBeenCalledTimes(1)
    // partial chunk 确实已下发
    expect(chunks).toContain('partial')
    expect(result.degraded).toBe(true)
    expect(result.diffResult).toBeDefined()
  })
})

// ---------- T3-6 clearCompareCache 导出可用 ----------

describe('T3-6 clearCompareCache 导出可用', () => {
  it('调用不抛错，且能重置缓存使再次 AI 调用发生', async () => {
    expect(typeof clearCompareCache).toBe('function')
    expect(() => clearCompareCache()).not.toThrow()

    mockCreate.mockImplementation(() => successStream())
    const req = makeCompareRequest()
    await executeCompare(req)
    expect(mockCreate).toHaveBeenCalledTimes(1)

    // 清空缓存后再次调用应重新触发 AI（证明缓存确实被清空）
    clearCompareCache()
    await executeCompare(req)
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })
})

// ---------- T3-7 degraded 字段类型 ----------

describe('T3-7 degraded 字段类型', () => {
  it('降级结果 degraded 为 boolean（来自 src/services/types.ts 约定）', async () => {
    mockCreate.mockRejectedValue(new Error('fetch failed'))
    const req = makeCompareRequest({ statusCode: 200 }, { statusCode: 500 })
    const result = await executeCompare(req)

    expect(result.degraded).toBe(true)
    // 来自 CompareResult.degraded?: boolean
    expect(typeof result.degraded).toBe('boolean')
  })
})

// ---------- T3-8 缓存数量上限 50（改动 B）----------
// setCached 重写：写入前若 size >= MAX_CACHE_ENTRIES(50) 且为全新 key，
// 淘汰最旧一条再写入；命中已存在 key 不触发淘汰。
// 因 compareCache 为模块私有 Map（未导出），用「AI 调用次数」做行为法观测。

describe('T3-8 缓存数量上限 50（改动 B）', () => {
  it('51 个互不相同请求：超限淘汰最旧、最近保留', async () => {
    mockCreate.mockImplementation(() => successStream())

    // 仅 requestA.path / url 不同，modelName 与 promptTemplate 保持一致 → cacheKey 互异
    const requests = Array.from({ length: 51 }, (_, i) =>
      makeCompareRequest(
        { path: `/order/distinct/${i}`, url: `https://api.example.com/order/distinct/${i}` },
        {},
      ),
    )

    // 顺序执行 51 次，每次 key 不同 → 应触发 51 次 AI 调用
    for (let i = 0; i < 51; i++) {
      await executeCompare(requests[i])
    }
    expect(mockCreate).toHaveBeenCalledTimes(51)

    // 此时缓存已满（上限 50），最旧的 requests[0] 应已被淘汰
    await executeCompare(requests[0])
    // 关键：req_0 被淘汰 → 重新拉取，AI 调用次数 +1
    expect(mockCreate).toHaveBeenCalledTimes(52)

    // requests[50] 为最后一次写入，应在缓存内 → 命中，不新拉取
    await executeCompare(requests[50])
    expect(mockCreate).toHaveBeenCalledTimes(52)
  })

  it('边界：恰好写入 50 个不同 key 全部保留，重放仍为命中（0 额外调用）', async () => {
    mockCreate.mockImplementation(() => successStream())

    const reqs = Array.from({ length: 50 }, (_, i) =>
      makeCompareRequest(
        { path: `/order/edge/${i}`, url: `https://api.example.com/order/edge/${i}` },
        {},
      ),
    )

    // 恰好达到上限 50，过程中不应发生淘汰
    for (let i = 0; i < 50; i++) {
      await executeCompare(reqs[i])
    }
    expect(mockCreate).toHaveBeenCalledTimes(50)

    // 重放最早的 reqs[0]：仍应命中缓存，不触发新 AI 调用（证明上限是 50 而非 49）
    await executeCompare(reqs[0])
    expect(mockCreate).toHaveBeenCalledTimes(50)
  })
})
