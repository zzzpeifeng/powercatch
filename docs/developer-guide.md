# 开发者指南

## 1. 项目概述

PowerCatch 是一款基于 Electron 的 HTTP/HTTPS 抓包调试工具，支持流量拦截、查看、AI 智能分析。

---

## 2. 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | Electron 28 + Vue 3 + Vite 5 |
| **语言** | TypeScript |
| **样式** | Tailwind CSS |
| **状态管理** | Pinia |
| **代理引擎** | http-mitm-proxy |
| **数据存储** | better-sqlite3 (SQLite) |
| **Markdown** | markdown-it + DOMPurify |
| **代码高亮** | Shiki |
| **AI API** | OpenAI SDK（兼容 DeepSeek、通义千问等） |

---

## 3. 项目结构

```
powercatch/
├── electron/                    # Electron 主进程
│   ├── main.ts                 # 入口文件
│   ├── ipc.ts                 # IPC 通信处理
│   ├── preload.ts             # 预加载脚本
│   ├── proxy/                 # MITM 代理服务
│   │   └── mitm-proxy.ts    # 代理核心实现
│   ├── db/                    # SQLite 数据库
│   │   └── database.ts       # 数据库操作封装
│   └── services/              # 业务服务
│       ├── ai-analyze-service.ts      # AI 分析服务（纯 AI Agent 模式）
│       ├── ai-agent-tool-executor.ts  # AI Agent 工具调用执行器
│       ├── sse-manager.ts            # SSE 管理器
│       └── __tests__/              # 服务层单元测试
│           ├── ai-agent-tool-executor.test.ts
│           └── ...
├── src/                        # 渲染进程（Vue 3）
│   ├── components/             # 组件
│   ├── views/                 # 页面视图
│   │   ├── AiAnalysisView.vue       # AI 分析页面
│   │   └── ...
│   ├── stores/                # Pinia 状态管理
│   ├── services/              # 前端服务（API 调用）
│   │   └── ai-analysis-api.ts     # AI 分析 API 客户端
│   └── styles/               # 全局样式
├── docs/                       # 文档
│   ├── user-guide.md         # 用户使用指南
│   ├── developer-guide.md    # 开发者指南（本文件）
│   ├── refactor-ai-analysis.md  # AI 分析重构说明
│   └── ...
├── tests/                      # 测试
│   ├── e2e/                 # E2E 测试
│   └── ...
├── resources/                  # 图标、证书等资源
└── release/                   # 构建产物输出目录
```

---

## 4. AI 分析功能架构（重构后）

### 4.1 架构概览

**重构版本**: v1.1.0  
**核心变更**: 移除 ScanWorker，采用纯 AI Agent 模式

```
┌─────────────────────────────────────────────────────┐
│                   前端（Vue 3）                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  AiAnalysisView.vue                        │  │
│  │  - 显示分析进度（实时）                    │  │
│  │  - 显示 AI 思考过程（新增）               │  │
│  │  - 显示工具调用记录（新增）                │  │
│  │  - 显示分析结果                          │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │ SSE 连接                      │
└─────────────────────┼─────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              Electron 主进程（Node.js）              │
│  ┌─────────────────────────────────────────────┐  │
│  │  ai-analysis-api.ts (API 客户端)           │  │
│  │  - 创建 SSE 连接                          │  │
│  │  - 处理 SSE 事件                          │  │
│  │  - 推送进度到 Vuex/Pinia                  │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │                                  │
│  ┌──────────────────▼──────────────────────────┐  │
│  │  AIAnalyzeService (AI 分析服务)           │  │
│  │  - analyze() → analyzeWithAgent()          │  │
│  │  - 调用 OpenAI API（流式输出）            │  │
│  │  - 处理 AI 工具调用                       │  │
│  │  - 推送 SSE 事件                          │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │                                  │
│  ┌──────────────────▼──────────────────────────┐  │
│  │  AIAgentToolExecutor (工具调用执行器)      │  │
│  │  - list_directory                          │  │
│  │  - read_file                               │  │
│  │  - search_code                             │  │
│  │  - get_file_tree                           │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │                                  │
│  ┌──────────────────▼──────────────────────────┐  │
│  │  SSEManager (SSE 管理器)                  │  │
│  │  - 启动/停止 SSE 服务器                   │  │
│  │  - 管理客户端连接                         │  │
│  │  - 推送 SSE 事件                          │  │
│  │  - 心跳机制                                │  │
│  │  - 空闲超时                                │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              OpenAI API (或兼容接口)                │
│  - chat.completions.create (stream: true)         │
│  - Function Calling (工具调用)                    │
└─────────────────────────────────────────────────────┘
```

### 4.2 核心模块说明

#### 4.2.1 AIAnalyzeService

**文件**: `electron/services/ai-analyze-service.ts`

**职责**:
- 接收前端分析请求
- 调用 OpenAI API（流式输出）
- 处理 AI 工具调用请求
- 推送分析进度（SSE）

**核心方法**:
```typescript
class AIAnalyzeService {
  // 执行 AI 代码分析（纯 AI Agent 模式）
  async analyze(request: AnalyzeRequest): Promise<AnalyzeResult>

  // AI Agent 分析（核心方法）
  private async analyzeWithAgent(request: {
    clonePath: string
    method: string
    url: string
  }): Promise<AnalyzeResult>

  // 解析 AI 响应，提取分析报告和结构化场景
  private parseAIResponse(content: string): {
    analysis: string
    scenarios: AnalysisScenario[]
    matches: RouteMatch[]
  }
}
```

#### 4.2.2 AIAgentToolExecutor

**文件**: `electron/services/ai-agent-tool-executor.ts`

**职责**:
- 封装 AI 工具调用
- 提供文件系统操作能力
- 安全防护（路径遍历、文件大小限制、超时保护）

**工具列表**:
```typescript
class AIAgentToolExecutor {
  // 列出目录内容
  private async listDirectory(relativePath: string): Promise<ToolCallResult>

  // 读取文件内容
  private async readFile(relativePath: string): Promise<ToolCallResult>

  // 在代码中搜索关键字
  private async searchCode(keyword: string, filePattern?: string): Promise<ToolCallResult>

  // 获取文件树结构
  private async getFileTree(): Promise<ToolCallResult>
}
```

**安全机制**:
1. **路径遍历防护**:
```typescript
private resolvePath(relativePath: string): string {
  const resolved = path.resolve(this.clonePath, relativePath)
  if (!resolved.startsWith(this.clonePath)) {
    throw new Error(`Path traversal detected: ${relativePath}`)
  }
  return resolved
}
```

2. **文件大小限制**:
```typescript
// 检查文件大小（限制 1MB）
if (stats.size > 1024 * 1024) {
  return {
    success: false,
    error: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${relativePath}`,
  }
}
```

3. **超时保护**:
```typescript
private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Tool execution timeout (${this.timeoutMs}ms): ${label}`))
    }, this.timeoutMs)
  })

  return Promise.race([promise, timeoutPromise])
}
```

#### 4.2.3 SSEManager

**文件**: `electron/sse-manager.ts`

**职责**:
- 启动/停止 SSE 服务器
- 管理客户端连接（添加、移除、心跳、超时）
- 推送 SSE 事件到所有连接的客户端

**SSE 事件类型**:
| 事件名称 | 数据格式 | 说明 |
|---------|---------|------|
| `connected` | `{ message: string }` | 客户端连接成功 |
| `progress` | `{ phase: string, message: string, ... }` | 分析进度 |
| `log` | `{ level: string, message: string }` | 日志消息 |
| `agent_thinking` | `{ content: string, timestamp: number }` | AI 思考过程（流式） |
| `agent_tool_call` | `{ tool: string, args: any, timestamp: number }` | AI 调用工具 |
| `agent_tool_result` | `{ tool: string, result: any, timestamp: number }` | 工具执行结果 |
| `done` | `{ result: any }` | 分析完成 |
| `error` | `{ message: string }` | 分析错误 |
| `heartbeat` | `{ timestamp: number }` | 心跳事件 |
| `disconnect` | `{ message: string }` | 服务器关闭 |

**SSE 消息格式**（严格遵循 SSE 规范）:
```
event: <event-name>
data: <json-data>

```

**示例**:
```
event: agent_thinking
data: {"content":"正在分析...","timestamp":1719216000000}

```

---

## 5. 开发指南

### 5.1 环境搭建

**系统要求**:
- macOS 10.15+ / Windows 10+ / Linux (Ubuntu 20.04+)
- Node.js 18+
- npm 9+

**安装依赖**:
```bash
# 克隆仓库
git clone https://github.com/zzzpeifeng/powercatch.git
cd powercatch

# 安装依赖
npm install

# 如果 Electron 下载缓慢，配置镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

### 5.2 开发模式

**启动开发服务器**:
```bash
# 仅启动前端开发服务器（调试 UI）
npm run dev

# 启动完整 Electron 开发模式（热更新）
npm run electron:dev
```

**调试技巧**:
1. **渲染进程调试**: `Cmd/Ctrl + Shift + I` 打开开发者工具
2. **主进程调试**: 在 VS Code 中使用 `.vscode/launch.json` 配置
3. **查看日志**: 主进程日志在终端输出，渲染进程日志在开发者工具中

### 5.3 构建和打包

**构建前端 + 主进程**:
```bash
npm run build
```

**完整打包**:
```bash
npm run electron:build
```

**输出位置**:
- macOS: `release/mac-arm64/` 或 `release/mac-x64/`
- Windows: `release/win-unpacked/`
- Linux: `release/linux-unpacked/`

---

## 6. 测试指南

### 6.1 单元测试

**运行所有单元测试**:
```bash
npm run test
```

**运行指定测试文件**:
```bash
# 测试 AIAgentToolExecutor
npx vitest run electron/services/__tests__/ai-agent-tool-executor.test.ts

# 测试 AIAnalyzeService
npx vitest run electron/__tests__/ai-analyze-service.test.ts

# 测试 SSEManager
npx vitest run electron/__tests__/sse-manager.test.ts
```

**测试覆盖率**:
```bash
npm run test:coverage
```

**目标覆盖率**: > 80%

### 6.2 E2E 测试

**安装 Playwright**（推荐）:
```bash
npm install -D @playwright/test
npx playwright install
```

**运行 E2E 测试**:
```bash
npm run test:e2e
```

**编写 E2E 测试**:
参见 `tests/e2e/ai-analysis.spec.ts` 示例

### 6.3 手动测试

**测试场景**:
1. 分析小型 Go 项目（< 100 个文件）
2. 分析中型 Go 项目（100-1000 个文件）
3. 分析大型 Go 项目（> 1000 个文件）
4. API 限流错误处理
5. 网络连接错误处理
6. 前端 UI 显示正确性

---

## 7. 代码规范

### 7.1 代码风格

- **缩进**: 2 空格
- **引号**: 单引号（TypeScript），双引号（HTML）
- **分号**: 必须使用
- **命名规范**:
  - 类名：PascalCase（`AIAnalyzeService`）
  - 方法名：camelCase（`analyzeWithAgent`）
  - 常量：UPPER_SNAKE_CASE（`MAX_TOOL_CALLS`）
  - 文件名：kebab-case（`ai-analyze-service.ts`）

### 7.2 注释规范

**函数注释**（JSDoc 格式）:
```typescript
/**
 * 执行 AI 代码分析（纯 AI Agent 模式）
 *
 * 工作流程：
 * 1. 直接调用 AI Agent 分析
 * 2. AI 通过工具调用自主搜索代码
 * 3. 实时推送分析过程
 * 4. 生成分析报告
 *
 * @param request 分析请求参数
 * @returns 分析结果
 */
async analyze(request: AnalyzeRequest): Promise<AnalyzeResult>
```

**行内注释**:
```typescript
// 创建工具执行器
const toolExecutor = new AIAgentToolExecutor(clonePath)

// 推送开始消息
this.pushAgentThinking('开始分析代码仓库...')
```

### 7.3 提交规范

**Commit 格式**（Conventional Commits）:
```
<type>(<scope>): <subject>

<body>

<footer>
```

**示例**:
```
feat(ai-analyze): 添加 AI Agent 工具调用执行器

- 新增 AIAgentToolExecutor 类
- 支持 list_directory、read_file、search_code、get_file_tree 工具
- 添加路径遍历防护和文件大小限制

Refs: #123
```

**Type 列表**:
- `feat`: 新功能
- `fix`: 修复 Bug
- `refactor`: 重构（不改变行为的代码变更）
- `docs`: 文档更新
- `test`: 测试相关
- `chore`: 构建/工具链相关

---

## 8. 贡献指南

### 8.1 提交 Issue

**Bug 报告**:
- 使用 [Bug 报告模板](https://github.com/zzzpeifeng/powercatch/issues/new?template=bug_report.md)
- 包含：复现步骤、预期行为、实际行为、截图

**功能建议**:
- 使用 [功能建议模板](https://github.com/zzzpeifeng/powercatch/issues/new?template=feature_request.md)
- 包含：功能描述、使用场景、预期效果

### 8.2 提交 Pull Request

**流程**:
1. Fork 仓库
2. 创建功能分支（`git checkout -b feat/ai-multi-language`）
3. 提交变更（`git commit -m "feat(ai): 支持多语言分析"`）
4. 推送到 Fork（`git push origin feat/ai-multi-language`）
5. 创建 Pull Request

**PR 要求**:
- 包含测试用例
- 包含文档更新
- 通过所有 CI 检查
- 代码覆盖率不降低

---

## 9. 常见问题

### 9.1 如何添加新的 AI 工具？

**步骤**:
1. 在 `AIAgentToolExecutor` 中新增工具方法
2. 在 `executeTool()` 的 `switch` 语句中新增 `case`
3. 在 `AIAnalyzeService` 的 `tools` 数组中新增工具定义
4. 更新 System Prompt，告知 AI 新工具的用法
5. 编写单元测试

**示例**：新增 `find_route` 工具
```typescript
// 1. 新增工具方法
private async findRoute(method: string, url: string): Promise<ToolCallResult> {
  // 实现逻辑
}

// 2. 在 executeTool() 中新增 case
case 'find_route':
  result = await this.withTimeout(
    this.findRoute(args.method, args.url),
    `find_route(${args.method}, ${args.url})`
  )
  break

// 3. 在 AIAnalyzeService 中新增工具定义
{
  type: 'function',
  function: {
    name: 'find_route',
    description: '直接查找路由定义',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP 方法' },
        url: { type: 'string', description: '请求路径' },
      },
      required: ['method', 'url'],
    },
  },
}
```

### 9.2 如何支持新的 AI 模型？

**步骤**:
1. 确认新模型支持 OpenAI API 格式
2. 在设置页面新增模型选项（如果需要）
3. 测试工具调用功能（不同模型对 Function Calling 的支持程度不同）

**当前已测试模型**:
- ✅ DeepSeek Chat (`deepseek-chat`)
- ✅ OpenAI GPT-3.5 (`gpt-3.5-turbo`)
- ✅ OpenAI GPT-4 (`gpt-4-turbo`)
- ⏳ 通义千问（待测试）
- ⏳ Claude（待测试）

### 9.3 如何调试 SSE 连接？

**方法一：使用浏览器开发者工具**:
1. 打开 Network 面板
2. 找到 SSE 请求（`/ai-analysis-progress`）
3. 查看 Response 选项卡，观察实时推送的事件

**方法二：使用 curl**:
```bash
curl -N http://localhost:3001/ai-analysis-progress
```

**方法三：查看终端日志**:
```bash
# 主进程终端会输出：
[ SSE] 客户端连接，当前连接数: 1
[ SSE] 心跳已启动，间隔: 30000ms
[ SSE] 推送事件: agent_thinking
```

---

## 10. 相关文档

- [用户使用指南](./user-guide.md)
- [AI 分析重构说明](./refactor-ai-analysis.md)
- [AI 代码分析 PRD](./ai-code-analysis-prd.md)
- [AI 代码分析架构设计](./ai-code-analysis-architecture.md)
- [系统设计方案](./system-design.md)

---

**文档版本**: v1.1.0  
**最后更新**: 2024年6月24日  
**维护者**: PowerCatch 开发团队
