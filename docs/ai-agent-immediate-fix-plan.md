# AI Agent 跑偏问题立即修复方案

> 日期: 2026-06-26  
> 适用问题: Phase 1 部分解析失败后仍进入 Phase 2，最终生成错误接口的 curl。  
> 修复目标: 先阻止明显跑偏的结果，再提升分析质量。  
> 执行原则: 只修当前日志暴露的硬问题，不重构整体 AI Agent 架构。

---

## 一、这次日志暴露的问题

原始接口:

```text
POST https://ppeifeng.myshoplinestg.com/sl/apps/pos/app/order/detail
```

最终生成的错误 curl:

```bash
curl -X POST 'http://api.xx.com/apply-goods-discount' \
  -H 'Content-Type: application/json' \
  -d '{"goodsType":1,"discountRate":0.9,"specIds":"187,284","reason":"促销活动","activityName":"春季大促","activityId":1001,"isSku":1,"isTemplate":0}'
```

这不是“场景不够好”，而是结果已经分析到错误接口。必须先修以下硬问题:

1. `search_code` 参数名不一致，导致 `file_pattern` 被忽略。
2. `search_code` 描述说支持正则，但实现只做字面量搜索。
3. `read_file` 收到 `offset/limit`，但执行器实际忽略。
4. Phase 1 JSON 解析失败后仍把残缺结果交给 Phase 2。
5. Phase 2 没有校验 curl 的 method、host、path 是否仍是原始接口。

---

## 二、必须先改的文件

| 顺序 | 文件 | 目的 |
|---|---|---|
| 1 | `electron/services/ai-agent-tool-executor.ts` | 修工具契约，避免搜索和读文件行为与模型理解不一致 |
| 2 | `electron/services/ai-analyze-service.ts` | Phase 1 partial 保护 + Phase 2 curl 校验 |
| 3 | `electron/services/prompts/code-explorer-user.md` | 禁止模型使用未实现的正则搜索和无效 read_file 参数 |
| 4 | `electron/services/prompts/test-generator-system.md` | 强制 curl 使用原始 URL |
| 5 | `electron/services/__tests__/ai-agent-tool-executor.test.ts` | 覆盖工具契约 |
| 6 | `electron/__tests__/ai-analyze-service.test.ts` 或现有 AI 分析测试文件 | 覆盖 partial 和 curl 校验 |

---

## 三、具体修改步骤

## 1. 修复 `search_code` 的 `file_pattern` 参数被忽略

文件:

```text
electron/services/ai-agent-tool-executor.ts
```

现状:

```ts
case 'search_code':
  result = await this.withTimeout(
    this.searchCode(args.keyword, args.filePattern),
    `search_code(${args.keyword})`
  )
  break
```

问题:

模型实际传的是:

```ts
{ keyword: 'RegisterRoutes', file_pattern: '*.go' }
```

执行器只读 `args.filePattern`，所以 `file_pattern` 被忽略。

建议修改:

```ts
case 'search_code': {
  const keyword = args.keyword
  const filePattern = args.filePattern ?? args.file_pattern
  result = await this.withTimeout(
    this.searchCode(keyword, filePattern),
    `search_code(${keyword})`
  )
  break
}
```

验收:

- 调用 `search_code` 时传 `file_pattern: "*.go"`，日志不能再显示 `文件模式: all`。
- 搜索结果只能包含 `.go` 文件。

---

## 2. 修复 `search_code` 正则能力描述不一致

文件:

```text
electron/services/ai-analyze-service.ts
electron/services/prompts/code-explorer-user.md
```

现状:

- 工具描述写“支持正则表达式”。
- 但实现是 `lineLower.includes(keywordLower)`，不是正则。
- 所以 `func.*RegisterRoutes` 会被当成普通字符串搜索，必然搜不到。

短期建议:

先不要实现正则，先把描述改准确，禁止模型使用正则。

在 `getTools()` 的 `search_code` description 中改成类似:

```text
在仓库中按字面量搜索包含指定关键字的代码文件。当前不支持正则表达式，请使用具体关键词，如 "RegisterRoutes"、"order/detail"、"Detail"。
```

在 `code-explorer-user.md` 中把:

```text
用 search_code 搜索路由模式（如 "POST.*checkout"、路径片段）
```

改成:

```text
用 search_code 搜索具体字面量关键词。不要使用正则表达式。优先搜索路径片段、方法名、路由注册函数名，例如 "order/detail"、"RegisterRoutes"、"Detail"。
```

验收:

- Agent 不再调用 `search_code` 搜索 `func.*RegisterRoutes` 这类正则。
- 工具能力描述和真实实现一致。

---

## 3. 明确 `read_file` 不支持 `offset/limit`

文件:

```text
electron/services/ai-analyze-service.ts
electron/services/prompts/code-explorer-user.md
```

现状:

日志中出现:

```ts
read_file({ path: 'internal/domain/trade/order/service_query.go', offset: 0, limit: 100 })
```

但当前执行器只使用 `args.path`，会忽略 `offset/limit`。

短期建议:

不要现在实现 `read_snippet`，先把工具描述说清楚。

在 `getTools()` 的 `read_file` description 中增加:

```text
只支持 path 参数，会读取整个文件；不要传 offset、limit、startLine、endLine。
```

在 `executeTool()` 中可以加一个 warning:

```ts
if (toolName === 'read_file' && (args.offset !== undefined || args.limit !== undefined)) {
  console.warn('[AIAgentToolExecutor] read_file ignores offset/limit. Use path only.')
}
```

验收:

- Agent 不再主动给 `read_file` 传 `offset/limit`。
- 如果仍传了，日志会明确提示参数被忽略。

---

## 4. Phase 1 部分解析失败时不要静默进入 Phase 2

文件:

```text
electron/services/ai-analyze-service.ts
```

现状:

日志显示:

```text
[parseExplorationResult] ⚠️ 首次解析失败
[parseExplorationResult] ⚠️ 修复后仍然失败
[parseExplorationResult] ⚠️ 使用部分提取数据（字段可能不完整）
[Phase1] 探索完成，错误路径: 0 个，业务规则: 0 个
[Phase2] 生成完成，13 个场景
```

问题:

Phase 1 已经是 partial，Phase 2 还把它当完整结果生成场景，容易生成错接口。

建议修改:

### 4.1 给 Phase 1 结果增加内部质量字段

在 `electron/services/types.ts` 的 `CodeExplorationResult` 增加可选字段:

```ts
parseStatus?: 'complete' | 'partial' | 'failed'
parseWarnings?: string[]
```

如果不想污染共享类型，也可以在 `ai-analyze-service.ts` 内部包一层:

```ts
type ExplorationWithParseStatus = CodeExplorationResult & {
  parseStatus?: 'complete' | 'partial' | 'failed'
  parseWarnings?: string[]
}
```

### 4.2 `parseExplorationResult()` 部分提取时标记 partial

当直接解析和修复解析都失败，但走了部分提取逻辑时:

```ts
result.parseStatus = 'partial'
result.parseWarnings = [
  `Code Explorer JSON parse failed: ${parseError.message}`,
  'Using partially extracted exploration result.'
]
```

完整 JSON 解析成功时:

```ts
result.parseStatus = 'complete'
result.parseWarnings = []
```

### 4.3 Phase 1 后增加可靠性检查

在 `analyzeWithTwoPhasePipeline()` 中，Phase 1 后、Phase 2 前增加:

```ts
this.assertExplorationReliable(explorationResult, request)
```

新增方法:

```ts
private assertExplorationReliable(
  exploration: CodeExplorationResult & { parseStatus?: string; parseWarnings?: string[] },
  request: AnalyzeRequest
): void {
  const requestPath = this.extractPathname(request.url)
  const routePattern = exploration.entryPoint?.routePattern || ''

  if (exploration.parseStatus === 'partial') {
    this.pushAgentThinking('[质量检查] Phase 1 输出为部分解析结果，正在校验入口可靠性...', 'explorer')
  }

  if (!this.routeLooksRelated(routePattern, requestPath)) {
    throw new Error(`入口定位不可靠：原始路径 ${requestPath}，分析入口 ${routePattern || 'unknown'}`)
  }

  const reachedTerminal =
    exploration.externalCalls?.length > 0 ||
    exploration.errorPaths?.length > 0 ||
    exploration.businessRules?.length > 0

  if (exploration.parseStatus === 'partial' && !reachedTerminal) {
    throw new Error('Phase 1 结果为部分解析，且未提取到业务规则、错误路径或外部调用，停止生成测试场景。')
  }
}
```

辅助方法可以简单实现:

```ts
private extractPathname(urlOrPath: string): string {
  try {
    return new URL(urlOrPath).pathname
  } catch {
    return urlOrPath.split('?')[0]
  }
}

private routeLooksRelated(routePattern: string, requestPath: string): boolean {
  if (!routePattern || !requestPath) return false
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/^get\s+|^post\s+|^put\s+|^delete\s+|^patch\s+/i, '')
      .replace(/:[^/]+/g, '')
      .replace(/\{[^/]+\}/g, '')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '')

  const route = normalize(routePattern)
  const path = normalize(requestPath)
  return path.includes(route) || route.includes(path) || this.sharedPathTokenCount(route, path) >= 2
}
```

验收:

- Phase 1 JSON 解析失败时，结果中必须有 warning。
- 如果入口路径明显不相关，不能继续 Phase 2。
- 不能再在 partial + 空业务规则 + 空错误路径 + 空外部调用时生成 13 个看似正常的场景。

---

## 5. 强制校验 Phase 2 生成的 curl URL

文件:

```text
electron/services/ai-analyze-service.ts
electron/services/prompts/test-generator-system.md
electron/services/prompts/test-generator-user.md
```

### 5.1 Prompt 约束

在 `test-generator-system.md` 增加硬约束:

```text
## curl URL 硬约束

- curl 必须使用原始请求的完整 URL。
- 不允许替换 scheme、host、path。
- 不允许生成其他接口路径。
- 只允许根据测试场景修改 query、headers、body 中的测试数据。
- 如果无法确定测试数据，保持原始 URL 不变，并在 analysisSummary 说明不确定项。
```

在 `test-generator-user.md` 增加:

```text
所有场景的 curlCommand 必须保持以下 method 和 URL:
- Method: {{METHOD}}
- URL: {{URL}}
```

### 5.2 程序化校验

在 `ai-analyze-service.ts` 的 scenario validator 中增加:

```ts
private validateScenarioCurl(
  scenario: AnalysisScenario,
  request: AnalyzeRequest
): ScenarioValidationWarning[] {
  const warnings: ScenarioValidationWarning[] = []
  const curl = scenario.curlCommand || ''
  const curlUrl = this.extractUrlFromCurl(curl)
  const curlMethod = this.extractMethodFromCurl(curl)

  if (!curlUrl) {
    warnings.push({
      code: 'CURL_URL_MISSING',
      severity: 'error',
      message: `场景「${scenario.scenarioName}」缺少 curl URL`,
    })
    return warnings
  }

  const expectedMethod = request.method.toUpperCase()
  if (curlMethod && curlMethod.toUpperCase() !== expectedMethod) {
    warnings.push({
      code: 'CURL_METHOD_MISMATCH',
      severity: 'error',
      message: `场景「${scenario.scenarioName}」curl method 为 ${curlMethod}，应为 ${expectedMethod}`,
    })
  }

  const expected = new URL(request.url)
  const actual = new URL(curlUrl)
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) {
    warnings.push({
      code: 'CURL_URL_MISMATCH',
      severity: 'error',
      message: `场景「${scenario.scenarioName}」curl URL 为 ${actual.origin}${actual.pathname}，应为 ${expected.origin}${expected.pathname}`,
    })
  }

  return warnings
}
```

辅助函数:

```ts
private extractUrlFromCurl(curl: string): string | null {
  const match = curl.match(/curl\s+(?:[^'"]+\s+)*['"]([^'"]+)['"]/)
  return match?.[1] || null
}

private extractMethodFromCurl(curl: string): string | null {
  const match = curl.match(/(?:-X|--request)\s+([A-Za-z]+)/)
  return match?.[1] || null
}
```

注意:

- 如果 curl URL 校验失败，这不是普通 warning，应标为 `error`。
- 当前可以先不阻断整个分析，但必须在 `analysisSummary` 高亮展示。
- 后续 UI 可以选择不把 error 场景显示为“可执行用例”。

验收:

- 原始 URL 是 `/sl/apps/pos/app/order/detail` 时，任何 `/apply-goods-discount` 都会被标记为错误。
- host 从 `ppeifeng.myshoplinestg.com` 变成 `api.xx.com` 会被标记为错误。
- method 不一致会被标记为错误。

---

## 四、建议执行顺序

1. 先修 `search_code` 参数名不一致。
2. 修工具描述，禁止未实现的正则和 `read_file offset/limit`。
3. 加 Phase 1 partial 保护，阻止残缺结果进入 Phase 2。
4. 加 curl URL/method 校验。
5. 再做轻量 evidence、sourceRefs、覆盖 validator。
6. 最后再考虑 `read_snippet`、搜索上下文、多关键词搜索这些工具增强。

---

## 五、最小验收用例

用同一个接口重新跑:

```text
POST https://ppeifeng.myshoplinestg.com/sl/apps/pos/app/order/detail
```

必须满足:

- `search_code` 传 `file_pattern: "*.go"` 时不会显示 `文件模式: all`。
- Agent 不再搜索 `func.*RegisterRoutes` 这种正则关键词。
- Agent 不再给 `read_file` 传 `offset/limit`，或日志明确提示忽略。
- 如果 Phase 1 JSON 解析失败，结果中出现 partial warning。
- 如果 Phase 1 入口不匹配 `/sl/apps/pos/app/order/detail`，不进入 Phase 2。
- Phase 2 生成的所有 curl 都使用原始 method、host、path。
- 不再出现 `http://api.xx.com/apply-goods-discount` 这种其他接口的 curl。

---

## 六、哪些暂时不要改

以下不是当前第一优先级:

- 不要先重构完整 Agent 架构。
- 不要先实现复杂 AST 分析。
- 不要先改 UI 大布局。
- 不要先做多 Agent。
- 不要先实现所有工具增强。

先把“错误接口 curl 能被阻止”这个底线修好。

