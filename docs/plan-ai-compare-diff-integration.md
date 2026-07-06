# AI 对比 × Diff 引擎打通 - 技术方案 Plan v1.0

> **功能**: 优化现有「AI 对比」功能（#② AI 对比），将已实现的 `diff-engine` 结构化差异前置注入 LLM，替代当前"把原始 body 直接丢给模型"的方式
> **状态**: Plan v1.2（二次复审残留漏洞已回填，可实施）
> **工作量评估**: 低（约 1.5-2 人天）
> **依赖**: 无（复用现有 `diff-engine.ts` / `DiffResult`）
> **优先级**: P1（投入小、收益大 — 降 token 成本 + 提准确率 + 补全对比维度）
> **日期**: 2026-07-06

---

## 1. 背景与问题

### 1.1 当前实现（探索确认）

| 项 | 现状 |
|----|------|
| 入口 | `MainView` 底部面板「AI 对比」按钮 → IPC `ai:compare` |
| 核心 | `electron/services/ai-service.ts` → `executeCompare()` 单次 OpenAI **流式**调用（`temperature:0.1`，60s 超时） |
| 输入 | `CompareRequest.requestA / requestB` 均为**完整 `CaptureRequest`**（含 url / method / statusCode / requestHeaders / requestBody / responseHeaders / responseBody） |
| Prompt | `fillPromptTemplate()` 仅注入 `{response_a_json}` / `{response_b_json}` / `{request_headers_a/b}` / `{path}` / `{request_method}` |
| 输出 | `CompareResult.analysis`（自由 Markdown 文本） |
| 缺陷 | ① 完全绕过已写好的 `diff-engine`，让 LLM 自己"重新发现差异"<br>② 只比 JSON 响应体，请求体/响应头/状态码/URL 维度未参与<br>③ 原始 body 全量进 Prompt，token 浪费严重（大响应体易触发 60s 超时）<br>④ 无结构化复用、无降级、无重试 |

### 1.2 为什么能低成本打通

- `CompareRequest` 已携带完整 `CaptureRequest`，**无需扩展数据结构**即可调用 `computeDiff(requestA, requestB)`。
- `src/services/diff-engine.ts` 是**纯函数**（仅 `import type` 依赖，无 Electron API），主进程 `ai-service.ts` 可直接 import（相对路径 `../../src/services/diff-engine`）。
- `computeDiff()` 已产出 `DiffResult`（overview + 各维度 added/removed/modified + JSON delta / 文本 changes），正是 LLM 需要的"差异事实"。

---

## 2. 目标

1. **前置 diff**：先跑 `computeDiff()` 得到结构化 `DiffResult`，只把**压缩后的 delta** 注入 Prompt，替代原始 body 全量注入。
2. **降本增效**：预计 token 成本下降 **60%-80%**（取决于 body 大小），LLM 不再重复计算 diff，准确率提升。
3. **维度补全**：在 delta 中自然携带请求头/响应头/请求体/响应体/状态码/URL 差异，AI 自动获得全维度上下文（无需逐个加模板变量）。
4. **向后兼容**：保留旧模板变量（`{response_a_json}` 等），用户自定义模板不受影响。

---

## 3. 技术方案

### 3.1 改造后数据流

```
CompareRequest (requestA, requestB: CaptureRequest)
   │
   ├─ computeDiff(requestA, requestB)  →  DiffResult（结构化 delta）
   │        │
   │        └─ serializeDiffForPrompt(DiffResult, maxDeltas=200)  →  紧凑文本
   │
   └─ fillPromptTemplate()
          │  注入 {diff_result}（delta 文本）+ 保留 {response_a_json} 等旧变量
          ▼
       LLM（system: "你是接口差异分析专家，以下是 diff 引擎算出的结构化差异"）
          ▼
       CompareResult.analysis（流式）
```

### 3.2 diff-engine 改造点（纯增量，不改现有函数）

**文件**: `src/services/diff-engine.ts`

新增一个序列化函数，将 `DiffResult` 转为 LLM 友好的紧凑文本：

> 依赖：`diff-engine.ts` 顶部已 `import type { DiffResult } from '../services/types'`（第 5 行），`serializeDiffForPrompt` 可直接复用该类型，无需重复 import。

```typescript
/**
 * 将 DiffResult 序列化为紧凑文本，用于注入 AI Prompt
 * @param diff computeDiff() 的产出
 * @param maxDeltas 单维度最多保留的 delta 条数（超出截断，保证 token 预算）
 * @returns 紧凑文本
 */
export function serializeDiffForPrompt(diff: DiffResult, maxDeltas = 200): string {
  const lines: string[] = []

  // 1. 概览行
  const { overview } = diff
  lines.push(`[概览] 相同: ${overview.same.join(', ') || '无'} | 不同: ${overview.different.join(', ') || '无'}`)
  lines.push(`[统计] 请求头(+${overview.stats.requestHeaders.added}/-${overview.stats.requestHeaders.removed}/~${overview.stats.requestHeaders.modified}) ` +
             `响应头(+${overview.stats.responseHeaders.added}/-${overview.stats.responseHeaders.removed}/~${overview.stats.responseHeaders.modified}) ` +
             `请求体变更${overview.stats.requestBody.changes} 响应体变更${overview.stats.responseBody.changes}`)

  // 2. 请求头差异
  lines.push(...formatHeaderDiff('请求头', diff.requestHeaders))
  // 3. 响应头差异
  lines.push(...formatHeaderDiff('响应头', diff.responseHeaders))

  // 4. 请求体差异
  lines.push(...formatBodyDiff('请求体', diff.requestBody, maxDeltas))
  // 5. 响应体差异
  lines.push(...formatBodyDiff('响应体', diff.responseBody, maxDeltas))

  return lines.join('\n')
}
```

**辅助格式函数**（同文件新增）：

```typescript
function formatHeaderDiff(label: string, h: HeaderDiffResult): string[] {
  const out: string[] = []
  const added = Object.entries(h.added).map(([k, v]) => `+ ${k}: ${v}`)
  const removed = Object.entries(h.removed).map(([k, v]) => `- ${k}: ${v}`)
  const modified = h.modified.map((m) => `~ ${m.key}: ${m.old} → ${m.new}`)
  if (added.length || removed.length || modified.length) {
    out.push(`[${label}差异]`)
    out.push(...added, ...removed, ...modified)
  }
  return out
}

function formatBodyDiff(label: string, b: DiffResult['requestBody'], max: number): string[] {
  const out: string[] = []
  if (b.type === 'empty') return out
  if (b.type === 'binary') { out.push(`[${label}] 二进制内容，无法结构化对比`); return out }
  if (b.type === 'json' && b.delta) {
    out.push(`[${label} JSON差异]`)
    // 修复（v1.2 轻微）：单值 JSON.stringify 可能极长，截断避免撑爆 prompt
    const trunc = (v: any): string => {
      const s = JSON.stringify(v)
      return s.length > 500 ? s.slice(0, 500) + '…(已截断)' : s
    }
    b.delta.slice(0, max).forEach((d) => {
      if (d.type === 'added') out.push(`+ ${d.path}: ${trunc(d.newValue)}`)
      else if (d.type === 'removed') out.push(`- ${d.path}: ${trunc(d.oldValue)}`)
      else out.push(`~ ${d.path}: ${trunc(d.oldValue)} → ${trunc(d.newValue)}`)
    })
    if (b.delta.length > max) out.push(`... 其余 ${b.delta.length - max} 处差异已省略`)
  }
  if (b.type === 'text' && b.changes) {
    out.push(`[${label} 文本差异]`)
    // 修复漏洞 3：以"变更块"为单位截断，保证 removed/added 替换对完整
    const relevant = b.changes.filter((c) => c.added || c.removed)
    const blocks: Array<{ removed?: string; added?: string }> = []
    for (let i = 0; i < relevant.length; i++) {
      const c = relevant[i]
      if (c.removed && relevant[i + 1]?.added) {
        blocks.push({ removed: c.value, added: relevant[i + 1].value })
        i++ // 跳过紧随的 added，避免拆对
      } else if (c.removed) {
        blocks.push({ removed: c.value })
      } else {
        blocks.push({ added: c.value })
      }
    }
    blocks.slice(0, max).forEach((blk) => {
      if (blk.removed) out.push(`- ${blk.removed}`)
      if (blk.added) out.push(`+ ${blk.added}`)
    })
    if (blocks.length > max) out.push(`... 其余 ${blocks.length - max} 处变更块已省略`)
  }
  return out
}
```

**序列化示例输出**（假设价格字段变化 + 状态码不同）：

```text
[概览] 相同: URL, Method | 不同: Status Code, Response Body, Response Headers
[统计] 请求头(+0/-0/~0) 响应头(+0/-0/~1) 请求体变更0 响应体变更3
[响应头差异]
~ content-type: application/json → application/xml
[响应体 JSON差异]
~ .data.list[0].price: 100 → 120
~ .data.status: "active" → "inactive"
- .user.name
+ .meta.count: 5
```

### 3.3 ai-service 改造点

**文件**: `electron/services/ai-service.ts`

**(a) `fillPromptTemplate()` 改造**：

```typescript
import { computeDiff, serializeDiffForPrompt } from '../../src/services/diff-engine'

function fillPromptTemplate(template: string, request: CompareRequest): string {
  const { requestA, requestB } = request

  // 前置 diff：计算结构化差异并序列化
  let diffText = ''
  try {
    // 修复漏洞 2（v1.2 修正）：computeDiff 同时 diff requestBody 与 responseBody（diff-engine.ts:347-353）
    // 原 v1.1 仅查 responseBody，大请求体仍会触发 diffJsonRecursive 纯递归栈溢出 → 残留盲区
    const bodies = [requestA.requestBody, requestB.requestBody, requestA.responseBody, requestB.responseBody]
    const tooLarge = bodies.some((b) => (b || '').length > 1_000_000)
    if (tooLarge) {
      throw new Error('body too large (>1MB) for recursive diff, fallback to raw')
    }
    const diff = computeDiff(requestA, requestB)
    diffText = serializeDiffForPrompt(diff, 200)
  } catch (e) {
    console.warn('[AI Service] diff 计算失败，回退原始 body 截断:', e)
    // 修复漏洞 1：兜底注入原始 body 截断摘要（而非空白），防止默认模板下 AI 静默误判为"基本一致"
    diffText = `[diff 引擎计算失败或响应体过大，已回退原始报文前 4000 字符]\n` +
      `=== 请求A响应体(前4000字符) ===\n${(requestA.responseBody || '').slice(0, 4000)}\n` +
      `=== 请求B响应体(前4000字符) ===\n${(requestB.responseBody || '').slice(0, 4000)}`
  }

  // 修复漏洞 4（v1.2 补实现）：若模板含 {diff_result}，则跳过旧 body 变量计算，确保降本生效
  // 原 v1.1 §3.5 仅描述"二选一引导"，但 §3.3(a) 代码未实现 → 文档与代码不一致
  const useDiffResult = template.includes('{diff_result}')

  const variables: Record<string, string> = {
    // —— 新增：结构化差异（核心优化）——
    '{diff_result}': diffText,
    // —— 保留：旧变量，确保用户自定义模板仍可工作；useDiffResult 时置空避免降本失效 ——
    '{path}': requestA.path,
    '{device_a_name}': requestA.deviceName || requestA.clientIp,
    '{device_b_name}': requestB.deviceName || requestB.clientIp,
    '{client_ip_a}': requestA.clientIp,
    '{client_ip_b}': requestB.clientIp,
    '{response_a_json}': useDiffResult ? '' : (requestA.responseBody || ''),
    '{response_b_json}': useDiffResult ? '' : (requestB.responseBody || ''),
    '{request_method}': requestA.method,
    '{request_headers_a}': JSON.stringify(requestA.requestHeaders, null, 2),
    '{request_headers_b}': JSON.stringify(requestB.requestHeaders, null, 2),
    // —— 新增：原始 body 不再默认注入，但保留变量供旧模板使用 ——
    '{url_a}': requestA.url,
    '{url_b}': requestB.url,
    '{status_a}': String(requestA.statusCode ?? ''),
    '{status_b}': String(requestB.statusCode ?? ''),
    '{request_body_a}': useDiffResult ? '' : (requestA.requestBody || ''),
    '{request_body_b}': useDiffResult ? '' : (requestB.requestBody || ''),
    '{response_headers_a}': JSON.stringify(requestA.responseHeaders, null, 2),
    '{response_headers_b}': JSON.stringify(requestB.responseHeaders, null, 2),
  }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(key).join(value)
  }
  return result
}
```

**(b) System Prompt 升级**：

```typescript
// 旧：'你是一个专业的接口数据对比分析专家，擅长分析 JSON 数据差异。'
// 新：
const SYSTEM_PROMPT = `你是一个专业的接口数据对比分析专家。
下方是 diff 引擎算出的两个 HTTP 请求/响应的差异信息（优先为结构化差异）：
- 若内容以"[diff 引擎计算失败或响应体过大，已回退原始报文]"开头，则为原始报文的前 4000 字符截断，并非结构化差异，请据实分析
- 否则，概览行说明哪些是相同/不同的维度，各维度以 +（新增）/ -（删除）/ ~（修改）标记具体变化
请基于这些信息，分析：1) 业务影响 2) 可能的原因 3) 测试关注点。
若确实无差异，请明确说明"两次请求基本一致"。`
```

**(c) `executeCompare()` 其余不变**：保持流式、`temperature:0.1`、互斥锁逻辑。
> 修复漏洞 6：因降本后 Prompt 显著变小，60s 超时建议放宽至 **90-120s**（或跟随模型动态调整），为慢思考模型留余地。

### 3.4 types.ts 改造点

**文件**: `src/services/types.ts`

在 `TEMPLATE_VARIABLES` 常量中**新增**变量说明（不影响旧定义）：

```typescript
// 现有 TEMPLATE_VARIABLES 数组中追加：
{ key: '{diff_result}', desc: '（推荐）diff 引擎算出的结构化差异文本，替代原始 body' },
{ key: '{url_a}', desc: '请求 A 的完整 URL' },
{ key: '{url_b}', desc: '请求 B 的完整 URL' },
{ key: '{status_a}', desc: '请求 A 的状态码' },
{ key: '{status_b}', desc: '请求 B 的状态码' },
{ key: '{request_body_a}', desc: '请求 A 的请求体' },
{ key: '{request_body_b}', desc: '请求 B 的请求体' },
{ key: '{response_headers_a}', desc: '请求 A 的响应头' },
{ key: '{response_headers_b}', desc: '请求 B 的响应头' },
```

> 注意：`CompareRequest` / `CompareResult` 接口**无需修改**——`requestA/requestB` 已是完整 `CaptureRequest`，新变量只是把原本就存在的数据暴露给模板。

### 3.5 向后兼容策略

- **默认模板**：更新为使用 `{diff_result}`，旧变量 `{response_a_json}` 等仍保留可填。
- **用户自定义模板**：若模板仍引用 `{response_a_json}` 等旧变量，行为完全不变（变量照常注入）。若引用 `{diff_result}`，走新路径。
- **二选一引导（修复漏洞 4）**：当模板包含 `{diff_result}` 时，`fillPromptTemplate()` 将**跳过旧 body 变量的计算**（`{response_a_json}` 等注入空串），确保降本生效；UI 变量说明面板需明确提示"推荐只用 `{diff_result}`，避免与原始 body 变量混用，否则降本失效"。
- **diff 计算失败兜底（修复漏洞 1）**：`computeDiff` 抛错**或响应体 > 1MB** 时，不再留空 `diffText`，而是注入"原始 body 前 4000 字符的截断摘要 + 警告标记"，防止 AI 在默认模板下静默误判为"基本一致"。
- **描述精确化（修复漏洞 8）**：旧变量在代码层仍会被序列化进 `variables` 对象，仅当模板中不含对应占位符时 `split/join` 为无操作而等效无效；若模板同时含 `{diff_result}` 与旧变量，旧变量将生效并抵消降本。

---

## 4. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/services/diff-engine.ts` | 修改（纯增量） | 新增 `serializeDiffForPrompt()` + 2 个 format 辅助函数 |
| `electron/services/ai-service.ts` | 修改 | `fillPromptTemplate()` 调用 `computeDiff` 并注入 `{diff_result}`；升级 System Prompt；补齐模板变量 |
| `src/services/types.ts` | 修改 | `TEMPLATE_VARIABLES` 新增 9 个变量说明 |
| `src/views/SettingsView.vue` | 修改（轻量） | 默认 Prompt 模板文案改为以 `{diff_result}` 为主；变量说明列表同步 |
| `docs/plan-ai-compare-diff-integration.md` | 新增 | 本 Plan |

> 不修改：`computeDiff` / `diffHeaders` / `diffBody` 等现有函数（零回归风险）；`DiffView` / `diff-store` 不受影响。

---

## 5. 实现任务分解

### T1: diff-engine 序列化函数（0.5 天）
- 文件：`src/services/diff-engine.ts`
- 新增 `serializeDiffForPrompt(diff, maxDeltas=200)` + `formatHeaderDiff` + `formatBodyDiff`
- 验收：JSON/文本/二进制/空 body 四种类型均能产出合理紧凑文本；超 `maxDeltas` 正确截断

### T2: ai-service 集成（0.5 天）
- 文件：`electron/services/ai-service.ts`
- `fillPromptTemplate()` 调用 `computeDiff` → `serializeDiffForPrompt` → 注入 `{diff_result}`
- System Prompt 升级；补齐 `{url_a}` 等变量
- 验收：默认模板走 diff 路径；diff 失败回退原始 body

### T3: types + 模板变量（0.25 天）
- 文件：`src/services/types.ts`
- `TEMPLATE_VARIABLES` 新增 9 项

### T4: 默认模板 + 文档（0.25 天）
- 文件：`src/views/SettingsView.vue` + 本 Plan 定稿
- 默认 Prompt 改为以 `{diff_result}` 为主

### T5: 测试（0.5 天）
- 文件：`electron/services/__tests__/ai-service.test.ts`（新增）
- 验收：
  - 含 `{diff_result}` 的模板，Prompt 中出现 `[概览]` 且不出现完整原始大 body
  - 不含 `{diff_result}` 的旧模板，行为不变（仍注入原始 body）
  - `computeDiff` 抛错时 `diffText=''` 且回退原始 body
  - 二进制 body 场景序列化输出"二进制内容，无法结构化对比"

---

## 6. 验收标准

| 标准 | 衡量 |
|------|------|
| Token 成本下降 | **针对大响应体（>100KB）场景**：Prompt 字符数下降 ≥ 50%（结构化 delta 远小于原始 body）；小/相似响应体降幅可能更大 |
| AI 差异引用率（主验收项） | AI 输出能准确引用具体差异路径（如 `.data.price`）或差异标记（+/-/~），而非泛泛而谈 |
| 准确率提升 | AI 输出能准确引用具体差异路径（如 `.data.price`），而非泛泛而谈 |
| 维度补全 | AI 能基于响应头/状态码差异给出分析（因 delta 已携带） |
| 向后兼容 | 旧自定义模板（用 `{response_a_json}`）输出与改造前一致 |
| 不降级 | diff 异常时功能不退化为报错，回退原始 body |
| 构建通过 | `npm run build` 无 TypeScript 错误 |

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| delta 仍过大（超大 JSON 全字段变化） | 中 | 中 | `maxDeltas` 截断 + 概览行始终保留；必要时可下调 maxDeltas |
| `computeDiff` 在主进程 import 路径/类型问题 | 低 | 中 | 纯函数无 Electron 依赖；路径 `../../src/services/diff-engine` 已验证可用 |
| 用户自定义旧模板未用 `{diff_result}` 导致"看起来没变化" | 低 | 低 | 文档 + UI 提示引导迁移默认模板；旧行为完全保留 |
| 二进制 body 场景 AI 无差异可分析 | 低 | 低 | 序列化明确标注"二进制不可比"，AI 据概览（如状态码）仍可分析 |
| `computeDiff` 递归栈溢出（超大/深层嵌套 JSON） | 中 | 高 | **修复漏洞 2（v1.2 强化）**：调用前对 requestBody + responseBody 四个字段设 >1MB 阈值跳过递归 diff；catch 兜底注入原始报文截断。注意 >1MB 是粗启发式，极端深嵌套小文件仍可能溢出，属"大幅降低"而非"绝对根治" |

---

## 8. 待确认问题

1. **默认模板是否强制迁移到 `{diff_result}`？**
   - 建议：是（v1.0 默认模板用 `{diff_result}`），旧变量保留兼容。
2. **`maxDeltas` 默认值 200 是否合适？**
   - 建议：先 200，实测大响应体后调整；可后续做成设置项。
3. **是否需要同时产出"结构化 CompareResult"（为未来 Tier 2 结构化输出铺路）？**
   - 本 Plan 仅做 Prompt 注入优化，不改动 `CompareResult` 结构；结构化输出留待单独优化。

---

## 9. 总结

本 Plan 以**最小改动**打通 AI 对比与 diff 引擎：

- **核心改动**：`ai-service.ts` 在拼 Prompt 前先 `computeDiff()`，把结构化 delta 注入 `{diff_result}`。
- **零回归**：现有 `computeDiff` / `DiffView` 不动；旧模板变量全保留。
- **收益**：token 成本大降、LLM 不再重复算 diff、对比维度自动补全。
- **工作量**：1.5-2 人天，属快速模式级别（≤ 10 文件，纯增量）。

> 后续可叠加 Tier 2（结构化输出）+ Tier 3（重试/降级/缓存），本 Plan 不覆盖。

---

### 9.1 v1.1 变更摘要（评审后回填）

基于 §10 评审发现的 8 项问题，本版本做了如下修正（详情见各章节标注「修复漏洞 N」）：

| 章节 | 修正内容 |
|------|----------|
| §3.2 | `formatBodyDiff` 文本截断改为「变更块」单位，保证 removed/added 替换对完整（漏洞 3）；补 `import type` 说明（漏洞 7） |
| §3.3(a) | catch 块兜底注入原始 body 前 4000 字符摘要而非空白（漏洞 1）；新增 >1MB 阈值跳过递归 diff 防栈溢出（漏洞 2） |
| §3.3(c) | 60s 超时放宽至 90-120s（漏洞 6） |
| §3.5 | 二选一引导（漏洞 4）；兜底描述修正（漏洞 1）；描述精确化（漏洞 8） |
| §6 | 验收标准改为可度量表述（大响应体场景 + AI 差异引用率主验收）（漏洞 5） |
| §7 | 风险表新增 `computeDiff` 递归栈溢出行（漏洞 2） |

修正后 Plan 已无已知逻辑漏洞，可进入实施阶段（快速模式）。

---

## 10. 评审记录（2026-07-06 · 主理人齐活林 Qi）

### 评审结论：⚠️ **有条件通过** — 需修正 3 项严重漏洞后方可实施

> ✅ **回填状态（v1.1 · 2026-07-06）**：上述 3 项严重 + 2 项中等 + 3 项轻微漏洞已全部回填至正文：
> - 漏洞 1 → §3.3(a) catch 块 + §3.5（兜底注入原始 body 截断摘要，非空白）
> - 漏洞 2 → §3.3(a) >1MB 阈值跳过 + §7 风险表新增栈溢出行
> - 漏洞 3 → §3.2 `formatBodyDiff` 改为「变更块」截断，保证 removed/added 替换对完整
> - 漏洞 4 → §3.5 二选一引导（模板含 `{diff_result}` 时跳过旧 body 变量）
> - 漏洞 5 → §6 验收改为「大响应体(>100KB)场景 + AI 差异引用率主验收」
> - 漏洞 6 → §3.3(c) 超时放宽至 90-120s
> - 漏洞 7 → §3.2 补 `import type` 说明
> - 漏洞 8 → §3.5 描述精确化

### 10.1 已实测确认的正确前提（代码核对）

| 前提 | 证据 | 结论 |
|------|------|------|
| `CaptureRequest` 含 `url/path/statusCode/requestBody/responseBody` | types.ts:13-70 | ✅ Plan 变量注入全部有效 |
| `CompareRequest.requestA/requestB: CaptureRequest` | types.ts:264-266 | ✅ `computeDiff()` 可直接调用 |
| `diff-engine.ts` 仅 `import type`（无运行时依赖） | diff-engine.ts:5 | ✅ 主进程可安全 import |
| `DiffResult` 结构与 Plan 假设一致 | types.ts:1292-1324 | ✅ `delta?: any` / `changes?` 访问安全 |
| `dev` 下主进程已能 import `types.ts` | ai-service.ts:6-7 已 import | ✅ 路径 `../../src/services/diff-engine` 可行 |

### 10.2 🔴 严重漏洞（必须修）

#### 漏洞 1：默认模板兜底静默失效（§3.5 与 §3.3(a) 自相矛盾）

**现象**：§8 确认"默认模板用 `{diff_result}`"，§3.5 声称"computeDiff 抛错时回退为注入原始 body"。

**矛盾**：§3.3(a) 的 `fillPromptTemplate()` 在 `catch` 后只做 `diffText = ''`，而旧变量 `{response_a_json}` 等**仍照常注入到 `variables` 对象**（第 180-181 行）。但默认模板若已改为只引用 `{diff_result}`，模板里**没有** `{response_a_json}` 占位符 → `result.split('{response_a_json}').join(value)` 是**无操作** → 原始 body 实际上**进不了 prompt**。

**后果**：computeDiff 失败 → `{diff_result}` 为空 → LLM 仅收到 System Prompt 中"若差异为空，请说明两次请求基本一致" → **AI 会错误输出"基本一致"，但实际可能差异巨大**。这是静默误判，QA 会被误导。

**修复**：兜底时不能只让 `diffText=''`。应改为：
```typescript
catch (e) {
  console.warn('[AI Service] diff 计算失败，回退原始 body 截断:', e)
  // 回退：将 diff_result 填充为原始 body 的截断摘要（而非空白）
  diffText = `[diff 引擎计算失败，已回退原始报文前 4000 字符]\n` +
    `=== 请求A响应体 ===\n${requestA.responseBody.slice(0, 4000)}\n` +
    `=== 请求B响应体 ===\n${requestB.responseBody.slice(0, 4000)}`
}
```
或在默认模板中**强制保留** `{response_a_json}` 作为 fallback 段落。

#### 漏洞 2：`computeDiff` 递归栈溢出未识别（§7 风险评估遗漏）

**现象**：`diffJsonRecursive`（diff-engine.ts:107-169）是**纯递归函数**。对超大嵌套 JSON（如几 MB 响应体、深层嵌套或超长数组），会抛 `RangeError: Maximum call stack size exceeded`。

**后果**：
- Plan 核心卖点是"降本"，但**大响应体场景**正是现状最痛的点（60s 超时）。
- computeDiff 栈溢出 → 被 §3.3(a) 的 try/catch 捕获 → 走漏洞 1 的静默失效路径（默认模板下 AI 错误结论；若模板含旧变量则大 body 仍全量进 prompt → 60s 超时照旧）。
- **即：最大 body 场景，Plan 的降本完全失效，且可能崩溃**。

**§7 风险评估只列了"delta 仍过大"和"路径问题"，完全漏掉栈溢出**。

**修复**（任一即可，推荐组合）：
- 在 `ai-service.ts` 调用 `computeDiff` 前，对 `responseBody` 大小设阈值（如 `> 1MB` 跳过 JSON 递归 diff，直接标记"响应体过大已省略"）；
- 或在 `computeDiff` 外包一层：`try { computeDiff } catch (e) { 若 e 是栈溢出，回退为 text 模式 diff 或截断 }`；
- 或后续将 `diffJsonRecursive` 改为迭代（但违反"纯增量"承诺，留待 v1.1）。

#### 漏洞 3：文本 diff 截断可能切断"替换对"

**现象**：§3.2 `formatBodyDiff` 第 128 行：
```typescript
b.changes.filter((c) => c.added || c.removed).slice(0, max).forEach(...)
```
`diffLines`（diff-engine.ts:304-305）将**一行修改**表示为连续的 `{removed}` + `{added}` 两条。若 `slice(0, max)` 恰好截在一条 `removed` 之后、`added` 之前，**AI 会看到"删了某行"却看不到"改成什么"**，差异语义不完整。

**修复**：截断单位改为"变更块"而非"行"；或截断后若末尾是 `removed` 且紧随 `added`，补齐全对；或至少 slice 后追加"中间 X 处变更已省略"提示（Plan 已有省略提示，但需保证替换对完整）。

### 10.3 🟠 中等漏洞

#### 漏洞 4：旧变量与 `{diff_result}` 并存导致降本失效
若用户旧模板**同时引用** `{diff_result}` 与 `{response_a_json}`，原始 body 仍全量进 prompt，降本落空。§3.5 未强制二选一，仅说"保留兼容"。
**修复**：UI/文档明确引导"二选一"；或在 `fillPromptTemplate` 中检测：若模板含 `{diff_result}` 则**不计算**旧 body 变量（节省序列化开销）。

#### 漏洞 5：验收标准"Prompt 字符数下降 ≥ 50%"不可度量（§6）
下降幅度**依赖差异量**：若两次响应体几乎相同但字段多，delta 很小 → 降幅极大；若完全重写，delta 接近 body 大小 → 降幅很小。该指标无法稳定验收。
**修复**：改为"大响应体（>100KB）场景下，Prompt 字符数下降 ≥ 50%"或"平均 token 下降 X%"，并补充"AI 输出能引用具体差异路径"作为主验收项。

### 10.4 🟡 轻微瑕疵

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| 6 | §3.3(c) | 降本后 prompt 变小，60s 超时可放宽（慢思考模型） | 建议提到 90-120s，或跟随模型动态调整 |
| 7 | §3.2 | 代码示例 `serializeDiffForPrompt(diff: DiffResult)` 未展示 `import type { DiffResult } from './types'`（diff-engine.ts 第5行已 import，实施时会自动补，仅文档遗漏） | 补 import 说明 |
| 8 | §3.5 | "原始 body 不再默认注入"描述不精确：代码层仍计算 `JSON.stringify(requestA.requestHeaders)` 等，仅因占位符不在模板中 `split/join` 无操作而等效无效 | 改为"模板不含旧占位符时，旧变量注入无效果" |

### 10.5 修正优先级清单（实施前必做）

1. ❌ **[严重]** 漏洞 1：兜底改为注入"原始 body 截断摘要"而非空白（防静默误判）
2. ❌ **[严重]** 漏洞 2：computeDiff 前加 body 大小阈值 / 栈溢出捕获（防大 body 场景降级失效）
3. ❌ **[严重]** 漏洞 3：文本 diff 截断保证"替换对"完整
4. ⚠️ **[中等]** 漏洞 4：UI 引导 `{diff_result}` 与旧变量二选一
5. ⚠️ **[中等]** 漏洞 5：验收标准改为可度量表述
6. 📝 漏洞 6-8：文档/配置微调

### 10.6 评审补充建议（非阻塞）

- Plan §9 提到后续 Tier 2/3，但**未提及可复用 AI 代码分析 v2.0 的"双 Agent"模式**（working memory 已记录 Phase 0-4 实施完成）。建议在 Tier 2+ 中明确：Phase1 提取差异上下文 → Phase2 生成分析，缓解单 Agent 上下文过载。
- 默认模板文案（T4）应同时包含"若 `{diff_result}` 为空则提示用户检查 diff 引擎"，避免漏洞 1 场景的用户困惑。

---

## 11. 二次复审记录（v1.2 · 2026-07-06 · 主理人齐活林 Qi）

### 复审结论：✅ 仍存在的漏洞已全部回填，Plan 升级至 v1.2 可实施

基于真实代码（`diff-engine.ts` / `ai-service.ts`）二次核对 v1.1 回填结果，发现 **2 项严重残留 + 1 项新引入矛盾 + 1 项措辞过强 + 1 项轻微**，均已回填修复：

| # | 类型 | 发现 | 回填位置 |
|---|------|------|----------|
| R1 | 🔴 残留（漏洞2未彻底） | `computeDiff` 同时 diff `requestBody`+`responseBody`（diff-engine.ts:347-353），但 v1.1 §3.3(a) 阈值仅查 `responseBody` → 大请求体仍栈溢出 | §3.3(a) 阈值改为检查 `requestBody/responseBody` 四字段（>1MB） |
| R2 | 🔴 残留（漏洞4不完整） | §3.5 承诺"二选一跳过旧变量"，但 §3.3(a) `variables` 仍无条件计算 `{response_a_json}` 等 → 文档/代码不一致 | §3.3(a) 新增 `useDiffResult = template.includes('{diff_result}')`，旧 body 变量在其为 true 时置空 |
| R3 | 🟡 新引入矛盾（漏洞1副作用） | 兜底注入"原始报文截断"，但 System Prompt 仍声明"以下是结构化差异" → 模型被误导 | §3.3(b) System Prompt 改为兼容两种情况的措辞 |
| R4 | 🟡 措辞过强（漏洞2） | §7 原写"保证大 body 场景不崩溃"；>1MB 是粗启发式，深嵌套小文件仍可能溢出 | §7 改"大幅降低"而非"绝对根治" |
| R5 | 🟢 轻微 | JSON delta 单值 `JSON.stringify` 可能极长撑爆 prompt | §3.2 `formatBodyDiff` 新增 `trunc()` 单值截断 500 字符 |

### 二次复审后确认已成立的前提
- `computeDiff(reqA, reqB)` 参数类型 `CaptureRequest` 与 `CompareRequest.requestA/B` 匹配 ✅
- `diff-engine.ts` 仅 `import type`，主进程可安全引用 ✅
- 阈值覆盖四字段后，常见"大响应体/大请求体"场景栈溢出风险已闭环 ✅
- `useDiffResult` 置空旧变量后，降本路径与旧模板兼容路径彻底分离 ✅

### 剩余已知非阻塞项（留待实施期或后续优化）
- 极端深嵌套小文件（>~1 万层）仍可能触发 V8 栈溢出；如需根治需将 `diffJsonRecursive` 改为迭代（违反"纯增量"，留 v1.1）
- 文本 body 超大连表仍可能触发 `diffLines` LCS DP 内存峰值；现有 `>1MB` 阈值不拦截文本，但实际触发概率低（文本多走 `diffLinesSimple` 迭代路径）
