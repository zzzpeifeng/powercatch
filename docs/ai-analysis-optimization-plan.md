# AI 代码分析流程优化方案

> **版本**: v2.0-plan  
> **日期**: 2026-06-26  
> **目标**: 从"固定3场景"升级为"智能多场景"的完整调用链路分析

---

## 一、现状问题分析

### 1.1 核心问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | **固定3场景**：System Prompt 硬编码 `normal / param-error / auth-error` | 无法覆盖边界值、业务规则校验失败、多条件组合等场景 |
| 2 | **调用链路浅**：只追踪 Router → Handler，不深入 Service → Repository → DB/External | 丢失核心业务逻辑上下文 |
| 3 | **无分支分析**：不分析代码中的 if/switch 条件分支 | 无法生成覆盖不同业务路径的测试用例 |
| 4 | **DTO 解析弱**：不提取 `validate:"gte=0,lte=150"` 等边界约束 | 边界值场景缺失 |
| 5 | **单 Agent 上下文过载**：一个 Agent 既要探索代码，又要分析逻辑，还要生成用例 | Prompt 过长，推理质量下降 |
| 6 | **Python 断言格式不统一**：AI 自由发挥，格式参差不齐 | 可复现性差 |
| 7 | **只支持 Go**：其他语言代码无法分析 | 覆盖面窄 |

### 1.2 用户期望的目标效果

```
接口数据 (method + path + requestBody + requestHeaders)
    → 查询完整调用链路 (Router → Middleware → Handler → Service → Repository → DB/External)
    → 分析入参约束、判断逻辑、调用逻辑
    → 按测试用例编写规则生成 N 个场景（N 由代码复杂度决定）
    → 每个场景生成 curl + Python 断言
    → 输出到结果页（保持现有格式）
```

---

## 二、架构设计：两阶段双 Agent Pipeline

### 2.1 为什么选双 Agent 而非四 Agent？

| 方案 | API 调用次数 | 延迟 | 上下文聚焦度 | 推荐 |
|------|-------------|------|-------------|------|
| 单 Agent | 1 次 | 低 | 低（上下文混杂） | ❌ |
| 双 Agent Pipeline | 2 次 | 中 | 高（探索与生成分离） | ✅ **推荐** |
| 四 Agent Pipeline | 4 次 | 高 | 最高 | ❌ 性价比低 |

**结论：两阶段 Pipeline 是最佳平衡点**。代码探索和用例生成是两种截然不同的认知任务，分开后每个 Agent 可以更专注。

### 2.2 架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                    用户选择的接口数据                               │
│     { method, url, path, requestBody, requestHeaders }           │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Phase 1: Code Explorer Agent                        │
│  职责：探索代码，追踪完整调用链路，分析业务逻辑                         │
│                                                                  │
│  工具：list_directory, read_file, search_code, get_file_tree      │
│                                                                  │
│  输出：code_exploration_result.json                               │
│  {                                                                │
│    entryPoint: { file, function, routePattern },                  │
│    fullCallChain: [ Step ],         // 完整调用链                  │
│    params: [ ParamDef ],            // 入参定义 + 约束              │
│    respStructure: { ... },         // 响应结构                     │
│    businessRules: [ Rule ],         // 业务规则（if/switch分支）     │
│    errorPaths: [ ErrorPath ],       // 所有错误路径                 │
│    externalCalls: [ ExternalCall ]  // 外部服务/DB调用              │
│  }                                                                │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│           Phase 2: Test Case Generator Agent                     │
│  职责：根据代码分析结果，按测试规则生成场景 + curl + Python 断言        │
│                                                                  │
│  输入：code_exploration_result.json + 原始请求数据                  │
│  输出：scenarios[] (匹配现有 AIDeepAnalysisResult 格式)             │
│                                                                  │
│  场景生成规则：                                                     │
│  ├── 正常流程（必选）：参数合法 + 满足所有业务条件                      │
│  ├── 边界值（按需）：每个有 range/constraint 的字段各一个               │
│  ├── 必填缺失（按需）：每个 required 字段各一个                       │
│  ├── 类型/格式错误（按需）：类型不匹配                                │
│  ├── 业务规则违反（按需）：违反 if 条件                              │
│  ├── 权限/认证错误（按需）：Token缺失/过期                            │
│  └── 特定错误码（按需）：代码中 return 的每种错误                      │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Result Assembler                                │
│  合并 Phase 1 的 analysisSummary + Phase 2 的 scenarios            │
│  输出 AIDeepAnalysisResult（匹配现有前端格式）                       │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                AiAnalysisResultView.vue                           │
│  现有前端组件：ScenarioTable + CurlAssertionPanel + Markdown报告    │
│  （无需修改前端，只扩展 scenarioType 的 badge 颜色）                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、Phase 1: Code Explorer Agent 详细设计

### 3.1 增强版 System Prompt

```markdown
你是一个资深的后端代码分析专家，精通 Go 代码分析。

## 你的任务
根据用户提供的 HTTP 请求信息（方法、路径、请求体、请求头），在本地 Git 仓库中：

1. **定位路由入口**：找到请求路径对应的路由注册和 Handler 函数
2. **追踪完整调用链**：从 Handler 向下追踪所有函数调用，直到数据库操作或外部 API 调用
3. **分析入参约束**：从 DTO struct 的 tag 中提取验证规则 + **追踪自定义 Check()/Validate() 方法**中的手动校验逻辑（见下方「自定义校验方法识别」）
4. **分析响应结构**：从返回值类型中提取完整响应结构
5. **识别业务规则**：分析所有条件分支（if/switch），理解每个分支的触发条件
6. **识别错误路径**：找到所有 error return，理解每种错误的触发条件
7. **识别外部依赖**：数据库表、外部API调用、缓存操作等

## 语言框架识别
### Go
- 路由框架：Gin, Echo, Fiber, Chi, lego/webx, net/http
- DTO tag：`json:"field" binding:"required" validate:"gte=0,lte=150"`
- 常见模式：
  - `c.ShouldBindJSON(&req)` / `ctx.Bind(&param)`
  - `errors.New("xxx")` / `fmt.Errorf("xxx")`
  - `db.Where(...).First(&record)` / `db.Create(&record)`

## 自定义校验方法识别（重要！）
很多 Go 项目不用 struct tag，而是用自定义校验方法。你必须：
1. 在 Handler 中搜索 `param.Check()` / `req.Validate()` / `param.Validate()` 调用
2. 找到对应的方法定义：`func (x *XxxParam) Check() error` 或 `func (x *Xxx) Validate() error`
3. 读取该方法的完整代码
4. 逐个解析其中的 if/return error 语句，提取：
   - 被校验的字段名（从 if 条件中提取）
   - 校验条件（如 `len(c.ProductInfos) == 0`、`utf8.RuneCountInString(field) > 64`）
   - 返回的错误码（如 `codes.InvalidParam.ToError()`）
5. 将这些手动校验点作为 `params[].constraints` 或 `businessRules` 输出

常见模式：
- `len(c.ProductInfos) == 0 || len(c.ProductInfos) > 100` → ProductInfos 数量的边界校验
- `strconv.ParseFloat(*field, 64)` → 格式校验（必须为数字）
- `utf8.RuneCountInString(field) > N` → 字符串长度校验

## Header 参数提取（重要！）
除了 request body，很多接口的关键参数在 HTTP header 中。你需要：
1. 搜索 header 解析代码（如 `GetHttpHeader`、`ctx.GetHeader`、`NewAppCtx`）
2. 找到 header 参数的结构体定义（如 `HeaderLoginTicket`）
3. 将 header 中的参数也纳入 `params` 输出，`location` 设为 `"header"`
4. 重点关注以下 header 的字段：
   - ticket header → storeId, merchantId, innerToken, posStaffId 等
   - uid header → 用户ID
   - otp header → 认证令牌
   - deviceinfo header → 设备信息

## 灰度/Feature-Flag 分支识别
如果发现以下模式的分支，标记为 `type: "feature-flag"`：
- `config.UseXxx(ctx, storeId, uid)` → 灰度开关
- `if feature.IsEnabled("xxx")` → 特性开关
- 这种分支无法通过代码分析确定走哪条路径，需要在 `branches` 中标记，
  后续 Phase 2 会为每个分支生成独立的测试场景。

## 客户端层错误映射追踪
外部调用（gRPC/Dubbo/HTTP）的错误映射函数也需要完整追踪：
1. 找到 gRPC stub 或 Dubbo proxy 中的错误转换函数（如 `convBizError`）
2. 解析其中的 switch/case 或 if 分支
3. 每个映射规则作为一个独立的 `errorPath` 输出
4. 这能确保 Phase 2 生成覆盖所有远程错误码的测试场景

## 调用链追踪深度
至少追踪到以下层次之一才停止：
- 数据库操作（GORM/sqlx/jdbc/mybatis）
- 外部 HTTP/gRPC 调用
- 缓存操作（Redis/local cache）
- 返回 error 的最深层

## 输出格式
请严格按以下 JSON 格式输出（不要输出其他内容）：
{
  "entryPoint": {
    "handlerFile": "internal/handler/order_handler.go",
    "handlerFunction": "GetOrderDetail",
    "routePattern": "GET /api/v1/orders/:id",
    "framework": "gin"
  },
  "fullCallChain": [
    {
      "depth": 0,
      "layer": "middleware|handler|service|repository|external",
      "filePath": "internal/handler/order_handler.go",
      "functionName": "GetOrderDetail",
      "lineRange": "45-78",
      "description": "接收请求，参数绑定，调用 service 获取订单",
      "inputParams": ["orderId string", "storeId int64"],
      "outputType": "*OrderDetailResp",
      "branches": [
        { "condition": "orderId == \"\"",   "action": "return 400", "type": "param-validation" },
        { "condition": "storeId <= 0",      "action": "return 400", "type": "param-validation" },
        { "condition": "token invalid",     "action": "return 401", "type": "auth" },
        { "condition": "config.UseCheckoutCreateGrpc()", "action": "调用 gRPC 或 Dubbo 路径", "type": "feature-flag" }
      ],
      "callees": ["OrderService.GetDetail"]
    }
  ],
  "params": [
    {
      "name": "storeId",
      "location": "query|path|header|body",
      "type": "int64",
      "required": true,
      "constraints": { "min": 1, "max": null, "pattern": null, "enum": null },
      "defaultValue": null,
      "description": "门店ID，路径参数",
      "sourceTag": "path param :storeId"
    },
    {
      "name": "storeId_from_header",
      "location": "header",
      "type": "int64",
      "required": true,
      "constraints": { "min": null, "max": null, "pattern": null, "enum": null },
      "defaultValue": null,
      "description": "门店ID，来自 header.ticket.storeId",
      "sourceTag": "header ticket JSON"
    },
    {
      "name": "ProductInfos",
      "location": "body",
      "type": "array",
      "required": true,
      "constraints": { "min": 1, "max": 100, "pattern": null, "enum": null },
      "defaultValue": null,
      "description": "商品列表，数量必须在1-100之间",
      "sourceTag": "manual Check(): len(c.ProductInfos) == 0 || len(c.ProductInfos) > 100"
    }
  ],
  "respStructure": {
    "type": "object",
    "fields": [
      { "path": "code",    "type": "string",  "description": "错误码", "exampleValue": "E0" },
      { "path": "msg",     "type": "string",  "description": "消息",   "exampleValue": "success" },
      { "path": "data.storeId", "type": "int64", "description": "门店ID" }
    ]
  },
  "businessRules": [
    {
      "type": "status-check|permission|rate-limit|business-logic",
      "file": "internal/service/order_service.go",
      "line": 123,
      "condition": "order.Status != \"open\"",
      "action": "return error \"order not in open status\"",
      "triggerScenario": "订单状态不是 open 时访问"
    }
  ],
  "errorPaths": [
    {
      "statusCode": 400,
      "errorCode": "INVALID_PARAM",
      "condition": "必填字段缺失或格式错误",
      "file": "internal/handler/order_handler.go",
      "line": 52
    }
  ],
  "externalCalls": [
    {
      "type": "database|http|grpc|cache",
      "target": "orders table",
      "operation": "SELECT",
      "file": "internal/repository/order_repo.go",
      "line": 34
    }
  ]
}
```

### 3.2 User Prompt 设计

```
请分析以下 API 请求的完整代码链路：

## 请求信息
- 请求方法：POST
- 请求路径：/api/v1/orders/detail
- 完整 URL：https://api.example.com/api/v1/orders/detail
- 请求体：{"storeId": 1709983459019, "orderId": "123456"}
- 请求头：{"Authorization": "Bearer xxx", "Content-Type": "application/json"}

## 分析要求
1. 使用工具探索项目结构，找到路由注册和 Handler 入口
2. 从 Handler 开始向下完整追踪调用链（至少到 DB 操作或外部调用）
3. 分析每一步的参数、条件分支、错误返回
4. **关键**：不仅要看 struct tag，还要追踪 `param.Check()` / `param.Validate()` 等手动校验方法
5. **关键**：追踪 header 参数提取逻辑（如 `NewAppCtx`），提取 ticket/uid/otp 等 header 字段
6. **关键**：识别 feature-flag 分支（如 `config.UseXxx()`），标记为 `type: "feature-flag"`
7. **关键**：追踪 gRPC/Dubbo 客户端层的错误映射函数（如 `convBizError`）
8. 输出格式严格遵循上述 JSON Schema

## 工具使用提示
- 先用 get_file_tree 了解项目结构
- 用 search_code 搜索路由模式（如 "POST.*detail"、路径片段）
- 用 read_file 读取 Handler → Service → Repository 的完整代码
- 确保每个 callee 都被展开读取

请自主决策，不需要询问用户许可。
```

### 3.3 新增工具（可选扩展）

当前已有 4 个工具（list_directory, read_file, search_code, get_file_tree），可选择性增加：

| 工具名 | 用途 | 优先级 |
|--------|------|--------|
| `get_callers` | 反向查找：谁调用了这个函数 | P1 |
| `get_struct_fields` | 提取 struct 字段和 tag | P2 |
| ~~`run_grep`~~ | 合并到 search_code | 不需要 |

### 3.4 真实项目验证结果（kylin POS 系统）

使用真实项目 `/Users/SL/GoProject/kylin` 的 `POST /sl/apps/pos/app/order/checkout` 接口验证方案有效性：

#### 验证对象
- 入参 curl：完整 POS checkout 请求（含 8 个 header + 7 个 body 字段）
- 项目结构：GoFrame + lego 框架，`internal/` 分层架构

#### 验证发现

| 发现 | 类型 | 说明 |
|------|------|------|
| Check() 手动校验 | **缺口-已修复** | `request.go:180-308` 的 `func (c *CheckoutParam) Check() error` 包含 16 个手动校验点，全部通过 if/return error 实现，无 struct tag |
| Header 参数认证 | **缺口-已修复** | `model.go:141-166` 的 `NewAppCtx()` 从 3 个 header（ticket, uid, otp）中提取 8 个字段 |
| 灰度分支 | **缺口-已修复** | `api.go:97` 的 `config.UseCheckoutCreateGrpc()` 决定走 gRPC 新链路还是 Dubbo 旧链路 |
| gRPC 错误映射 | **无需修复** | `checkout_stub.go:62-96` 的 `convBizError()` 包含 12 个独立错误码映射，Phase 1 的 errorPaths 已覆盖 |
| Dubbo 错误映射 | **无需修复** | `trade_operate.go:165-201` 的 7 个错误码，errorPaths 已覆盖 |
| 预售子流程 | **无需修复** | `presaleProcess()` 的 4 个错误场景，Phase 2 的 P5 错误码覆盖规则已处理 |

#### 预计场景数

按修复后的规则计算：

| 优先级 | 场景来源 | 数量 |
|--------|----------|------|
| P1 正常流程 | gRPC 路径 + Dubbo 路径（feature-flag） | 2 |
| P2 参数校验 | Check() 16 个校验点去重 | 14 |
| P4 认证鉴权 | 缺 ticket / token 过期 | 2 |
| P5 外部错误 | gRPC 12 + Dubbo 7 + presale 4 去重 | 16 |
| **合计** | | **~34 个场景** |

对比原方案的固定 3 个场景，提升 **11 倍**，且所有场景均由代码驱动生成（非硬编码）。

#### 结论
方案核心架构（两阶段双 Agent）无需调整。上述 3 个缺口已通过增强 Phase 1 的 System Prompt 解决（见 3.1 节新增的 4 个子指令）。方案可以进入实施阶段。

---

## 四、Phase 2: Test Case Generator Agent 详细设计

### 4.1 场景生成规则

#### 规则优先级（按需生成，不固定数量）

```
优先级 1：正常流程（必有 1 个）
├── 所有必填字段填入合法值
├── 所有业务条件满足
└── 预期 200 + 完整响应

优先级 2：参数校验（按 params 中的 required/constraints 决定数量）
├── 每个 required 字段 → 缺失场景（N1 个）
├── 每个有 min/max 约束的字段 → 边界值场景（N2 个）
│   ├── 最小值-1（如 gte=1 → 传 0）
│   ├── 最小值（如 gte=1 → 传 1）
│   └── 最大值+1（如 lte=150 → 传 151）
├── 每个有 pattern 的字段 → 格式错误场景（N3 个）
└── 类型错误场景（N4 个）

优先级 3：业务规则（按 businessRules 决定数量）
├── 每个 status-check → 状态不匹配场景（M1 个）
├── 每个 permission → 权限不足场景（M2 个）
└── 每个 business-logic → 业务条件违反场景（M3 个）

优先级 4：认证/鉴权（按需）
├── 无 Token → 401
├── 过期 Token → 401
└── 权限不足 Token → 403

优先级 5：错误码覆盖（按 errorPaths 决定）
└── 每个独立 errorCode → 对应场景（K 个）
```

#### 场景数量计算示例

```
一个典型的订单详情接口：
- params: storeId(required, min=1), orderId(required), currency(optional, enum)
- businessRules: status必须为open
- errorPaths: INVALID_PARAM, ORDER_NOT_FOUND, ORDER_STATUS_INVALID

生成场景：
1. 正常流程                      → 200
2. storeId 缺失                  → 400 (N1)
3. orderId 缺失                  → 400 (N1)
4. storeId=0 (违反 min=1)        → 400 (N2)
5. storeId=-1 (违反 min=1)       → 400 (N2)
6. currency=CNY (不在 enum 中)   → 400 (N3)
7. 订单状态不是 open              → 400 (M1)
8. 订单不存在                     → 404 (K1)
9. 无 Token                      → 401 (P4)

共 9 个场景，而不是固定的 3 个。
```

### 4.2 增强版 System Prompt

```markdown
你是一个资深的接口测试工程师，精通测试用例设计。

## 你的任务
根据 Code Explorer 输出的代码分析结果和原始请求数据，生成完整的接口测试用例。

## 测试用例设计原则
1. **覆盖所有代码路径**：每个 if 分支、每个 error return 至少 1 个场景
2. **覆盖所有参数约束**：每个 required/constraint 字段至少 1 个边界场景
3. **场景之间互不重复**：相同 HTTP 状态码的场景必须有不同的触发条件
4. **curl 命令可直接执行**：使用真实测试数据，URL 和 Header 与原始请求一致
5. **Python 断言格式统一**：遵循项目断言规范

## 场景类型定义

type ScenarioType =
  | "normal"           // 正常流程（200）
  | "missing-required" // 必填字段缺失（400）
  | "boundary"         // 边界值（400）
  | "type-error"       // 类型错误（400）
  | "format-error"     // 格式错误（400）
  | "business-rule"    // 业务规则违反（400/422）
  | "auth-missing"     // 缺少认证（401）
  | "auth-expired"     // 认证过期（401）
  | "forbidden"        // 权限不足（403）
  | "not-found"        // 资源不存在（404）
  | "conflict"         // 资源冲突（409）
  | "server-error"     // 服务端错误（500）

## Python 断言规范（必须严格遵循）

### 标准模板
```python
import json

# 假设 responseBody 是接口返回的 JSON 字符串
body = json.loads(responseBody)
data = body.get('data')

# ===== 基础响应校验 =====
assert body.get('code') == 'E0', "接口返回 code 不为 E0"
assert body.get('msg') == 'success', "接口返回 msg 不为 success"

# ===== 核心字段校验 =====
assert data.get('storeId') == 1709983459019
assert data.get('storeName') == 'UI自动化测试'
assert data.get('status') == 'open'
assert data.get('currency') == 'USD'
```

### 断言编写规则
1. **类目注释**：用 `# ===== 分类标题 =====` 分隔不同类别的断言
2. **错误消息**：每个 assert 必须带中文错误消息作为第三个参数
3. **逐字段断言**：不嵌套 deep equals，每个字段一行 assert
4. **只断言关键字段**：data 中的核心业务字段 + 响应状态字段（code, msg）
5. **边界值场景**：使用 assert body.get('code') != 'E0' 断言非成功
6. **缺失字段场景**：可断言特定的错误码，如 `assert body.get('code') == 'INVALID_PARAM'`
7. **不要包含 requests 调用**：断言代码只包含 assert 语句，不包含 HTTP 调用逻辑
8. **不要包含 setup/teardown**：不写入 import requests、函数定义等

## 输出格式
严格 JSON：
{
  "scenarios": [
    {
      "scenarioName": "正常流程-完整参数",
      "scenarioType": "normal",
      "expectedStatusCode": 200,
      "testData": { "storeId": 1709983459019, "orderId": "123456" },
      "callChain": [...],
      "curlCommand": "curl -X POST 'https://...' \\\n  -H '...' \\\n  -d '{...}'",
      "pythonAssertion": "import json\n\nbody = json.loads(responseBody)..."
    }
  ],
  "analysisSummary": "Markdown 格式的分析报告"
}
```

### 4.3 User Prompt 模板

```
请根据以下代码分析结果和原始请求，生成接口测试用例。

## 原始请求
- 方法：${method}
- 路径：${path}
- 完整URL：${url}
- 请求体：${requestBody}
- 请求头：${requestHeaders}

## 代码分析结果
${codeExplorationResultJson}

## 要求
1. 按测试用例设计原则生成场景（数量由代码复杂度决定）
2. curl 命令使用原始 URL 和 Headers，testData 替换为测试值
3. Python 断言严格遵循项目断言规范
4. 场景按优先级排序（正常流程排第一个）
5. analysisSummary 用 Markdown 汇总所有场景的覆盖情况
```

---

## 五、数据结构变更

### 5.1 AnalysisScenario 类型扩展

```typescript
// 当前定义（固定3种类型）
scenarioType: 'normal' | 'param-error' | 'auth-error'

// v2.0 扩展定义
scenarioType:
  | 'normal'            // 正常流程（200）
  | 'missing-required'  // 必填字段缺失（400）
  | 'boundary'          // 边界值（400）
  | 'type-error'        // 类型错误（400）
  | 'format-error'      // 格式错误（400）
  | 'business-rule'     // 业务规则违反（400/422）
  | 'auth-missing'      // 缺少认证（401）
  | 'auth-expired'      // 认证过期（401）
  | 'forbidden'         // 权限不足（403）
  | 'not-found'         // 资源不存在（404）
  | 'conflict'          // 资源冲突（409）
  | 'server-error'      // 服务端错误（500）

// 新增字段
interface AnalysisScenario {
  scenarioName: string
  scenarioType: ScenarioType         // 扩展类型
  expectedStatusCode: number         // 新增：预期HTTP状态码
  testData: Record<string, any>      // 新增：测试用入参
  callChain: CallChainStep[]
  curlCommand: string
  pythonAssertion: string
}
```

### 5.2 Code Explorer 中间结果类型（新增，内部使用）

```typescript
// Phase 1 内部输出，不传给前端
interface CodeExplorationResult {
  entryPoint: {
    handlerFile: string
    handlerFunction: string
    routePattern: string
    framework: 'gin' | 'echo' | 'fiber' | 'chi' | 'lego' | 'net/http' | 'unknown'
  }
  fullCallChain: CallChainNode[]     // 完整调用链（含分支信息）
  params: ParamDefinition[]          // 入参定义+校验规则
  respStructure: RespField[]         // 响应结构
  businessRules: BusinessRule[]      // 业务规则（if/switch分支）
  errorPaths: ErrorPath[]            // 错误路径
  externalCalls: ExternalCall[]      // 外部调用
}
```

### 5.3 ScenarioTable 前端适配

只需扩展 `scenarioBadgeClass` 函数，无需结构性改动：

```typescript
function scenarioBadgeClass(type: string): string {
  const classes: Record<string, string> = {
    normal:          'bg-green-100 text-green-600',
    'missing-required': 'bg-yellow-100 text-yellow-600',
    boundary:        'bg-yellow-100 text-yellow-600',
    'type-error':    'bg-yellow-100 text-yellow-600',
    'format-error':  'bg-yellow-100 text-yellow-600',
    'business-rule': 'bg-orange-100 text-orange-600',
    'auth-missing':  'bg-red-100 text-red-600',
    'auth-expired':  'bg-red-100 text-red-600',
    forbidden:       'bg-red-100 text-red-600',
    'not-found':     'bg-gray-100 text-gray-600',
    conflict:        'bg-purple-100 text-purple-600',
    'server-error':  'bg-red-200 text-red-700',
  }
  return classes[type] || 'bg-gray-100 text-gray-600'
}
```

---

## 六、实施计划（5 个 Phase）

> ⚠️ **兼容性审查**: 本计划已通过兼容性审查（详见 `docs/ai-analysis-compatibility-audit.md`），
> 修正了 2 个 P0 问题（类型变更部署顺序、降级回退路径）和 3 个 P1 问题（SSE 事件、状态混合、Phase 映射）。

### Phase 0: 基础设施准备（1天）

| # | 任务 | 文件 |
|---|------|------|
| 0.1 | 新增 `'code-exploring'` 和 `'test-generating'` 到 `AnalysisPhase` | `src/services/types.ts` |
| 0.2 | 扩展 `AnalysisScenario.scenarioType`（12 种 + 保留旧 3 种作为过渡，Phase 3.2 删除旧类型） | `src/services/types.ts` |
| 0.3 | 添加 `expectedStatusCode`、`testData` 字段到 `AnalysisScenario` | `src/services/types.ts` |
| 0.4 | 添加 `CodeExplorationResult` 中间类型定义 | `electron/services/types.ts`（新增） |
| 0.5 | 扩展 `ScenarioTable.vue` 的 badge 颜色映射（覆盖全部 12 种） | `src/components/ScenarioTable.vue` |
| 0.6 | `sse.ts` 的 `processMessage()` 增加 `code_explorer_*` 事件处理 | `src/services/sse.ts` |
| 0.7 | `ai-analysis-store.ts` 的 `phaseMapping` 增加 `code-explorer` / `test-generator` 映射 | `src/stores/ai-analysis-store.ts` |

### Phase 1: Code Explorer Agent（2天）

| # | 任务 | 文件 |
|---|------|------|
| 1.1 | 设计 Phase 1 的 System Prompt（代码探索专家，.md 格式） | `electron/services/prompts/code-explorer-system.md`（新增） |
| 1.2 | 设计 Phase 1 的 User Prompt 模板（.md 格式） | `electron/services/prompts/code-explorer-user.md`（新增） |
| 1.3 | 实现 `prompt-loader.ts`（统一 Prompt 加载器） | `electron/services/prompts/prompt-loader.ts`（新增） |
| 1.4 | 实现 `phase1ExploreCode()` 方法 — 调用 AI Agent 探索代码，含 JSON 解析 + retry | `electron/services/ai-analyze-service.ts` |
| 1.5 | 实现 `parseExplorationResult()` — 解析 Code Explorer 输出，含格式修复 | 同上 |
| 1.6 | Phase 1 工具调用：MAX_TOOL_CALLS=15，超时 120s，SSE 复用现有 agent_* 事件（加 `phase:'explorer'` 前缀区分） | 同上 |

### Phase 2: Test Case Generator Agent（2天）

| # | 任务 | 文件 |
|---|------|------|
| 2.1 | 设计 Phase 2 的 System Prompt（测试用例生成器，含断言规范） | `electron/services/prompts/test-generator-system.md`（新增） |
| 2.2 | 设计 Phase 2 的 User Prompt 模板（含变量占位） | `electron/services/prompts/test-generator-user.md`（新增） |
| 2.3 | 实现 `phase2GenerateTests()` 方法 | `electron/services/ai-analyze-service.ts` |
| 2.4 | 实现 `parseScenariosResult()` — 解析 Test Generator 输出 | 同上 |
| 2.5 | 整合 `analysisSummary` 生成（Phase 1 摘要 + Phase 2 报告合并） | 同上 |
| 2.6 | Phase 2 工具调用：MAX_TOOL_CALLS=10，SSE 推送进度

### Phase 3: Pipeline 整合 & 主流程改造（1天）

| # | 任务 | 文件 |
|---|------|------|
| 3.1 | 重写 `analyzeWithAgent()` → 两阶段 Pipeline，**含降级回退**（Phase 1 失败 → fallback 单 Agent 模式） | `electron/services/ai-analyze-service.ts` |
| 3.2 | 删除 `scenarioType` 中过渡旧类型（`param-error`/`auth-error`），确认此时已无代码使用旧类型 | `src/services/types.ts` |
| 3.3 | 进度页 `AiAnalysisProgressView.vue` 增加 Phase 1 / Phase 2 子进度指示 | `src/views/AiAnalysisProgressView.vue` |
| 3.4 | `agentThinking` 在 Phase 1 → Phase 2 切换时自动插入分隔标记 | `src/stores/ai-analysis-store.ts` |
| 3.5 | 集成测试：端到端分析流程验证 | `tests/` |

### Phase 4: 结果页优化 & 测试（1天）

| # | 任务 | 文件 |
|---|------|------|
| 4.1 | `CurlAssertionPanel.vue` 新增显示 expectedStatusCode、testData | `src/components/CurlAssertionPanel.vue` |
| 4.2 | 结果页增加"场景覆盖度"统计卡（覆盖率百分比） | `src/views/AiAnalysisResultView.vue` |
| 4.3 | 使用真实 Go 项目进行多场景测试 | 手动测试 |
| 4.4 | 文档更新 | `docs/` |

---

## 七、Prompt 文件结构（新增）

为解耦 Prompt 逻辑，建议从单体 `ai-analyze-service.ts` 中抽出 Prompt 到独立文件：

```
electron/services/prompts/
├── code-explorer-system.md   # Phase 1 System Prompt（Markdown，更易维护）
├── code-explorer-user.md     # Phase 1 User Prompt 模板
├── test-generator-system.md  # Phase 2 System Prompt（含断言规范）
├── test-generator-user.md    # Phase 2 User Prompt 模板
└── prompt-loader.ts          # 统一的 Prompt 加载器（支持变量替换）
```

### prompt-loader.ts 示例

```typescript
import * as fs from 'fs'
import * as path from 'path'

const PROMPT_DIR = path.join(__dirname, 'prompts')

export function loadPrompt(name: string, variables?: Record<string, string>): string {
  let content = fs.readFileSync(path.join(PROMPT_DIR, name), 'utf-8')
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, value)
    }
  }
  return content
}
```

这样做的好处：
- Prompt 可独立 review 和版本管理
- 非开发人员也能 review Prompt 质量
- 方便 A/B 测试不同的 Prompt 版本

---

## 八、Python 断言规范（标准模板）

基于用户提供的参考脚本，统一断言输出格式：

### 8.1 正常流程模板

```python
import json

# 假设 responseBody 是接口返回的 JSON 字符串
body = json.loads(responseBody)
data = body.get('data')

# ===== 基础响应校验 =====
assert body.get('code') == 'E0', "接口返回 code 不为 E0"
assert body.get('msg') == 'success', "接口返回 msg 不为 success"

# ===== 核心字段校验 =====
assert data.get('storeId') == 1709983459019
assert data.get('storeName') == 'UI自动化测试'
assert data.get('status') == 'open'
assert data.get('currency') == 'USD'

# ===== 嵌套字段校验 =====
# （如果有嵌套对象，逐层展开断言）
```

### 8.2 错误场景模板

```python
import json

body = json.loads(responseBody)

# ===== 错误响应校验 =====
assert body.get('code') != 'E0', "期望返回错误码，实际返回 E0"
assert body.get('code') == 'INVALID_PARAM', f"期望错误码 INVALID_PARAM，实际 {body.get('code')}"
assert body.get('msg') != 'success', "期望返回错误消息"
# 校验 data 为空（如果业务逻辑如此）
assert body.get('data') is None, "错误场景下 data 应为 null"
```

### 8.3 字段缺失场景模板

```python
import json

body = json.loads(responseBody)

# ===== 参数校验失败断言 =====
# 缺少必填字段 storeId，预期返回 400 错误
assert body.get('code') != 'E0', "期望返回错误码，实际返回 E0"
assert body.get('code') == 'INVALID_PARAM', f"期望错误码 INVALID_PARAM，实际 {body.get('code')}"
# 错误消息应明确指出缺失的字段
assert 'storeId' in str(body.get('msg', '')).lower(), "错误消息应提到 storeId"
```

---

## 九、效果对比

| 指标 | v1.0（当前） | v2.0（优化后） | 提升 |
|------|-------------|---------------|------|
| 场景数量 | 固定 3 个 | 动态 3-20 个 | **按需生成** |
| 调用链深度 | Router → Handler | Router → Handler → Service → Repository → DB | **+3 层** |
| 分支覆盖率 | 0%（不分析 if） | 80%+（每个分支至少1场景） | **量变到质变** |
| 语言支持 | Go only | Go（可扩展） | 架构支持扩展 |
| 断言格式 | 自由发挥 | 规范模板 | **可复现** |
| Prompt 维护性 | 硬编码在 .ts 中 | 独立 .md 文件管理 | **可协作** |
| 前端改动 | N/A | 仅 badge 颜色扩展 | **最小化** |

---

## 十、风险和缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Phase 1 生成的 JSON 解析失败 | 中 | 高 | 增加 retry + 格式修复逻辑；JSON Schema 校验 |
| Phase 2 场景过多（>20个） | 低 | 中 | 设置 MAX_SCENARIOS=15，按优先级截断 |
| 两次 API 调用增加延迟 | 高 | 中 | 并行展示 + 流式输出；总超时 10min |
| Token 消耗翻倍 | 高 | 低 | Phase 1 输出做 token 压缩；只传关键参数给 Phase 2 |

---

## 十一、与现有代码的兼容性

> 📋 **已通过兼容性审查**，详见 `docs/ai-analysis-compatibility-audit.md`（发现 8 个问题，2个P0+3个P1+3个P2，全部在实施计划中已修正）

### 不需要改的
- ✅ `AiAnalysisResultView.vue` 整体结构
- ✅ `AiAnalysisView.vue` 配置页面
- ✅ `CurlAssertionPanel.vue` 组件（props 不变）
- ✅ `ai-analysis-store.ts` 核心逻辑（仅扩展 phaseMapping）
- ✅ SSE 通信架构（pushSSEEvent/pushDone/pushProgress 接口不变）
- ✅ IPC 通道和通信协议（IPC_CHANNELS 不变）
- ✅ 仓库克隆/分支获取（executeAnalysisAsync 调用不变）
- ✅ 工具执行器（AIAgentToolExecutor，4 个工具不变）

### 需要改的
- 🔧 `src/services/types.ts` — 扩展 scenarioType（12种）、AnalysisPhase（+2）、新增字段（+2）
- 🔧 `src/services/sse.ts` — `processMessage()` 增加 `code_explorer_*` 事件处理
- 🔧 `src/stores/ai-analysis-store.ts` — phaseMapping 扩展、agentThinking 分隔
- 🔧 `src/components/ScenarioTable.vue` — 扩展 badge 颜色（3→12）
- 🔧 `electron/services/ai-analyze-service.ts` — 核心流程重构（含降级回退）

### 需要新增的
- ➕ `electron/services/prompts/` 目录 — 4 个 Prompt .md 文件 + 1 个 loader
- ➕ `electron/services/types.ts` — `CodeExplorationResult` 等内部类型定义
- ➕ `docs/ai-analysis-compatibility-audit.md` — 兼容性审查报告

---

**Plan 版本**: v1.0  
**最后更新**: 2026-06-26
