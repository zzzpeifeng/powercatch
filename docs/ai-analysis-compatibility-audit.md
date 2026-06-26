# AI 代码分析 v2.0 方案兼容性审查报告

> 审查日期: 2026-06-26  
> 审查范围: 方案文档 vs 现有代码，所有接触点逐项对比

---

## 审查方法论

按数据流方向（前端 → IPC → 主进程 → SSE → 前端）逐层检查每个组件的改动影响，识别所有可能的不兼容场景。

---

## 一、审查结论

**总体评估：方案基本可行，发现 8 个兼容性问题，其中 2 个 P0（必须修复），3 个 P1（建议修复），3 个 P2（记录即可）。**

| 级别 | 数量 | 含义 |
|------|------|------|
| P0 | 2 | 不改会导致编译失败或运行时错误 |
| P1 | 3 | 不改功能降级但不崩溃 |
| P2 | 3 | 优化项，可延后处理 |

---

## 二、P0 问题（必须修复）

### P0-1: `scenarioType` 类型变更导致编译失败（Phase 0 vs Phase 3 部署顺序）

**受影响文件**: `src/services/types.ts` line 718

**现状**:
```typescript
scenarioType: 'normal' | 'param-error' | 'auth-error'
```

**方案的 Phase 0 计划（0.1）**:
```typescript
scenarioType: 'normal' | 'missing-required' | 'boundary' | 'type-error' | ...
```

**问题**: Phase 0 先改类型、Phase 3 才改后端。Phase 0 ~ Phase 3 之间的版本：
- `getSystemPrompt()` (line 422) 仍然输出 `'param-error'` 和 `'auth-error'`
- 前端 `ScenarioTable.vue` 的 `scenarioBadgeClass()` (line 95-101) 只有旧 3 种类型的映射
- **TypeScript 编译报错**: `Type '"param-error"' is not assignable to type 'ScenarioType12'`

**修复方案**:

```typescript
// 方案 A（推荐）: 合并 Phase 0.1 + Phase 3.1 同批次部署
// 先完成 Phase 0.2~0.4（添加字段、前端 badge），这些不引起编译错误
// 最后一步改 scenarioType union + 同步改后端 Prompt

// 方案 B: 过渡期保留旧类型
scenarioType:
  | 'normal'
  | 'param-error'   // @deprecated 过渡期保留，v2.1 移除
  | 'auth-error'    // @deprecated 过渡期保留，v2.1 移除
  | 'missing-required'
  | 'boundary'
  | 'type-error'
  | 'format-error'
  | 'business-rule'
  | 'auth-missing'
  | 'auth-expired'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'server-error'
```

**推荐方案 A**，因为 `getSystemPrompt()` 和 `buildUserPrompt()` 在 Phase 1-2 会被完全重写，不会再有旧类型输出。

---

### P0-2: `analyzeWithAgent()` 和 `parseAIResponse()` 不存在向后兼容回退路径

**受影响文件**: `electron/services/ai-analyze-service.ts` lines 141-416, 487-522

**现状**:
- `analyzeWithAgent()` 是核心方法，直接从 IPC handler 调用
- 只处理一个 AI API 调用，返回 `{ analysis, scenarios, matches }`

**方案 Phase 3**: 重写为两阶段 Pipeline

**问题**: 
如果 Phase 1 Code Explorer 返回的 JSON 无法解析，没有回退到旧单 Agent 模式的机制。用户会直接看到错误。
此外，`MAX_TOOL_CALLS = 20` 最大值在两阶段模式下如何分配？方案未明确。

**修复方案**:

```typescript
// 在 analyzeWithAgent() 中添加降级逻辑
private async analyzeWithAgent(request: ...): Promise<AnalyzeResult> {
  try {
    // Phase 1: Code Explorer
    const explorationResult = await this.phase1ExploreCode(request)
    
    // Phase 2: Test Case Generator
    const testResult = await this.phase2GenerateTests(request, explorationResult)
    
    return this.assembleResult(explorationResult, testResult)
  } catch (phaseError) {
    console.warn('[AIAnalyzeService] 两阶段分析失败，降级到单 Agent 模式')
    // 回退到旧流程
    return this.analyzeWithAgentLegacy(request)
  }
}

// MAX_TOOL_CALLS 分配:
// Phase 1 (探索): 15 次（需要大量搜索读取代码）
// Phase 2 (生成): 10 次（输入已结构化，推理为主，工具调用少）
```

---

## 三、P1 问题（建议修复）

### P1-1: Phase 1 专用 SSE 事件无前端处理

**受影响文件**: 
- `electron/sse-manager.ts` — 可以发送任意 event name
- `src/services/sse.ts` lines 491-565 — `processMessage()` 硬编码了事件处理

**方案 Phase 1.7**: 计划推送以下新事件:
- `code_explorer_thinking`
- `code_explorer_tool_call`
- `code_explorer_tool_result`

**问题**: `processMessage()` 的 `switch` 没有这些 case，会落入 `default` 分支（line 562），仅打印警告：
```typescript
default:
  console.warn('[SSEService] 未知消息类型:', message.type)
```

**结果**: Phase 1 的实时进度用户不可见（静默运行），但程序不会崩溃。

**修复方案**:

```typescript
// sse.ts processMessage() 中添加:
case 'code_explorer_thinking':
  if (this.onAgentThinking && message.data) {
    this.onAgentThinking(`[代码探索] ${message.data.content || ''}`)
  }
  break

case 'code_explorer_tool_call':
  if (this.onAgentToolCall && message.data) {
    this.onAgentToolCall(`explorer:${message.data.tool || ''}`, message.data.args)
  }
  break

case 'code_explorer_tool_result':
  if (this.onAgentToolResult && message.data) {
    this.onAgentToolResult(`explorer:${message.data.tool || ''}`, message.data.result)
  }
  break
```

或者**简化方案**：Phase 1 复用现有的 `agent_thinking` / `agent_tool_call` / `agent_tool_result` 事件，在 data 中添加 `phase: 'explorer'` 标记来区分。

---

### P1-2: `agentThinking` 状态被两个 Phase 混合污染

**受影响文件**: 
- `src/stores/ai-analysis-store.ts` line 133 — `agentThinking` 单一状态
- `src/services/sse.ts` lines 518-522 — 所有 thinking 都 append 到同一个回调

**问题**: 
Phase 1 探索阶段输出的 thinking 和 Phase 2 生成阶段输出的 thinking 都累加到 `agentThinking.value`，用户看到的是一团混杂文本。

**结果**: 用户体验差（一堆代码路径混着测试用例），但不影响功能。

**修复方案**:

```typescript
// store 中添加分隔:
const agentThinking = ref('')
const agentThinkingPhase2 = ref('')  // 新增

// 或直接在 thinking 文本中插入分隔标记:
sseService.onAgentThinking = (content) => {
  agentThinking.value += content
}

// 在两阶段之间:
agentThinking.value += '\n\n--- Phase 1 完成，开始生成测试用例 ---\n\n'
```

---

### P1-3: `AnalysisPhase` 没有 `'code-exploring'` 枚举值

**受影响文件**: `src/services/types.ts` lines 671-679

**现状**:
```typescript
export type AnalysisPhase =
  | 'idle' | 'cloning' | 'scanning' | 'scan-failed'
  | 'analyzing' | 'generating' | 'done' | 'error'
```

**方案 Phase 3.2**: 新增 `'code-exploring'` 阶段

**问题**: 
方案说"新增 `AnalysisPhase: 'code-exploring'`"，但实际在 Phase 3.2 才加。Phase 1 开始运行时，后端如果 push `phase: 'code-exploring'` 给前端，前端 `ai-analysis-store.ts` line 401 的校验会拒绝它：
```typescript
const validPhases = ['idle', 'cloning', 'scanning', ...]
```
`'code-exploring'` 不在列表中 → `phase.value` 保持不变 → 显示仍为 `'scanning'`。

**修复方案**: Phase 0.1 就加上。Phase 0 是类型定义改动的最佳时机：

```typescript
export type AnalysisPhase =
  | 'idle'
  | 'cloning'
  | 'scanning'
  | 'scan-failed'
  | 'code-exploring'   // 新增: Phase 1 代码探索中
  | 'analyzing'
  | 'generating'
  | 'done'
  | 'error'
```

同时也需要在 `phaseMapping` 中映射：
```typescript
const phaseMapping: Record<string, AnalysisPhase> = {
  'ai-agent': 'analyzing',
  'ai-tool-call': 'analyzing',
  'ai-tool-result': 'analyzing',
  'code-explorer': 'code-exploring',    // 新增
  'test-generator': 'generating',       // 新增
}
```

---

## 四、P2 问题（记录即可）

### P2-1: `AnalysisScenario` 新增字段对前端无影响

**受影响文件**: `src/services/types.ts` lines 714-725, `src/components/ScenarioTable.vue`

**变更**:
```typescript
// 新增 expectedStatusCode: number
// 新增 testData: Record<string, any>
```

**分析**:
- `ScenarioTable.vue` 的 props 是 `{ scenarios: AnalysisScenario[] }`，只用了 `scenarioName`、`scenarioType`、`callChain`
- `CurlAssertionPanel.vue` 接收的是单独 props (`:curl-command`, `:python-assertion`)，不依赖 `scenario` 对象
- 新增字段不影响现有模板渲染

**结论**: 安全。无需特殊处理。但 Phase 4.1 才在 UI 中使用这些字段，这没问题。

---

### P2-2: `pushDone()` 数据结构保持兼容

**受影响文件**: `electron/ipc.ts` lines 99-109

**现状**:
```typescript
pushDone({
  success: true,
  repoName: repoInfo.repoName,
  handlerFile: result.matches?.[0]?.filePath || '',
  handlerFunction: result.matches?.[0]?.handlerName || '',
  scenarios: result.scenarios || [],
  analysisSummary: result.analysis || '',
})
```

**方案 Phase 4**: 
Result Assembler 输出仍是 `analyzeWithAgent()` → `AnalyzeResult` → `pushDone()`。结构不变。
`result.scenarios` 中的每个 `AnalysisScenario` 多出 `expectedStatusCode` 和 `testData` 字段，但 `AIDeepAnalysisResult` 接口不限制额外字段。

**结论**: 安全。旧前端读取新 scenarios 时，`expectedStatusCode` 和 `testData` 会被当作额外字段忽略。

---

### P2-3: 工具执行器（`AIAgentToolExecutor`）无需改动

**受影响文件**: `electron/services/ai-agent-tool-executor.ts`

**分析**:
Phase 1 和 Phase 2 都使用同一套 4 个工具（`list_directory`、`read_file`、`search_code`、`get_file_tree`）。工具执行器本身是 `clonePath` 相关的，不依赖于哪个 Phase 使用它。

方案的 3.3 节提到可选的 `get_callers` 和 `get_struct_fields` 新工具，这是纯新增，不影响现有工具。

**结论**: 安全。只需在 Phase 1 的工具定义中保持 4 个现有工具。

---

## 五、兼容性矩阵总览

| 组件 | 当前行为 | v2.0 需要 | 兼容性 | 风险 |
|------|----------|-----------|--------|------|
| `types.ts` scenarioType | 3 种 | 12 种 | ⚠️ P0 | 编译失败 |
| `types.ts` AnalysisPhase | 8 种 | 10 种 (+code-exploring +test-generating) | ⚠️ P1 | 进度显示异常 |
| `types.ts` AnalysisScenario | 5 字段 | 7 字段 (2 new) | ✅ | 无 |
| `types.ts` CodeExplorationResult | 不存在 | 新增（内部） | ✅ | 无 |
| `ai-analyze-service.ts` analyzeWithAgent | 单 Agent | 双 Agent Pipeline | ⚠️ P0 | 无回退 |
| `ai-analyze-service.ts` getSystemPrompt | 3场景指令 | Code Explorer 指令 | ✅ | 整体替换 |
| `ai-analyze-service.ts` parseAIResponse | 1个解析器 | 2个解析器 (phase1+phase2) | ✅ | 新增独立方法 |
| `ai-analyze-service.ts` MAX_TOOL_CALLS | 20 | 15+10 | ⚠️ P2 | 需调整 |
| `sse-manager.ts` pushSSEEvent | 通用 | 通用 | ✅ | 可发任意 event |
| `sse-manager.ts` pushDone/pushProgress | 现有格式 | 不变 | ✅ | 无 |
| `sse.ts` processMessage | 9 个 case | 需加 4 个 case | ⚠️ P1 | Phase 1 进度不可见 |
| `ipc.ts` executeAnalysisAsync | 单流程 | 不变 | ✅ | 只调 analyze() |
| `ai-analysis-store.ts` agentThinking | 单一状态 | 两阶段混合 | ⚠️ P1 | 文本混杂 |
| `ai-analysis-store.ts` phaseMapping | 3 个映射 | 需加 2 个映射 | ⚠️ P1 | 进度条不准 |
| `ScenarioTable.vue` | 3 种 badge | 12 种 badge | ✅ | 新增映射即可 |
| `CurlAssertionPanel.vue` | 独立 props | 不变 | ✅ | 无 |
| `AiAnalysisResultView.vue` | 渲染 scenarios | 不变 | ✅ | 无 |
| `ai-agent-tool-executor.ts` | 4 工具 | 4 工具 | ✅ | 无 |

---

## 六、修正后的实施顺序

根据兼容性分析，调整 Phase 执行顺序：

```
修正后的 Phase 0（基础设施，1天）:
├── 0.1 扩展 AnalysisPhase (✅ 加 code-exploring + test-generating)
├── 0.2 扩展 AnalysisScenario.scenarioType (✅ 先加新类型 + 保留旧类型过渡)
├── 0.3 添加 expectedStatusCode、testData 字段
├── 0.4 添加 CodeExplorationResult 中间类型
├── 0.5 扩展 ScenarioTable.vue badge 颜色 (✅ 覆盖全部12种)
├── 0.6 sse.ts processMessage() 增加 code_explorer_* 事件处理
└── 0.7 store phaseMapping 增加 code-explorer / test-generator 映射

Phase 1（Code Explorer，2天）:
├── 1.1 Prompt 文件: code-explorer-system.md + code-explorer-user.md
├── 1.2 实现 phase1ExploreCode()
├── 1.3 实现 parseExplorationResult()
├── 1.4 SSE 推送复用现有 agent_* 事件 (简化方案，避免新增 event type)

Phase 2（Test Generator，2天）:
├── 2.1 Prompt 文件: test-generator-system.md + test-generator-user.md
├── 2.2 实现 phase2GenerateTests()
├── 2.3 实现 parseScenariosResult()

Phase 3（Pipeline 整合，1天）:
├── 3.1 重写 analyzeWithAgent() (✅ 含回退逻辑)
├── 3.2 删除旧 scenarioType 过渡类型 (✅ 此时已无人使用旧类型)
├── 3.3 progress 页面增加子阶段指示
├── 3.4 集成测试

Phase 4（结果页优化，1天）:
├── 4.1 CurlAssertionPanel 增加 statusCode/testData 展示
├── 4.2 场景覆盖度统计卡
├── 4.3 测试
└── 4.4 文档更新
```

关键改动：
1. Phase 0 从 4 个任务扩展到 7 个（加 P1 修复项）
2. Phase 1.7 简化 SSE 推送（复用现有 agent_* 事件，加 phase 前缀标记）
3. Phase 3.1 强制包含回退逻辑（fallback to legacy single-agent）
4. 旧类型 `param-error`/`auth-error` 保留到 Phase 3.2 才移除

---

## 七、风险检查清单

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 类型定义向前兼容 | ⚠️ P0-1 | scenarioType 变更需与后端同批次部署 |
| SSE 事件类型向后兼容 | ⚠️ P1-1 | 新事件需前端 handler，否则静默丢失 |
| analyzeWithAgent 降级路径 | ⚠️ P0-2 | 需要 fallback to legacy |
| 数据格式不变 (pushDone) | ✅ | scenarios 数组结构保持兼容 |
| IPC 通道不变 | ✅ | 同一套 IPC_CHANNELS |
| SSE 通信协议不变 | ✅ | 同一套 event/data 格式 |
| 前端组件接口不变 | ✅ | ScenarioTable/CurlAssertionPanel props 不变 |
| Repository clone 逻辑不变 | ✅ | 只读分析，不改变 clone |
| Model 名称配置不变 | ✅ | 可用同一 model 跑两阶段 |
| API Key 共享 | ✅ | 同一 OpenAI 实例两次调用 |
| 工具执行器不变 | ✅ | 4 工具足够两个 Phase |
