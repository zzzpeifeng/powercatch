import { describe, it, expect } from 'vitest'
import { buildIgnoreRuleFromDiffEntry } from '../diff-engine'

describe('buildIgnoreRuleFromDiffEntry', () => {
  it('header 条目返回原样 name（大小写保持）', () => {
    expect(buildIgnoreRuleFromDiffEntry({ category: 'header', name: 'X-Request-Id' })).toBe('X-Request-Id')
    // 小写 header 名也应原样返回（applyIgnoreRules 内部按小写匹配）
    expect(buildIgnoreRuleFromDiffEntry({ category: 'header', name: 'authorization' })).toBe('authorization')
  })

  it('query 条目返回原样 name', () => {
    expect(buildIgnoreRuleFromDiffEntry({ category: 'query', name: 'signature' })).toBe('signature')
  })

  it('body 条目返回点号路径', () => {
    expect(buildIgnoreRuleFromDiffEntry({ category: 'body', path: 'data.timestamp' })).toBe('data.timestamp')
    expect(buildIgnoreRuleFromDiffEntry({ category: 'body', path: 'user.token' })).toBe('user.token')
  })

  it('缺省字段返回空串', () => {
    expect(buildIgnoreRuleFromDiffEntry({ category: 'header' })).toBe('')
    expect(buildIgnoreRuleFromDiffEntry({ category: 'body' })).toBe('')
  })

  it('名称带空白时 trim', () => {
    expect(buildIgnoreRuleFromDiffEntry({ category: 'header', name: '  X-Trace-Id  ' })).toBe('X-Trace-Id')
    expect(buildIgnoreRuleFromDiffEntry({ category: 'body', path: '  meta.flowId  ' })).toBe('meta.flowId')
  })
})
