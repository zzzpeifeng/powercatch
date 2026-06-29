# AI Agent 分析质量改造任务单

> 版本: v1.0  
> 日期: 2026-06-26  
> 目标: 提升 AI Agent 对接口链路、测试参数和断言生成的准确性、可追溯性和稳定性。  
> 执行方式: 按文件分组逐项改造。优先完成 P0，再做 P1/P2/P3。

---

## 一、改造目标

当前 AI Agent 流程已经拆成两阶段:

1. Phase 1: Code Explorer 根据选中接口在指定项目中检索入口、调用链、参数、业务规则、错误路径。
2. Phase 2: Test Case Generator 根据 Phase 1 结果生成测试场景、curl 和 Python 断言。

本次改造重点不是重做架构，而是让现有流程输出更可靠:

| 目标 | 说明 |
|---|---|
| 结论可追溯 | 每个参数、分支、错误路径、测试场景都能回指代码证据 |
| 漏项可见 | 找不到的 header、Validate、feature-flag、错误映射必须显式输出 |
| 场景贴代码 | 每个测试场景必须绑定 `params`、`businessRules` 或 `errorPaths` 来源 |
| 结果可校验 | Phase 2 输出后增加 validator，避免缺字段被默认值吞掉 |
| 检索更精准 | 增强工具层，支持行片段读取、上下文搜索和更好的结果排序 |

交互边界:

- 不改变用户现有操作入口: 仍然是选中接口后发起 AI 分析。
- 不改变现有两阶段流程: 仍然是 Code Explorer -> Test Case Generator -> Result Assembler。
- 不强制改变结果页主布局: 覆盖摘要和来源标签先作为增量信息展示。
- 不让 validator 阻断用户获取结果: 先记录 warnings，除非 JSON 完全无法解析。

---

## 二、优先级总览

| 优先级 | 任务 | 主要文件 |
|---|---|---|
| P0 | 修复现有工具契约和搜索能力声明不一致 | `electron/services/ai-agent-tool-executor.ts`, `electron/services/ai-analyze-service.ts` |
| P0 | 增加 Phase 1 解析失败保护和 curl URL 校验 | `electron/services/ai-analyze-service.ts`, `electron/services/prompts/test-generator-system.md` |
| P0 | 强化 Phase 1 结构化输出和证据字段 | `electron/services/prompts/code-explorer-system.md` |
| P0 | 强化 Phase 2 场景与代码证据绑定 | `electron/services/prompts/test-generator-system.md` |
| P1 | 增加结果 validator 和 warnings | `electron/services/ai-analyze-service.ts` |
| P1 | 扩展共享类型定义 | `src/services/types.ts`, `electron/services/types.ts` |
| P3 | 增强 AI Agent 工具能力（验证 prompt 收益后再做） | `electron/services/ai-agent-tool-executor.ts` |
| P3 | 前端展示覆盖缺口和告警 | `src/views/AiAnalysisResultView.vue`, 相关组件 |
| P3 | 补充测试 | `electron/services/__tests__`, `src/__tests__` |

---

## 三、按文件分组任务

## 0. 现有流程 P0 修复项

这些问题已经能从运行日志中复现，优先级高于 prompt 优化。

### P0-0-1: 修复 search_code 参数名不一致

现象:

- 工具调用日志中出现 `参数: { keyword: 'RegisterRoutes', file_pattern: '*.go' }`。
- 但执行器读取的是 `args.filePattern`，导致 `file_pattern` 被忽略，日志显示 `文件模式: all`。

影响:

- 搜索范围扩大，噪音增加。
- prompt 以为限定了 `*.go`，实际没有限定。

修改要求:

- 在 `executeTool()` 中兼容两种字段:

```ts
const filePattern = args.filePattern ?? args.file_pattern
```

- 或统一 function calling schema 和执行器，全部使用 `filePattern`。
- 回归测试必须覆盖 `file_pattern` 和 `filePattern` 两种输入。

验收标准:

- 调用 `search_code` 时传 `file_pattern: "*.go"`，日志不再显示 `文件模式: all`。
- 搜索结果只包含匹配文件类型。

### P0-0-2: 修复 search_code “支持正则”声明与实现不一致

现象:

- prompt/工具描述鼓励搜索 `func.*RegisterRoutes`。
- 当前实现使用 `lineLower.includes(keywordLower)`，这是字面量包含匹配，不是正则。
- 所以 `func.*RegisterRoutes` 搜索结果为 0。

影响:

- Agent 会误以为正则搜索无结果，转向错误路径或浪费工具调用。

修改要求:

- 二选一:
  - 实现真正的正则搜索，并捕获非法正则错误。
  - 或把工具描述改为“字面量搜索”，禁止 prompt 使用正则表达式。

建议:

- 第一阶段先改描述和 prompt，要求搜索 `RegisterRoutes`、`order/detail`、`Detail` 等字面量。
- 如果后续仍需要正则，再作为工具增强实现。

验收标准:

- prompt 不再建议使用 `func.*RegisterRoutes` 这类正则。
- 工具描述和实际搜索行为一致。

### P0-0-3: 明确 read_file 不支持 offset/limit，或实现行区间读取

现象:

- 工具调用日志中出现 `read_file` 参数带 `offset` / `limit`。
- 当前执行器只读取 `args.path`，会忽略这些字段。

影响:

- Agent 以为只读取了部分文件，实际可能读完整文件，增加上下文压力。

修改要求:

- 二选一:
  - 暂时在工具描述中明确 `read_file` 只支持 `path`，不支持 `offset/limit`。
  - 或实现 `read_file(path, offset, limit)` / `read_snippet(path, startLine, endLine)`。

建议:

- 短期先修工具描述，减少模型传无效参数。
- `read_snippet` 仍保留为 P3 可选增强。

验收标准:

- Agent 不再对 `read_file` 传 `offset/limit`。
- 如果传了未知参数，工具日志或结果应提示这些参数被忽略。

### P0-0-4: Phase 1 部分解析失败时不能静默进入 Phase 2

现象:

- 日志显示 `parseExplorationResult` 首次解析失败，修复后仍失败，最后“使用部分提取数据”。
- 随后 Phase 1 结果为 `错误路径: 0 个，业务规则: 0 个`。
- Phase 2 仍继续生成 13 个场景，最终出现完全不相关的 curl。

影响:

- 残缺的 Phase 1 会误导 Phase 2。
- 用户看到的是貌似完整但实际跑偏的测试场景。

修改要求:

- 给 `CodeExplorationResult` 增加内部质量标记，或在解析函数返回 warnings:
  - `isPartial: boolean`
  - `parseWarnings: string[]`
  - `confidence: "complete" | "partial" | "failed"`，这是解析质量，不是模型自评。

- 当 Phase 1 是 partial 时:
  - 如果 `entryPoint.routePattern` 与原始请求路径不匹配，阻断 Phase 2，并提示“入口定位不可靠，请重新分析”。
  - 如果 `businessRules/errorPaths` 为空但调用链未追踪到 DB/external/error return，标记高风险 warning。
  - 不允许把 partial 结果当作完整结果生成大量场景。

验收标准:

- Phase 1 JSON 解析失败后，结果页能看到明确 warning。
- 入口不匹配时不会继续生成看似正常的测试场景。

### P0-0-5: 强制校验 Phase 2 生成的 curl URL

现象:

- 原始请求是 `POST https://ppeifeng.myshoplinestg.com/sl/apps/pos/app/order/detail`。
- 生成结果却是 `curl -X POST 'http://api.xx.com/apply-goods-discount'`。

影响:

- 这是硬错误，不应作为 warning 放过。

修改要求:

- Test Generator prompt 中明确:
  - curl 必须使用原始请求的完整 URL。
  - 不允许替换 host、path、scheme。
  - 只能修改 headers/body 中和当前测试场景相关的数据。

- validator 中增加硬校验:
  - 从 `curlCommand` 提取 URL。
  - URL 的 `origin + pathname` 必须等于原始请求的 `origin + pathname`。
  - HTTP method 必须等于原始请求 method。

- 校验失败时:
  - 标记为 `error` 级别。
  - 不应把该 scenario 当作可执行用例展示；至少要在 summary 明确标红/高危提示。

验收标准:

- 再次分析同一接口时，不会出现其他域名或其他 path 的 curl。
- 如果模型生成了错误 URL，validator 能抓出来。

## 1. `electron/services/prompts/code-explorer-system.md`

### P0-1: 增加轻量 evidence 结构

目的: Phase 1 的关键结论必须能回指代码位置，同时控制 JSON 体积，避免结果过大导致解析失败。

修改要求:

- 在输出 JSON schema 中新增通用证据结构:

```json
{
  "evidence": {
    "filePath": "internal/service/order_service.go",
    "lineRange": "120-138",
    "snippet": "if order.Status != \"open\" { ... }",
    "reason": "该分支决定订单状态不合法时返回业务错误"
  }
}
```

- 只给以下高价值字段增加完整 `evidence`:
  - `businessRules[]`
  - `errorPaths[]`
  - `externalCalls[]`

- 以下字段不增加完整 `evidence`，避免重复和 JSON 膨胀:
  - `entryPoint`: 已有 `handlerFile` / `handlerFunction` / `routePattern`，必要时补 `lineRange` 即可。
  - `fullCallChain[]`: 已有 `filePath` / `lineRange`。
  - `fullCallChain[].branches[]`: 保留 `condition` / `action` / `type`，不要放长 snippet。
  - `params[]`: 保留轻量 `sourceTag` 或 `sourceRef`，不要放完整 evidence。
  - `respStructure.fields[]`: 保留字段路径和类型，不放完整 evidence。

- 控制 `snippet` 长度，建议最多 200 字符，避免 Phase 1 结果过大影响 Phase 2。

验收标准:

- Phase 1 输出中的业务规则、错误路径、外部调用没有裸结论。
- 参数来源能通过 `sourceTag` 或 `sourceRef` 说明，不要求完整 evidence。
- 如果某项没有代码证据，必须放入 `unresolvedItems`，不能编造证据。

### P0-2: 增加技术栈识别字段

目的: 避免当前 prompt 默认偏 Go，影响非 Go 或混合项目。

修改要求:

- 在输出 schema 顶层新增:

```json
{
  "projectProfile": {
    "languages": ["go"],
    "frameworks": ["gin"]
  }
}
```

- prompt 中增加要求:
  - 先识别语言和框架，再选择对应分析策略。
  - 若无法确认框架，`frameworks` 输出 `["unknown"]`。

验收标准:

- Code Explorer 输出顶层包含 `projectProfile`。
- Go 项目仍正常识别 Gin/Echo/Fiber/Chi/lego/webx/net/http。
- 非 Go 项目不会被硬套 Go 术语。
- 不输出 `routePatterns`、`confidence` 或独立 `evidence`，避免重复和噪音。

### P0-3: 增加 unresolvedItems

目的: 把“没找到”和“没分析”区分开。

修改要求:

- 在顶层新增:

```json
{
  "unresolvedItems": [
    {
      "type": "header|validation|feature-flag|error-mapping|response|external-call",
      "description": "未找到 HeaderLoginTicket 的定义",
      "impact": "header 参数可能缺失，相关认证场景不完整"
    }
  ]
}
```

- 明确以下项必须查找，找不到必须进入 `unresolvedItems`:
  - `Check()` / `Validate()` / `Verify()` 等手动校验方法
  - header 解析逻辑
  - feature flag / 灰度分支
  - gRPC/Dubbo/HTTP 客户端错误映射
  - DB / cache / external call
  - 响应结构定义

- 不要求模型输出 `searchedKeywords` 和 `searchedFiles`。如果未来需要这类信息，应由程序化工具调用日志记录，不由模型自报。

验收标准:

- Phase 1 不再静默跳过关键项。
- `unresolvedItems` 可被 Phase 2 和 UI 消费。

### P0-4: 强化调用链完整性要求

目的: 降低只分析到 Handler 的概率。

修改要求:

- 在 prompt 中明确 `fullCallChain` 至少要追踪到以下终点之一:
  - DB 操作
  - cache 操作
  - 外部 API / RPC 调用
  - 最深层 error return
  - 明确无法继续追踪，并写入 `unresolvedItems`

- 要求每个 `fullCallChain[]` 节点输出:
  - `depth`
  - `layer`
  - `filePath`
  - `functionName`
  - `lineRange`
  - `inputParams`
  - `outputType`
  - `branches`
  - `callees`

验收标准:

- 简单接口至少有 Router/Handler/Service 或 Handler/Repository 层。
- 遇到无法追踪的动态调用时，输出 unresolved，而不是停止不说。

---

## 2. `electron/services/prompts/code-explorer-user.md`

### P0-5: 调整执行策略提示

目的: 让模型按固定流程检索，减少随机探索。

修改要求:

- 在“工具使用提示”中改为分步骤:
  - Step 1: 识别技术栈和目录结构。
  - Step 2: 搜索路由入口。
  - Step 3: 读取 handler 和绑定参数结构。
  - Step 4: 追踪 service/repository/external。
  - Step 5: 查找 Validate/Check/header/feature-flag/error mapping。
  - Step 6: 输出 JSON，关键业务结论带 evidence，其他结论使用轻量来源字段。

- 增加约束:
  - 不确定的结论必须放入 `unresolvedItems`。
  - 不允许为了补全 schema 编造字段。

验收标准:

- Agent 日志中的工具调用顺序更稳定。
- Phase 1 输出中包含轻量 evidence 和 unresolvedItems。

---

## 3. `electron/services/prompts/test-generator-system.md`

### P0-6: 每个 scenario 增加 sourceRefs

目的: 测试场景必须绑定代码来源，避免泛化用例。

修改要求:

- 在输出 schema 中每个 scenario 增加:

```json
{
  "sourceRefs": [
    {
      "sourceType": "param|branch|businessRule|errorPath|externalCall|featureFlag",
      "sourceId": "params.ProductInfos",
      "filePath": "internal/dto/create_order.go",
      "lineRange": "45-52",
      "condition": "len(ProductInfos) == 0 || len(ProductInfos) > 100",
      "coverageIntent": "覆盖 ProductInfos 数量为空的参数校验失败"
    }
  ]
}
```

- 要求所有非 normal 场景必须至少有一个 `sourceRefs`。
- normal 场景也应尽量绑定入口和主链路 `sourceRefs`。

验收标准:

- 生成的每个场景都能解释“为什么需要这个场景”。
- 无来源的场景要被 validator 标记 warning。

### P0-7: 改造场景预算规则

目的: 15 个场景上限下优先覆盖最有价值路径。

修改要求:

- 预算选择改为覆盖优先:
  - required 缺失
  - businessRules
  - errorPaths
  - 关键 min/max/pattern/enum 边界
  - feature-flag 正常分支
  - 主流程 normal

- normal 场景保留 1 个主流程；如果 feature-flag 分支存在，再按预算补充。
- 参数边界场景只覆盖最关键约束，不做“字段 x 所有边界”的机械遍历。
- 最终展示排序仍保持主流程 normal 在第一个，避免改变现有用户阅读习惯。
- 如果总数超过 15，必须在 `analysisSummary` 里说明被截断的覆盖项。

验收标准:

- 复杂接口不会只生成大量 normal 或泛化失败场景。
- 被截断的场景有明确说明。

### P0-8: 强化断言生成规则

目的: 让 Python 断言更贴近响应结构和错误码。

修改要求:

- 成功场景:
  - 必须断言 `code/msg` 或项目识别出的等价响应状态字段。
  - 必须从 `respStructure.fields[]` 选择关键业务字段断言。

- 失败场景:
  - 优先断言 `errorPaths[].errorCode`。
  - 如果 error code 不确定，断言非成功并在 `sourceRefs` 或 `analysisSummary` 中说明不确定原因。

- 不允许断言 Phase 1 没有证据支持的字段固定值。

验收标准:

- 成功断言不再乱猜过多业务字段。
- 失败断言优先使用代码里提取出的错误码。

---

## 4. `electron/services/prompts/test-generator-user.md`

### P0-9: 增加覆盖矩阵要求

目的: 让 Phase 2 在生成前先建立覆盖映射。

修改要求:

- 在用户 prompt 中增加:
  - 先根据 `params/businessRules/errorPaths/externalCalls/unresolvedItems` 建立覆盖矩阵。
  - 再生成 scenarios。
  - 最终 `analysisSummary` 必须包含覆盖统计:
    - 已覆盖参数数
    - 已覆盖业务规则数
    - 已覆盖错误路径数
    - 未覆盖项

验收标准:

- `analysisSummary` 中可看出覆盖情况。
- 未覆盖项不会被隐藏。

---

## 5. `electron/services/ai-analyze-service.ts`

### P1-1: 新增 ScenarioValidationResult

目的: 对 Phase 2 结果做程序化校验。

修改要求:

- 增加内部类型:

```ts
interface ScenarioValidationWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
  sourceType?: string
  sourceId?: string
}

interface ScenarioValidationResult {
  valid: boolean
  warnings: ScenarioValidationWarning[]
  coverage: {
    requiredParamsTotal: number
    requiredParamsCovered: number
    constrainedParamsTotal: number
    constrainedParamsCovered: number
    businessRulesTotal: number
    businessRulesCovered: number
    errorPathsTotal: number
    errorPathsCovered: number
    unresolvedItemsTotal: number
  }
}
```

验收标准:

- 类型只影响 AI 分析服务内部，不破坏现有前端。
- 后续可逐步把 warnings 暴露给 UI。

### P1-2: 新增 validateScenarios()

目的: Phase 2 解析后立刻校验覆盖质量。

修改要求:

- 不要直接在 `buildScenariosResult()` 内调用 validator，因为该函数当前只接收 parsed JSON，没有 `explorationResult` 上下文。
- 推荐在 `phase2GenerateTests()` 中完成解析后调用 `validateScenarios(explorationResult, scenarios)`，并把 validation result 随 testResult 返回。
- 可选方案: 调整 `parseScenariosResult(content, explorationResult)` 的函数签名，但要同步更新所有调用点。
- 校验规则:
  - required 参数是否至少被一个 missing-required 或 normal 场景覆盖。
  - 有 min/max/pattern/enum 的参数是否被 boundary/format/type-error 场景覆盖。
  - 每条 `businessRules` 是否至少有一个 scenario 的 `sourceRefs` 指向。
  - 每条 `errorPaths` 是否至少有一个 scenario 的 `sourceRefs` 指向。
  - 非 normal 场景是否有 `sourceRefs`。
  - scenarioName + scenarioType + sourceRefs 是否重复。
  - `curlCommand` 和 `pythonAssertion` 是否为空。

验收标准:

- 控制台或 SSE 日志能看到 validator warnings。
- validator 不应直接中断分析，除非 JSON 完全不可用。

### P1-3: 不再静默补默认值

目的: 缺字段要被看见。

当前问题:

- `buildScenariosResult()` 对缺失字段默认补:
  - `scenarioName || '未知场景'`
  - `scenarioType || 'normal'`
  - `expectedStatusCode || 200`
  - `testData || {}`

修改要求:

- 保留兼容输出，但增加 warning:
  - 缺 `scenarioType` 记录 warning。
  - 缺 `expectedStatusCode` 记录 warning。
  - 缺 `curlCommand` 或 `pythonAssertion` 记录 warning。
  - 缺 `sourceRefs` 记录 warning。

验收标准:

- 不破坏 UI 渲染。
- 缺失字段会在日志和最终 summary 中出现。

### P1-4: 把 validator 结果写入 analysisSummary

目的: 用户可以直接看到覆盖质量。

修改要求:

- 在 `buildAnalysisSummary()` 中追加:
  - 覆盖统计
  - warnings 列表
  - unresolvedItems 摘要

- `phase2GenerateTests()` 的返回值建议扩展为:

```ts
Promise<{
  scenarios: AnalysisScenario[]
  analysisSummary: string
  validation?: ScenarioValidationResult
}>
```

验收标准:

- 分析结果页 Markdown 能看到“覆盖检查”小节。

### P1-5: 传递 modelName 配置一致性检查

目的: 避免实际模型和设置页模型不一致。

修改要求:

- 检查 `AIAnalyzeService` 当前 `modelName` 更新路径。
- 如果设置页传入 `modelName`，确保 Phase 1 和 Phase 2 都使用同一个模型配置。

验收标准:

- 日志中能看到实际使用的模型。
- 不影响现有 API Key/baseURL 配置。

---

## 6. `electron/services/types.ts`

### P1-6: 扩展 CodeExplorationResult 类型

目的: 让 Phase 1 新字段有类型约束。

修改要求:

- 增加:
  - `Evidence`
  - `ProjectProfile`
  - `UnresolvedItem`

- 注意: `SourceRef` 和 `ScenarioValidationWarning` 会被渲染进程消费，优先定义在 `src/services/types.ts`。主进程需要使用时从共享类型导入，避免两边定义漂移。
- `Evidence` 只用于 `businessRules`、`errorPaths`、`externalCalls` 等高价值结论；参数来源优先用轻量 `sourceTag/sourceRef`。

- 扩展 `CodeExplorationResult`:

```ts
interface CodeExplorationResult {
  projectProfile?: ProjectProfile
  entryPoint: ...
  fullCallChain: ...
  params: ...
  respStructure: ...
  businessRules: ...
  errorPaths: ...
  externalCalls: ...
  unresolvedItems?: UnresolvedItem[]
}
```

验收标准:

- `vue-tsc --noEmit` 不报类型错误。
- 旧字段仍兼容。

---

## 7. `src/services/types.ts`

### P1-7: 扩展 AnalysisScenario 类型

目的: 前端能接收 `sourceRefs` 和 validator warnings。

修改要求:

- 找到 `AnalysisScenario` 或测试场景相关类型。
- 增加可选字段:

```ts
sourceRefs?: SourceRef[]
validationWarnings?: ScenarioValidationWarning[]
coverageTags?: string[]
```

- 如主进程和渲染进程共享类型存在重复定义，保持字段一致。
- 同步修改 `buildScenariosResult()`，把模型输出的 `sourceRefs` 映射到 `AnalysisScenario`，否则 P0 prompt 生成的 `sourceRefs` 会在解析阶段被丢弃。

验收标准:

- 前端现有组件无需立即使用这些字段也能正常编译。
- 不破坏已存储的旧分析结果。

---

## 8. `electron/services/ai-agent-tool-executor.ts`

### P3-1: 新增 read_snippet 工具

目的: 让模型能读取特定行附近代码，减少整文件上下文浪费。

执行时机: 先完成 P0 prompt 和 P1 validator，并观察结果质量。如果仍然存在定位不准、读文件过多或上下文浪费，再实施本任务。

修改要求:

- 新增工具方法:

```ts
private async readSnippet(
  relativePath: string,
  startLine: number,
  endLine: number,
  contextLines = 5
): Promise<ToolCallResult>
```

- 返回:
  - `path`
  - `startLine`
  - `endLine`
  - `content`
  - `totalLines`

- 在 `executeTool()` 支持 `read_snippet`。
- 在 `getTools()` 中暴露 function calling schema。

验收标准:

- 能读取指定文件的指定行区间。
- start/end 越界时自动裁剪并返回有效内容。
- 仍保留路径遍历防护。

### P3-2: search_code 返回上下文

目的: 搜索结果不只返回命中行，还给模型足够上下文判断是否相关。

执行时机: 先完成 P0/P1。如果 prompt 优化后 Phase 1 命中率已经足够，本任务可以延后。

修改要求:

- 搜索结果新增:
  - `beforeLines`
  - `afterLines`
  - `score`

- 默认返回命中行前后 2 行。
- 文件很大时仍然限制最大结果数，避免输出爆炸。

验收标准:

- 搜索路由、Validate、错误码时，模型可以直接看到附近代码。

### P3-3: 增加多关键词搜索

目的: 支持更精确定位，比如同时搜 path 片段和 method。

执行时机: 先完成 P0/P1。如果单关键词搜索仍然噪音过大，再实施本任务。

修改要求:

- `search_code` 支持:

```json
{
  "keywords": ["checkout", "POST"],
  "mode": "all|any"
}
```

- 保持向后兼容 `keyword` 单字符串。

验收标准:

- 旧 prompt 的 `keyword` 仍可用。
- 新 prompt 可使用 `keywords + mode`。

### P3-4: 增加 search mode

目的: 针对常见分析任务降低搜索噪音。

执行时机: 先完成 P0/P1。如果仍频繁搜到无关文件，再实施本任务。

修改要求:

- 给 `search_code` 增加 `searchMode`:
  - `general`
  - `route`
  - `validation`
  - `error-mapping`
  - `feature-flag`
  - `external-call`

- 不需要做复杂 AST，先用关键词权重即可:
  - route: `GET`, `POST`, `router`, `Route`, `RegisterRoutes`
  - validation: `Validate`, `Check`, `binding`, `validate`
  - error-mapping: `convBizError`, `Error`, `Code`, `switch`
  - feature-flag: `Use`, `feature`, `gray`, `config`
  - external-call: `grpc`, `dubbo`, `http`, `redis`, `db`, `gorm`

验收标准:

- 返回结果按 `score` 排序。
- 不要求一次完美，但比纯全文匹配更少噪音。

---

## 9. `electron/services/prompts/code-explorer-system.md` 工具说明同步

### P3-5: 在 prompt 中引导使用新工具

目的: 新增工具后，模型知道什么时候使用。

执行时机: 仅在 `read_snippet` 或增强版 `search_code` 实现后执行。

修改要求:

- 在工具使用说明中新增:
  - 搜索命中后优先用 `read_snippet` 读取相关函数附近代码。
  - 只有需要完整结构时才用 `read_file`。
  - 查找路由使用 `searchMode: "route"`。
  - 查找 Validate/Check 使用 `searchMode: "validation"`。
  - 查找错误映射使用 `searchMode: "error-mapping"`。

验收标准:

- Agent 工具调用日志中能看到 `read_snippet` 被使用。

---

## 10. `src/views/AiAnalysisResultView.vue`

### P3-1: 展示覆盖检查摘要

目的: 让用户知道本次结果是否可靠。

修改要求:

- 如果 analysis markdown 中已追加覆盖检查，可暂时不改 UI。
- 如果选择结构化展示，则新增一个简洁区块:
  - 参数覆盖
  - 业务规则覆盖
  - 错误路径覆盖
  - warnings 数量

验收标准:

- 不影响现有结果页布局。
- 有 warning 时用户能看到。

---

## 11. `src/components/ScenarioTable.vue`

### P3-2: 展示场景来源标签

目的: 用户能看到每个场景覆盖了什么。

修改要求:

- 如果 scenario 有 `sourceRefs`:
  - 显示简短标签，如 `param`, `businessRule`, `errorPath`, `featureFlag`。
  - 鼠标悬停或展开时展示 `filePath:lineRange`。

验收标准:

- 没有 `sourceRefs` 的旧数据仍正常展示。
- 标签不撑乱表格。

---

## 12. `electron/services/__tests__/ai-analyze-service.test.ts`

### P3-3: 增加 validator 单元测试

目的: 确保覆盖检查逻辑稳定。

测试用例:

- required 参数有 missing-required 场景，应该通过。
- required 参数没有任何场景覆盖，应该 warning。
- businessRule 没有 sourceRef，应该 warning。
- errorPath 没有 sourceRef，应该 warning。
- 非 normal 场景没有 sourceRefs，应该 warning。
- 缺 `curlCommand` 或 `pythonAssertion`，应该 warning。

验收标准:

- `npm test -- ai-analyze-service` 或现有测试命令通过。

---

## 13. `electron/services/__tests__/ai-agent-tool-executor.test.ts`

### P3-4: 增加工具层测试

目的: 避免搜索和片段读取破坏 Agent。

测试用例:

- `read_snippet` 正常读取指定行。
- `read_snippet` start/end 越界时安全裁剪。
- `read_snippet` 拒绝路径遍历。
- `search_code` 兼容旧 `keyword`。
- `search_code` 支持新 `keywords + mode`。
- `search_code` 返回上下文和 score。

验收标准:

- 工具层测试通过。
- 旧工具调用方式仍可用。

---

## 四、建议实施顺序

### 第一阶段: Prompt 质量约束

先改:

- `electron/services/prompts/code-explorer-system.md`
- `electron/services/prompts/code-explorer-user.md`
- `electron/services/prompts/test-generator-system.md`
- `electron/services/prompts/test-generator-user.md`

完成标志:

- Phase 1 输出包含 `projectProfile/evidence/unresolvedItems`。
- `evidence` 只出现在业务规则、错误路径、外部调用等高价值结论上。
- Phase 2 原始模型输出包含 `sourceRefs`。
- 不改 TypeScript 逻辑也能通过 JSON 解析。

注意:

- 只改 prompt 时，`buildScenariosResult()` 暂时不会把 `sourceRefs` 保留到最终场景对象中。要让前端和 validator 使用 `sourceRefs`，必须完成第二阶段的类型和解析映射。

### 第二阶段: 类型和 validator

再改:

- `electron/services/types.ts`
- `src/services/types.ts`
- `electron/services/ai-analyze-service.ts`

完成标志:

- validator 生成 coverage 和 warnings。
- analysisSummary 能展示覆盖检查。
- 旧结果不崩。

### 第三阶段: 结果评估

先评估:

- 使用 P0/P1 后的新 prompt 和 validator 跑 2-3 个典型接口。
- 观察 Phase 1 是否仍然定位不准、读文件过多、搜索噪音过大。

完成标志:

- 明确是否真的需要工具增强。
- 如果结果已明显改善，可以跳过第四阶段工具增强，直接进入 UI 和测试。

### 第四阶段: 工具增强（可选）

按需再改:

- `electron/services/ai-agent-tool-executor.ts`
- `electron/services/prompts/code-explorer-system.md`

完成标志:

- `read_snippet` 可用。
- `search_code` 返回上下文和相关度。
- Agent 日志中能看到新工具被调用。

### 第五阶段: UI 和测试

最后改:

- `src/views/AiAnalysisResultView.vue`
- `src/components/ScenarioTable.vue`
- `electron/services/__tests__/ai-analyze-service.test.ts`
- `electron/services/__tests__/ai-agent-tool-executor.test.ts`

完成标志:

- 用户能看到覆盖摘要和场景来源。
- 单元测试覆盖 validator 和工具层。

---

## 五、最小可交付版本

如果预算有限，先完成以下最小闭环:

1. `ai-agent-tool-executor.ts`: 修复 `file_pattern/filePattern` 参数不一致，修正 `search_code` 正则能力声明。
2. `ai-analyze-service.ts`: Phase 1 部分解析失败时标记 partial，不把不可靠入口静默交给 Phase 2。
3. `test-generator-system.md`: 强制 curl 使用原始完整 URL，不允许替换 host/path/scheme。
4. `ai-analyze-service.ts`: validator 校验 scenario 的 curl method 和 URL 是否匹配原始请求。
5. `code-explorer-system.md`: 增加轻量 `evidence` 和 `unresolvedItems`。
6. `test-generator-system.md`: 增加 `sourceRefs`。
7. `buildAnalysisSummary()`: 追加覆盖检查 Markdown。

其中 `evidence` 只保留在 `businessRules/errorPaths/externalCalls` 等高价值字段上，避免 Phase 1 JSON 过大。

这个版本不需要先改 UI，也不需要实现 P3 工具增强，就能先避免明显跑偏的测试场景。

---

## 六、回归检查清单

改造完成后至少验证:

- [ ] `npm run build` 通过。
- [ ] `npm test` 或相关单测通过。
- [ ] 一个简单接口能生成 normal + 参数缺失场景。
- [ ] 一个有 Validate/Check 的接口能提取手动校验。
- [ ] 一个有业务 if 分支的接口能生成 business-rule 场景。
- [ ] 一个有外部调用错误映射的接口能生成 errorPath 场景。
- [ ] Phase 1 找不到 header/feature flag/error mapping 时，会输出 unresolvedItems。
- [ ] Phase 2 每个非 normal 场景都有 sourceRefs。
- [ ] analysisSummary 能看到覆盖检查和 warnings。
- [ ] `search_code` 传入 `file_pattern: "*.go"` 时不会退化成全文件搜索。
- [ ] prompt 不再要求 `search_code` 使用未实现的正则表达式。
- [ ] Phase 1 JSON 部分解析失败时，结果中能看到 partial/parse warning。
- [ ] Phase 2 生成的每个 curl 都保持原始 method、host 和 path。

---

## 七、注意事项

- 不要一次性重写整个 AI 分析架构，优先沿用现有两阶段 Pipeline。
- 不要让 validator 因 warning 直接失败，先作为质量提示落地。
- 不要删除 legacy fallback，除非确认新流程稳定。
- 不要让 prompt 只适配一个业务项目，证据字段和 unresolved 机制要保持通用。
- 不要在没有 evidence 的情况下让模型填具体断言值。
