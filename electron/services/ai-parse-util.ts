/**
 * 共享 JSON 解析工具（Phase 6 工程健壮性）
 *
 * 设计原则：
 * 1. 保守清洗：仅剥离 ```json 代码块包裹 + 取首 `{` 到末 `}` 之间的内容（去除前后散文 prose）。
 * 2. 不信任修复结果：即使经过 minimalRepair 修复/截断，也必须通过 validate 校验，
 *    否则返回 { ok: false }，绝不返回可能语义残缺的 value。
 * 3. 退避重试：解析/修复失败时按 baseDelayMs * 2^(attempt-1) 退避重试（默认 2 次）。
 */
import type { ParseRetryConfig, ParseResult } from './types'

/** 默认重试配置 */
const DEFAULT_RETRY_CONFIG: ParseRetryConfig = {
  maxAttempts: 2,
  baseDelayMs: 50,
}

/** Promise 延迟 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 保守清洗：从原始文本中提取最可能是 JSON 对象的子串。
 * 仅做两件安全的事：去 ```json 包裹 + 取首 `{` 到末 `}` 之间。
 */
function conservativeClean(raw: string): string | null {
  if (!raw) return null
  let s = raw.trim()

  // 1) 去除 ```json ... ``` 代码块包裹
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    s = fenceMatch[1].trim()
  }

  // 2) 去除前后散文：取第一个 { 到最后一个 } 之间
  const firstBrace = s.indexOf('{')
  const lastBrace = s.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null
  }
  return s.substring(firstBrace, lastBrace + 1)
}

/**
 * 最后手段的极简修复：仅去除尾随逗号（trailing comma）。
 * 注意：这是「不信任」的兜底，使用结果仍必须通过 validate 校验。
 */
function minimalRepair(jsonStr: string): string {
  return jsonStr.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * 解析 Agent 输出的 JSON
 * @param raw 原始文本
 * @param config 重试与校验配置（可选）
 * @returns ParseResult：ok=false 时绝不返回 value
 */
export async function parseAgentJson<T = unknown>(
  raw: string,
  config?: ParseRetryConfig
): Promise<ParseResult<T>> {
  const cfg: ParseRetryConfig = { ...DEFAULT_RETRY_CONFIG, ...(config || {}) }
  const validate = cfg.validate ?? (() => [] as string[])

  let lastErrors: string[] = []
  let cleaned = conservativeClean(raw)

  const attempts = Math.max(1, cfg.maxAttempts)
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      // 退避重试
      await delay(cfg.baseDelayMs * Math.pow(2, attempt - 1))
    }

    if (!cleaned) {
      cleaned = conservativeClean(raw)
    }
    if (!cleaned) {
      lastErrors = ['无法从输入中提取 JSON']
      continue
    }

    try {
      const value = JSON.parse(cleaned) as T
      const errors = validate(value)
      if (errors.length === 0) {
        return { ok: true, value }
      }
      lastErrors = errors
    } catch (e: any) {
      lastErrors = [e?.message || 'JSON 解析失败']

      // 最后手段修复仅在本轮使用一次，仍不信任：必须 validate 通过
      const repaired = minimalRepair(cleaned)
      if (repaired !== cleaned) {
        try {
          const value = JSON.parse(repaired) as T
          const errors = validate(value)
          if (errors.length === 0) {
            return { ok: true, value }
          }
          lastErrors = errors
        } catch (e2: any) {
          lastErrors = [e2?.message || 'JSON 修复后仍解析失败']
        }
      }
    }
  }

  return {
    ok: false,
    errors: lastErrors.length ? lastErrors : ['无法提取 JSON'],
    raw,
  }
}
