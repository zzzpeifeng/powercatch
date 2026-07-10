/**
 * AIAgentToolExecutor 专用工具单元测试（Phase 5：get_callers / get_struct_fields）
 *
 * 通过 spy 拦截内部 runRg（ripgrep 封装）与 readFile，验证：
 * - get_callers：ripgrep 反查调用方、receiver/package 消歧、maxCallers=50 截断
 * - get_struct_fields：Go struct 字段/tag 提取、一层嵌套展开、unsupported 兜底
 *
 * 运行：npx vitest run electron/services/__tests__/ai-agent-tool-executor-tools.test.ts
 */
/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIAgentToolExecutor } from '../ai-agent-tool-executor'

// 样例 Go struct（注意 tag 使用反引号，在 TS 模板字符串中需转义）
const REQ_STRUCT = `package order

type CreateOrderReq struct {
    OrderID   int64  \`json:"orderId" binding:"required"\`
    UserName  string \`json:"userName" binding:"required"\`
    Items     []Item \`json:"items"\`
    Meta      map[string]string \`json:"meta"\`
}
`

const ITEM_STRUCT = `package order

type Item struct {
    SKU   string \`json:"sku"\`
    Count int    \`json:"count"\`
}
`

const CREATE_LOCATE = 'internal/order/req.go:3:type CreateOrderReq struct {'
const ITEM_LOCATE = 'internal/order/item.go:3:type Item struct {'

// 两个调用方的 ripgrep 输出（含 -B 上下文）
const CALLER_OUTPUT = `internal/order/handler.go:10:func (h *Handler) Create() {
internal/order/handler.go:12:    svc.CreateOrder()
--
internal/order/task.go:3:func (t *Task) Run() {
internal/order/task.go:6:    svc.CreateOrder()
`

const PKG_OUTPUT = `internal/order/handler.go:1:package order
internal/order/task.go:1:package order
`

/** 生成 n 个调用方（用于 maxCallers 截断测试） */
function buildManyCallers(n: number): string {
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    lines.push(`f${i}.go:1:func F${i}() {`)
    lines.push(`f${i}.go:2:    x.CreateOrder()`)
  }
  return lines.join('\n')
}

describe('AIAgentToolExecutor 专用工具', () => {
  let executor: AIAgentToolExecutor
  let goFiles: string

  beforeEach(() => {
    executor = new AIAgentToolExecutor('/tmp/fake-repo')
    goFiles = 'internal/order/req.go\ninternal/order/item.go'
    vi.restoreAllMocks()
  })

  describe('get_callers', () => {
    it('反查调用方并返回 receiver / package 消歧', async () => {
      vi.spyOn(executor as any, 'runRg').mockImplementation(async (args: string[]) => {
        const joined = args.join(' ')
        if (joined.includes('CreateOrder')) return CALLER_OUTPUT
        if (joined.includes('package')) return PKG_OUTPUT
        return ''
      })

      const res = await executor.executeTool('get_callers', { symbol: 'CreateOrder' })
      expect(res.success).toBe(true)
      const result = res.result as any
      expect(result.symbol).toBe('CreateOrder')
      expect(result.callers).toHaveLength(2)

      const c0 = result.callers[0]
      expect(c0.file).toBe('internal/order/handler.go')
      expect(c0.line).toBe(12)
      expect(c0.functionName).toBe('Create')
      expect(c0.receiver).toBe('svc')
      expect(c0.package).toBe('order')

      const c1 = result.callers[1]
      expect(c1.file).toBe('internal/order/task.go')
      expect(c1.line).toBe(6)
      expect(c1.functionName).toBe('Run')
      expect(c1.receiver).toBe('svc')
    })

    it('调用方数量截断到 maxCallers=50', async () => {
      vi.spyOn(executor as any, 'runRg').mockImplementation(async (args: string[]) => {
        const joined = args.join(' ')
        if (joined.includes('CreateOrder')) return buildManyCallers(60)
        return ''
      })

      const res = await executor.executeTool('get_callers', { symbol: 'CreateOrder' })
      expect(res.success).toBe(true)
      const result = res.result as any
      expect(result.callers).toHaveLength(50)
    })

    it('缺少 symbol 参数时返回失败', async () => {
      const res = await executor.executeTool('get_callers', {})
      expect(res.success).toBe(false)
      expect(res.error).toContain('symbol')
    })

    it('ripgrep 不可用（ENOENT）时返回空调用方而非抛错', async () => {
      vi.spyOn(executor as any, 'runRg').mockRejectedValue(
        Object.assign(new Error('spawn rg ENOENT'), { code: 'ENOENT' }),
      )
      const res = await executor.executeTool('get_callers', { symbol: 'CreateOrder' })
      expect(res.success).toBe(true)
      expect((res.result as any).callers).toEqual([])
    })
  })

  describe('get_struct_fields', () => {
    it('提取 Go struct 字段/tag 并展开一层嵌套', async () => {
      vi.spyOn(executor as any, 'runRg').mockImplementation(async (args: string[]) => {
        const joined = args.join(' ')
        if (joined.includes('CreateOrderReq')) return CREATE_LOCATE
        if (joined.includes('Item')) return ITEM_LOCATE
        if (joined.includes('--files')) return goFiles
        return ''
      })
      vi.spyOn(executor as any, 'readFile').mockImplementation(async (p: string) => ({
        success: true,
        result: { content: p.includes('item.go') ? ITEM_STRUCT : REQ_STRUCT },
      }))

      const res = await executor.executeTool('get_struct_fields', { structName: 'CreateOrderReq' })
      expect(res.success).toBe(true)
      const result = res.result as any
      expect(result.language).toBe('go')
      expect(result.fields).toHaveLength(6)

      const orderId = result.fields.find((f: any) => f.name === 'OrderID')
      expect(orderId.type).toBe('int64')
      expect(orderId.tags.json).toBe('orderId')
      expect(orderId.tags.binding).toBe('required')

      const items = result.fields.find((f: any) => f.name === 'Items')
      expect(items.type).toBe('[]Item')

      const meta = result.fields.find((f: any) => f.name === 'Meta')
      expect(meta.type).toBe('map[string]string')

      // 一层嵌套展开：Item 的 SKU/Count 附加 nestedType='Items'
      const sku = result.fields.find((f: any) => f.name === 'SKU')
      expect(sku).toBeDefined()
      expect(sku.nestedType).toBe('Items')
      const count = result.fields.find((f: any) => f.name === 'Count')
      expect(count.nestedType).toBe('Items')
    })

    it('未检测到 Go 源文件时返回 language: unsupported + 空 fields（不抛错）', async () => {
      vi.spyOn(executor as any, 'runRg').mockImplementation(async (args: string[]) => {
        const joined = args.join(' ')
        if (joined.includes('--files')) return '' // 无 Go 文件
        return '' // locate 无匹配
      })

      const res = await executor.executeTool('get_struct_fields', { structName: 'Foo' })
      expect(res.success).toBe(true)
      const result = res.result as any
      expect(result.language).toBe('unsupported')
      expect(result.fields).toEqual([])
      expect(result.note).toContain('Go')
    })

    it('缺少 structName 参数时返回失败', async () => {
      const res = await executor.executeTool('get_struct_fields', {})
      expect(res.success).toBe(false)
      expect(res.error).toContain('structName')
    })
  })
})
