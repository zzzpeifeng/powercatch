/**
 * 共享 JSON 解析工具单元测试（Phase 6：ai-parse-util）
 * 覆盖：保守清洗（代码块/截断/散文）、schema 校验不通过即不信任、退避重试默认配置。
 *
 * 运行：npx vitest run electron/services/__tests__/ai-parse-util.test.ts
 */
/** @vitest-environment node */

import { describe, it, expect } from 'vitest'
import { parseAgentJson } from '../ai-parse-util'

describe('parseAgentJson', () => {
  it('干净 JSON 解析成功并返回 ok:true', async () => {
    const res = await parseAgentJson('{"name":"x","age":1}')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toEqual({ name: 'x', age: 1 })
    }
  })

  it('剥离 ```json 代码块包裹', async () => {
    const raw = '前缀说明\n```json\n{"a":1}\n```\n后缀说明'
    const res = await parseAgentJson(raw)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toEqual({ a: 1 })
  })

  it('去除前后散文（取首 { 到末 }）', async () => {
    const raw = '这是一段散文 {"k":"v"} 还有散文 trailing'
    const res = await parseAgentJson(raw)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toEqual({ k: 'v' })
  })

  it('字段级校验不通过时返回 ok:false 且不返回 value（绝不信任）', async () => {
    const raw = '{"other":123}'
    const res = await parseAgentJson(raw, {
      validate: (v: any) => (v && v.name ? [] : ['缺少 name 字段']),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors).toContain('缺少 name 字段')
      expect((res as any).value).toBeUndefined()
    }
  })

  it('尾部逗号经极简修复且通过校验后返回 ok:true（修复结果仅在校验通过时被信任）', async () => {
    const raw = '{"name":"x",}'
    const res = await parseAgentJson(raw, {
      validate: (v: any) => (v && v.name ? [] : ['缺少 name']),
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toEqual({ name: 'x' })
  })

  it('无法解析的伪 JSON 返回 ok:false，绝不返回残缺 value', async () => {
    const raw = '{"name": }'
    const res = await parseAgentJson(raw, {
      validate: (v: any) => (v && v.name ? [] : ['缺少 name']),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors.length).toBeGreaterThan(0)
      expect((res as any).value).toBeUndefined()
    }
  })

  it('使用默认重试配置（maxAttempts=2, baseDelayMs=50）', async () => {
    // 解析成功时不应因重试产生额外耗时；此处仅验证默认参数可正常工作
    const start = Date.now()
    const res = await parseAgentJson('{"ok":true}')
    const elapsed = Date.now() - start
    expect(res.ok).toBe(true)
    // 默认配置下成功路径应在极短时间内返回（< 1s）
    expect(elapsed).toBeLessThan(1000)
  })
})
