/**
 * 超时与中止工具（Phase 6 工程健壮性）
 *
 * 与 AIAgentToolExecutor.withTimeout（promise-race 版，无 AbortSignal）相互独立，
 * 避免命名/实现冲突。本模块基于 AbortController，提供「硬超时 + 信号透传」。
 */
import type { PipelineTimeoutConfig } from './types'

/** 默认 Pipeline 超时配置（毫秒）：phase1=180s / phase2=180s / total=600s */
export const DEFAULT_PIPELINE_TIMEOUT: PipelineTimeoutConfig = {
  phase1Ms: 180_000,
  phase2Ms: 180_000,
  totalMs: 600_000,
}

/**
 * 合并多个 AbortSignal：任一信号 aborted 时，返回的 signal 也 aborted。
 * 用于把「总超时」与「阶段超时」信号叠加后透传给 openai 调用。
 */
export function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort()
      return controller.signal
    }
    sig.addEventListener(
      'abort',
      () => {
        if (!controller.signal.aborted) {
          controller.abort()
        }
      },
      { once: true }
    )
  }
  return controller.signal
}

/**
 * 带硬超时的 Promise 执行器
 * @param promiseFactory 接收 AbortSignal 的工厂函数（signal 透传给底层调用，如 openai.chat.completions.create）
 * @param ms 超时毫秒数
 * @param controller 共享 AbortController；超时时调用 controller.abort() 并 reject
 */
export async function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  controller: AbortController
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort()
      }
      reject(new Error(`分析超时（${ms}ms），已中断`))
    }, ms)
  })

  try {
    return await Promise.race([promiseFactory(controller.signal), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
