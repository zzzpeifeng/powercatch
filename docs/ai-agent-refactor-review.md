# AI Agent 分析质量改造任务单 - 评审结论

> 评审日期: 2026-06-26
> 评审对象: `docs/ai-agent-refactor-task-list.md` v1.0
> 评审人: WorkBuddy

---

## 总体评价

方案质量很高，结构清晰，优先级划分合理，最小可交付版本设计精准。但有 **4 处必须修改**，否则会导致 JSON 输出过大引发解析失败（这个 bug 我们刚花了 3 轮迭代才修好）。

---

## 🔴 必须改（不改会出问题）

### 1. evidence 粒度砍掉 5 个层级

原方案给 8 个层级都加了 `evidence`，会导致 Phase 1 JSON 膨胀 2-3 倍，回到"JSON 过大 → 解析失败 → 降级到单 Agent"的老路。

**保留 evidence 的层级（3 个）：**

| 字段 | 保留原因 |
|------|---------|
| `businessRules[]` | 每条业务规则确实需要代码出处 |
| `errorPaths[]` | 每条错误路径确实需要代码出处 |
| `externalCalls[]` | 每个外部调用确实需要代码出处 |

**砍掉 evidence 的层级（5 个）：**

| 字段 | 砍掉原因 |
|------|---------|
| `entryPoint` | 它本身就有 handlerFile + handlerFunction + lineRange，就是证据 |
| `fullCallChain[]` | 已有 filePath + lineRange，重复 |
| `fullCallChain[].branches[]` | 已有 condition + action，重复 |
| `params[]` | 来源在 entryPoint 和 fullCallChain 里已覆盖 |
| `respStructure.fields[]` | 来自 response DTO，跟 respStructure 本身同源 |

---

### 2. unresolvedItems 砍掉 2 个字段

AI 不会真的记录自己搜了什么，它会在输出 JSON 时凭空编造这两个字段，反而误导后续分析。

**保留的字段：**

| 字段 | 保留原因 |
|------|---------|
| `type` | 分类有用（header/validation/feature-flag/error-mapping/response/external-call） |
| `description` | 核心信息，说明没找到什么 |
| `impact` | 影响评估有用，说明缺失会导致什么问题 |

**砍掉的字段：**

| 字段 | 砍掉原因 |
|------|---------|
| `searchedKeywords` | AI 会在输出时凭空编造搜索关键词，不可信 |
| `searchedFiles` | 同上，AI 没有真正记录搜索历史的能力 |

---

### 3. projectProfile 砍掉 3 个字段

**保留的字段：**

| 字段 | 保留原因 |
|------|---------|
| `languages` | 语言识别有用，影响后续分析策略 |
| `frameworks` | 框架识别有用，影响路由/参数解析方式 |

**砍掉的字段：**

| 字段 | 砍掉原因 |
|------|---------|
| `routePatterns` | 跟 `entryPoint.routePattern` 语义重复 |
| `confidence` | AI 无法准确自评置信度，且 `low` 时后续分析策略没有定义 |
| `evidence` | 语言/框架识别不需要独立 evidence，entryPoint 已经包含了 |

**补充说明**：如果识别不了框架，`frameworks` 输出 `["unknown"]` 即可，不需要额外的 confidence 字段。

---

### 4. 场景优先级顺序调整

原方案把参数边界排在业务规则前面，但参数边界是"机械性遍历"（每个字段 × 每种约束 = 场景数爆炸），业务规则和错误路径是"语义性的"，更能反映真实业务逻辑。

**原方案顺序：**
```
required 缺失 → min/max/pattern 边界 → businessRules → errorPaths → feature-flag → normal
```

**建议顺序：**
```
required 缺失 → businessRules → errorPaths → min/max/pattern 边界 → feature-flag → normal
```

**原因**：一个有 10 个参数、每个参数有 min/max 约束的接口，按原方案会生成 20+ 个边界场景占满 15 个预算，导致 businessRules 和 errorPaths 完全没覆盖。调整后优先覆盖业务语义，参数边界作为补充。

---

## 🟡 建议改（不改也能用，但改了更好）

### 5. P2 工具增强降为 P3

| 任务 | 原优先级 | 建议 | 原因 |
|------|---------|------|------|
| read_snippet 工具 | P2 | P3 | 先用现有工具 + prompt 优化验证效果，再决定工具层要不要改 |
| search_code 返回上下文 | P2 | P3 | 同上 |
| 多关键词搜索 | P2 | P3 | 同上 |
| search mode | P2 | P3 | 同上 |

**原因**：工具层改动的风险比 prompt 改动高（涉及 TypeScript 逻辑 + 工具 schema + 测试），应该在 prompt 优化验证后再做。如果 prompt 优化后 Phase 1 的探索效率已经足够好，这些工具改动可能根本不需要。

---

### 6. P1-5 modelName 一致性检查删除

| 任务 | 原优先级 | 建议 |
|------|---------|------|
| modelName 配置一致性检查 | P1 | 删除 |

**原因**：当前代码已处理（`AIAnalyzeService` 构造函数设一次 `modelName`，Phase 1/Phase 2 共用），除非能复现"Phase 1 用了模型 A，Phase 2 用了模型 B"的实际 bug，否则不需要单独列任务。

---

## 🟢 不需要改（方案本身没问题）

以下设计评审通过，直接执行即可：

- P0-3 `unresolvedItems` 的核心设计（type + description + impact）
- P0-6 `sourceRefs` 设计（sourceType + sourceId + filePath + lineRange + condition + coverageIntent）
- P1-1/P1-2 validator 设计（ScenarioValidationResult + validateScenarios()）
- P1-3 不再静默补默认值（保留兼容输出，增加 warning）
- P1-4 validator 结果写入 analysisSummary
- P1-6/P1-7 类型扩展（Evidence + ProjectProfile + UnresolvedItem + SourceRef）
- 最小可交付版本（4 步闭环：evidence + sourceRefs + validator + summary）
- 回归检查清单（9 项验证点）
- 实施顺序（4 阶段：Prompt → 类型/Validator → 工具 → UI/测试）
- 交互边界（不改入口、不改流程、不改布局、validator 不阻断）

---

## 改动汇总

| 类型 | 数量 | 具体内容 |
|------|------|---------|
| evidence 层级砍掉 | 5 个 | entryPoint、fullCallChain[]、branches[]、params[]、respStructure.fields[] |
| unresolvedItems 字段砍掉 | 2 个 | searchedKeywords、searchedFiles |
| projectProfile 字段砍掉 | 3 个 | routePatterns、confidence、evidence |
| 场景优先级调整 | 1 处 | businessRules/errorPaths 提到参数边界前面 |
| P2 降为 P3 | 4 个任务 | read_snippet、search_code 上下文、多关键词搜索、search mode |
| P1 删除 | 1 个任务 | modelName 一致性检查 |

**总计：砍 10 个字段，调 1 个优先级，删 1 个任务，降 4 个任务优先级**
