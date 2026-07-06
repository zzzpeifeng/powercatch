/**
 * AI 对比 Tier 2 结构化输出 - 单元测试（File B）
 *
 * 由于 export-service.ts 中 generateJson/generateHtml/generateTxt 为私有函数，
 * 本文件通过唯一导出的 exportCompareResult 间接验证三种格式均包含 diffResult，
 * 并验证「优先使用服务端 diffResult」的契约。
 *
 * 通过 vi.mock('electron') 与真实 fs 写盘 + 回读，避免真实保存对话框与 Electron 运行时依赖。
 */

import { describe, it, expect, vi } from 'vitest'
import { exportCompareResult } from '../export-service'
import type {
  CaptureRequest,
  CompareResult,
  DiffResult,
} from '../../../src/services/types'
import { computeDiff } from '../../../src/services/diff-engine'
import { readFileSync } from 'fs'

// 用 vi.hoisted 定义导出路径，确保 mock 工厂与测试共享同一常量（避免 TDZ）
const { OUTPUT_PATH } = vi.hoisted(() => ({
  OUTPUT_PATH: '/tmp/powercatch-tier2-export.out',
}))

// Mock electron 的 dialog，使其直接返回固定 filePath，避免原生保存对话框
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(async () => ({ filePath: OUTPUT_PATH })),
  },
}))

// ---------- Fixtures ----------

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
    responseBody: '{"price":100,"name":"x"}',
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
    responseBody: '{"price":200,"name":"x"}',
  }
  return { requestA, requestB }
}

function makeCompareResult(diffResult?: DiffResult): CompareResult {
  return {
    analysis: 'AI 分析文本',
    modelName: 'gpt',
    path: '/order',
    deviceA: { name: 'DeviceA', ip: '10.0.0.1' },
    deviceB: { name: 'DeviceB', ip: '10.0.0.2' },
    isStreaming: false,
    diffResult,
  }
}

// 带唯一标记的服务端 diffResult（若导出用了它，产物必含标记）
function makeMarkerDiff(): DiffResult {
  return {
    overview: {
      same: [],
      different: ['__TIER2_MARKER__'],
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

// ---------- Tests ----------

describe('Tier2 - 导出含 diffResult', () => {
  it('JSON：产物含 diffResult 字段且 diffResult.overview 存在', async () => {
    const { requestA, requestB } = makeCaptureRequest()
    const diff = computeDiff(requestA, requestB)
    const result = await exportCompareResult('json', makeCompareResult(diff), requestA, requestB)

    expect(result.success).toBe(true)
    const content = readFileSync(OUTPUT_PATH, 'utf-8')
    const data = JSON.parse(content)
    expect(data.diffResult).toBeDefined()
    expect(data.diffResult.overview).toBeDefined()
    // 与传入 diff 一致（单一数据源）
    expect(data.diffResult).toEqual(diff)
  })

  it('HTML：产物含「结构化差异（DiffResult）」且含 exportDiffAsHtml 输出', async () => {
    const { requestA, requestB } = makeCaptureRequest()
    const diff = computeDiff(requestA, requestB)
    const result = await exportCompareResult('html', makeCompareResult(diff), requestA, requestB)

    expect(result.success).toBe(true)
    const content = readFileSync(OUTPUT_PATH, 'utf-8')
    expect(content).toContain('结构化差异（DiffResult）')
    // exportDiffAsHtml 产出以「Diff 对比报告」标题开头
    expect(content).toContain('Diff 对比报告')
  })

  it('TXT：产物含「结构化差异（DiffResult）」且含 markdown 差异内容', async () => {
    const { requestA, requestB } = makeCaptureRequest()
    const diff = computeDiff(requestA, requestB)
    const result = await exportCompareResult('txt', makeCompareResult(diff), requestA, requestB)

    expect(result.success).toBe(true)
    const content = readFileSync(OUTPUT_PATH, 'utf-8')
    expect(content).toContain('结构化差异（DiffResult）')
    // exportDiffAsMarkdown 产出以「# Diff 对比报告」开头
    expect(content).toContain('Diff 对比报告')
  })
})

describe('Tier2 - 优先使用服务端 diffResult', () => {
  it('exportCompareResult 用 compareResult.diffResult（含 __TIER2_MARKER__），而非本地重算', async () => {
    const { requestA, requestB } = makeCaptureRequest()
    // requestA/requestB 本身存在差异（若重算则不会含标记）
    const result = await exportCompareResult('json', makeCompareResult(makeMarkerDiff()), requestA, requestB)

    expect(result.success).toBe(true)
    const content = readFileSync(OUTPUT_PATH, 'utf-8')
    const data = JSON.parse(content)
    // 标记出现 => 用了服务端传入的 diffResult，而非 computeDiff(requestA, requestB)
    expect(data.diffResult.overview.different).toContain('__TIER2_MARKER__')
  })
})
