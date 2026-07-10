/**
 * code-explorer Prompt 轻档验证单元测试
 *
 * 验证 Phase1 探索 Prompt 的「启发式探索指引」改造（纯 Prompt 引导，不新增工具）：
 * - 新增关键词：searchCode / 调用方 / 结构体字段 / unsupported（或「非 Go」表述）
 * - 既有 JSON schema 标记保留：entryPoint / fullCallChain / params / respStructure
 * - 用户 Prompt 占位符正确替换
 *
 * 运行命令（仅跑本测试，避免触发已失效的 ai-analyze-service.test.ts）：
 *   npx vitest run electron/__tests__/code-explorer-prompt.test.ts
 */
/** @vitest-environment node */

import { describe, it, expect } from 'vitest'
import { loadPrompt } from '../services/prompts/prompt-loader'

describe('code-explorer Prompt 轻档验证', () => {
  describe('CODE_EXPLORER_SYSTEM 启发式指引', () => {
    const systemPrompt = loadPrompt('code-explorer-system')

    it('应包含新增启发式关键词：searchCode / 调用方 / 结构体字段 / unsupported', () => {
      // A 段调用方定位：需包含 searchCode 与 调用方
      expect(systemPrompt).toContain('searchCode')
      expect(systemPrompt).toContain('调用方')
      // B 段结构体字段提取
      expect(systemPrompt).toContain('结构体字段')
      // C 段语言范围声明：unsupported 或「非 Go」表述
      expect(systemPrompt).toMatch(/unsupported|非 Go/)
    })

    it('性能约束应强调定向检索（每轮最多 15 次工具调用）', () => {
      // D 段性能与经济性约束：明确工具调用预算，引导定向检索
      expect(systemPrompt).toContain('MAX_TOOL_CALLS=15')
    })

    it('应保留既有 JSON 输出 schema 标记（不可改动，否则下游解析崩溃）', () => {
      expect(systemPrompt).toContain('entryPoint')
      expect(systemPrompt).toContain('fullCallChain')
      expect(systemPrompt).toContain('params')
      expect(systemPrompt).toContain('respStructure')
    })
  })

  describe('CODE_EXPLORER_USER 占位符替换', () => {
    it('应能正确替换 {{METHOD}} 等占位符', () => {
      const userPrompt = loadPrompt('code-explorer-user', {
        METHOD: 'POST',
        PATH: '/x',
        BODY: '{}',
        HEADERS: '{}',
      })

      // METHOD 被替换：结果中不再含有占位符，且包含实际值
      expect(userPrompt).not.toContain('{{METHOD}}')
      expect(userPrompt).toContain('POST')
    })

    it('应保持现有占位符结构不被破坏（未传入的 {{URL}} 应原样保留）', () => {
      const userPrompt = loadPrompt('code-explorer-user', {
        METHOD: 'POST',
        PATH: '/x',
        BODY: '{}',
        HEADERS: '{}',
      })
      // URL 占位符本次未传入变量，应原样保留，证明替换逻辑只替换匹配项
      expect(userPrompt).toContain('{{URL}}')
    })
  })

  describe('常量与 .md 镜像一致性（关键段落）', () => {
    it('system 常量应包含与 .md 同源的启发式段落标记', () => {
      const systemPrompt = loadPrompt('code-explorer-system')
      // 关键段落标题在常量与 .md 中应一致
      expect(systemPrompt).toContain('启发式探索指引（利用现有 search_code 工具）')
      expect(systemPrompt).toContain('### A. 调用方定位（callers）')
      expect(systemPrompt).toContain('### B. 结构体字段提取（struct fields）')
      expect(systemPrompt).toContain('### C. 语言范围声明（重要！）')
      expect(systemPrompt).toContain('### D. 性能与经济性约束（重要！）')
    })

    it('user 常量应包含「主动使用 search_code 定位调用方与结构体定义」提醒', () => {
      const userPrompt = loadPrompt('code-explorer-user')
      expect(userPrompt).toContain('主动使用 search_code 定位调用方与结构体定义')
    })
  })
})
