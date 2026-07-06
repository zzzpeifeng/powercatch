/**
 * throttle-core 纯函数单元测试
 * 不依赖 electron，直接验证节流判定与延迟调度逻辑。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  matchDomain,
  shouldThrottle,
  applyRequestDelay,
  applyResponseDelay,
} from '../throttle-core'
import type { ThrottleConfig } from '../../src/services/types'

function makeConfig(overrides: Partial<ThrottleConfig> = {}): ThrottleConfig {
  return {
    enabled: true,
    preset: 'custom',
    requestDelay: 0,
    responseDelay: 0,
    domainFilter: [],
    offlineMode: false,
    ...overrides,
  }
}

describe('matchDomain', () => {
  it('空过滤器匹配所有域名', () => {
    expect(matchDomain('example.com', [])).toBe(true)
    expect(matchDomain('', [])).toBe(true)
  })

  it('精确匹配区分大小写', () => {
    expect(matchDomain('Example.com', ['example.com'])).toBe(false)
    expect(matchDomain('example.com', ['example.com'])).toBe(true)
  })

  it('精确匹配不匹配不同域名', () => {
    expect(matchDomain('api.example.com', ['example.com'])).toBe(false)
  })

  it('通配符 * 匹配子域名（不含 apex 域名）', () => {
    expect(matchDomain('api.example.com', ['*.example.com'])).toBe(true)
    expect(matchDomain('a.b.example.com', ['*.example.com'])).toBe(true)
    expect(matchDomain('example.com', ['*.example.com'])).toBe(false)
    expect(matchDomain('evil.com', ['*.example.com'])).toBe(false)
  })

  it('OR 匹配：命中任一规则即返回 true', () => {
    expect(matchDomain('a.com', ['a.com', 'b.com'])).toBe(true)
    expect(matchDomain('b.com', ['a.com', 'b.com'])).toBe(true)
    expect(matchDomain('c.com', ['a.com', 'b.com'])).toBe(false)
  })
})

describe('shouldThrottle', () => {
  it('未启用时一律不节流', () => {
    const cfg = makeConfig({ enabled: false, domainFilter: ['example.com'] })
    expect(shouldThrottle('example.com', cfg)).toBe(false)
    expect(shouldThrottle('anything.com', cfg)).toBe(false)
  })

  it('启用且域名过滤为空 → 全部节流', () => {
    const cfg = makeConfig({ enabled: true, domainFilter: [] })
    expect(shouldThrottle('example.com', cfg)).toBe(true)
    expect(shouldThrottle('foo.bar', cfg)).toBe(true)
  })

  it('启用且命中域名过滤 → 节流', () => {
    const cfg = makeConfig({ enabled: true, domainFilter: ['example.com', '*.test.com'] })
    expect(shouldThrottle('example.com', cfg)).toBe(true)
    expect(shouldThrottle('api.test.com', cfg)).toBe(true)
  })

  it('启用但未命中域名过滤 → 不节流', () => {
    const cfg = makeConfig({ enabled: true, domainFilter: ['example.com'] })
    expect(shouldThrottle('other.com', cfg)).toBe(false)
  })
})

describe('applyRequestDelay', () => {
  it('延迟 > 0 时通过注入的 scheduler 调度回调（不立即执行）', () => {
    const scheduled: Array<() => void> = []
    const scheduler = (fn: () => void) => {
      scheduled.push(fn)
      return 0 as unknown as NodeJS.Timeout
    }
    let ran = false
    applyRequestDelay(
      () => {
        ran = true
      },
      makeConfig({ requestDelay: 200 }),
      scheduler,
    )
    expect(scheduled.length).toBe(1)
    expect(ran).toBe(false)
    // 触发调度
    scheduled[0]()
    expect(ran).toBe(true)
  })

  it('延迟 <= 0 时立即执行回调，不调度', () => {
    const scheduler = vi.fn()
    let ran = false
    applyRequestDelay(
      () => {
        ran = true
      },
      makeConfig({ requestDelay: 0 }),
      scheduler,
    )
    expect(ran).toBe(true)
    expect(scheduler).not.toHaveBeenCalled()
  })

  it('默认 scheduler 使用 setTimeout（延迟>0 异步执行）', () => {
    vi.useFakeTimers()
    let ran = false
    applyRequestDelay(
      () => {
        ran = true
      },
      makeConfig({ requestDelay: 150 }),
    )
    expect(ran).toBe(false)
    vi.advanceTimersByTime(150)
    expect(ran).toBe(true)
    vi.useRealTimers()
  })
})

describe('applyResponseDelay', () => {
  it('延迟 > 0 时通过 scheduler 调度回调', () => {
    const scheduled: Array<() => void> = []
    const scheduler = (fn: () => void) => {
      scheduled.push(fn)
      return 0 as unknown as NodeJS.Timeout
    }
    let ran = false
    applyResponseDelay(
      () => {
        ran = true
      },
      makeConfig({ responseDelay: 300 }),
      scheduler,
    )
    expect(scheduled.length).toBe(1)
    expect(ran).toBe(false)
    scheduled[0]()
    expect(ran).toBe(true)
  })

  it('延迟 <= 0 时立即执行', () => {
    const scheduler = vi.fn()
    let ran = false
    applyResponseDelay(
      () => {
        ran = true
      },
      makeConfig({ responseDelay: 0 }),
      scheduler,
    )
    expect(ran).toBe(true)
    expect(scheduler).not.toHaveBeenCalled()
  })
})
