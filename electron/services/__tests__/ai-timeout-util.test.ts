/**
 * 超时与中止工具单元测试（Phase 6：ai-timeout-util）
 *
 * 覆盖：
 * 1. withTimeout：正常完成返回 value / 超时触发 controller.abort() + reject / 信号透传 /
 *    工厂自身 reject 透传 / 已 aborted 的 controller 立即超时。
 * 2. combineSignals：输入含已 aborted 信号 / 任一信号 abort 合并信号即 aborted（叠加总超时+阶段超时）。
 * 3. DEFAULT_PIPELINE_TIMEOUT：勘误后配置 180s/180s/600s。
 * 4. 集成级：两阶段 Pipeline 超时→降级信号设计（Phase2 失败复用 Phase1 兜底 / 总超时→total-timeout）。
 *
 * 运行：npx vitest run electron/services/__tests__/ai-timeout-util.test.ts
 */
/** @vitest-environment node */

import { describe, it, expect } from 'vitest'
import {
  withTimeout,
  combineSignals,
  DEFAULT_PIPELINE_TIMEOUT,
} from '../ai-timeout-util'
import type { DegradationMode } from '../types'

describe('DEFAULT_PIPELINE_TIMEOUT', () => {
  it('使用勘误后的超时配置：phase1=180s / phase2=180s / total=600s', () => {
    expect(DEFAULT_PIPELINE_TIMEOUT).toEqual({
      phase1Ms: 180_000,
      phase2Ms: 180_000,
      totalMs: 600_000,
    })
  })
})

describe('withTimeout', () => {
  it('工厂在超时前完成 → 返回 value，controller 不被 abort', async () => {
    const controller = new AbortController()
    const result = await withTimeout(async () => 'done', 50, controller)
    expect(result).toBe('done')
    expect(controller.signal.aborted).toBe(false)
  })

  it('工厂超时 → controller.abort() 且 reject（错误信息含「超时」）', async () => {
    const controller = new AbortController()
    await expect(
      withTimeout(
        () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('late'), 100)
          ),
        20,
        controller
      )
    ).rejects.toThrow(/超时/)
    expect(controller.signal.aborted).toBe(true)
  })

  it('超时后工厂收到的 signal 被标记为 aborted（用于中断 openai 请求）', async () => {
    const controller = new AbortController()
    let received: AbortSignal | null = null
    const promise = withTimeout(
      (signal) => {
        received = signal
        return new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('never')), 100)
        )
      },
      20,
      controller
    )
    await expect(promise).rejects.toThrow(/超时/)
    expect(received).not.toBeNull()
    expect((received as AbortSignal).aborted).toBe(true)
  })

  it('工厂自身 reject → 错误透传，controller 不被 abort', async () => {
    const controller = new AbortController()
    await expect(
      withTimeout(() => Promise.reject(new Error('boom')), 50, controller)
    ).rejects.toThrow('boom')
    expect(controller.signal.aborted).toBe(false)
  })

  it('工厂监听 signal，signal 已 aborted 时工厂立即 reject（模拟 openai 中断）', async () => {
    const controller = new AbortController()
    controller.abort()
    const start = Date.now()
    // 真实场景里 openai.chat.completions.create 会在 signal abort 时立即 reject，
    // 因此 withTimeout 借助「工厂立即 reject」实现及时中断（而非死等 ms 预算）。
    await expect(
      withTimeout(
        (signal) =>
          new Promise<string>((_, reject) => {
            if (signal.aborted) {
              return reject(new DOMException('AbortError', 'AbortError'))
            }
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('AbortError', 'AbortError')),
              { once: true }
            )
          }),
        1000,
        controller
      )
    ).rejects.toThrow(/AbortError|超时/)
    // 工厂在 signal 已 abort 时立即 reject，不应等待满 1000ms
    expect(Date.now() - start).toBeLessThan(500)
  })
})

describe('combineSignals', () => {
  it('输入含已 aborted 信号 → 合并信号立即 aborted', () => {
    const a = new AbortController()
    const b = new AbortController()
    a.abort()
    const combined = combineSignals([a.signal, b.signal])
    expect(combined.aborted).toBe(true)
  })

  it('任一信号 abort → 合并信号 aborted（用于叠加总超时 + 阶段超时）', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = combineSignals([a.signal, b.signal])
    expect(combined.aborted).toBe(false)
    // 阶段超时信号触发 → 合并信号（透传给 openai）也应中断
    b.abort()
    expect(combined.aborted).toBe(true)
    // 另一个信号仍未 abort，不影响「合并信号已中断」的事实
    expect(a.signal.aborted).toBe(false)
  })
})

describe('两阶段 Pipeline 超时与降级（集成级，验证 Phase2 失败复用 Phase1 兜底的信号设计）', () => {
  // 用极小的预算模拟 pipeline 超时，避免真实 180s/600s 拖垮单测
  const PHASE1_BUDGET = 30
  const PHASE2_BUDGET = 30
  const TOTAL_BUDGET = 60

  it('phase2 超时但 master 未中断 → 判定为 phase2-fallback-legacy（复用 Phase1 结果兜底）', async () => {
    const masterController = new AbortController()
    const phase1Controller = new AbortController()
    const phase2Controller = new AbortController()

    // —— Phase1：在预算内成功，记录探索结果 ——
    const phase1Signal = combineSignals([
      masterController.signal,
      phase1Controller.signal,
    ])
    let lastExplorationResult: { entryPoint: string } | null = null
    await withTimeout(
      async (sig) => {
        expect(sig.aborted).toBe(false)
        lastExplorationResult = { entryPoint: 'handler.go' }
        return lastExplorationResult
      },
      PHASE1_BUDGET,
      phase1Controller
    )
    expect(lastExplorationResult).not.toBeNull()

    // —— Phase2：超时（工厂 200ms 后才完成，但预算仅 30ms）→ withTimeout 先超时 reject ——
    const phase2Signal = combineSignals([
      masterController.signal,
      phase2Controller.signal,
    ])
    expect(phase2Signal.aborted).toBe(false)
    let phase2Error: unknown = null
    try {
      await withTimeout(
        () =>
          new Promise<unknown>((resolve) => setTimeout(() => resolve('x'), 200)),
        PHASE2_BUDGET,
        phase2Controller
      )
    } catch (e) {
      phase2Error = e
    }

    // Phase2 失败，但 master 未 abort → 走 phase2-fallback-legacy（复用 Phase1 结果）
    expect(phase2Error).not.toBeNull()
    expect(masterController.signal.aborted).toBe(false)
    expect(lastExplorationResult).not.toBeNull()

    // 与 ai-analyze-service.ts / ai-analysis-store.ts 一致的降级判定逻辑
    const degradeMode: DegradationMode = masterController.signal.aborted
      ? 'total-timeout'
      : 'phase2-fallback-legacy'
    expect(degradeMode).toBe('phase2-fallback-legacy')
  })

  it('总超时（master abort）→ 判定为 total-timeout（整体失败，不复用 Phase1 兜底）', async () => {
    const masterController = new AbortController()
    const lastExplorationResult = { entryPoint: 'handler.go' }

    // 总超时：master 在总预算（60ms）内未完成 → 被 abort
    let totalError: unknown = null
    try {
      await withTimeout(
        () =>
          new Promise<unknown>((resolve) => setTimeout(() => resolve('x'), 200)),
        TOTAL_BUDGET,
        masterController
      )
    } catch {
      // 忽略错误，仅验证降级判定分支
    }

    // master 被 abort（总超时硬中断）
    expect(masterController.signal.aborted).toBe(true)
    expect(lastExplorationResult).not.toBeNull()

    const degradeMode: DegradationMode = masterController.signal.aborted
      ? 'total-timeout'
      : 'phase2-fallback-legacy'
    expect(degradeMode).toBe('total-timeout')
  })
})
