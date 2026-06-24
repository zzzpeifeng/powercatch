# AI 分析功能重构说明

## 重构概述

**重构时间**: 2024年6月24日  
**重构版本**: v1.1.0  
**重构原因**: 正则提取导致应用卡死，用户体验差

---

## 1. 重构原因

### 1.1 问题描述

原有的 AI 分析功能使用 **正则提取 + ScanWorker** 的方式：

1. **阶段1（快速扫描）**: 使用正则表达式在本地代码中搜索路由定义
   - 问题：正则表达式复杂，容易匹配失败或误匹配
   - 问题：对于复杂的路由注册方式（如动态路由、中间件链式调用），无法正确提取

2. **阶段2（AI 深度分析）**: 将阶段1的匹配结果发送给 AI 进行分析
   - 问题：如果阶段1匹配失败，阶段2 无法正常工作
   - 问题：ScanWorker 占用大量内存，容易导致应用卡死

### 1.2 具体案例

**案例1：应用卡死**
- **现象**: 用户点击"AI分析"按钮后，应用界面卡死，无法操作
- **原因**: ScanWorker 在扫描大型代码仓库时占用大量内存和 CPU
- **影响**: 用户只能强制退出应用

**案例2：匹配失败**
- **现象**: AI 分析结果不准确，找不到对应的 Handler 函数
- **原因**: 正则表达式无法匹配动态路由（如 `/api/v1/:id`）
- **影响**: 分析结果无效，用户需要重新分析

---

## 2. 重构方案

### 2.1 核心思路

**采用纯 AI Agent 模式**，让 AI 自主搜索和分析代码：

- ❌ **移除**: ScanWorker 和正则提取逻辑
- ✅ **新增**: AIAgentToolExecutor（工具调用执行器）
- ✅ **新增**: 流式输出 AI 分析过程
- ✅ **新增**: SSE 实时推送分析进度

### 2.2 工作流程

```
用户点击"AI分析"
    ↓
调用 AIAnalyzeService.analyze()
    ↓
创建 AIAgentToolExecutor
    ↓
调用 OpenAI API（流式输出）
    ↓
AI 自主调用工具（list_directory, read_file, search_code, get_file_tree）
    ↓
实时推送分析过程（SSE）
    ↓
AI 生成最终分析报告
    ↓
推送完成事件（SSE）
    ↓
前端显示分析结果
```

### 2.3 工具定义

AI Agent 可以使用以下工具：

| 工具名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| `list_directory` | 列出目录内容 | 了解项目结构 |
| `read_file` | 读取文件内容 | 查看代码实现 |
| `search_code` | 搜索代码关键字 | 快速定位相关代码 |
| `get_file_tree` | 获取完整文件树 | 了解项目全貌 |

---

## 3. 主要变更

### 3.1 移除的文件

- ❌ `electron/services/scan-worker.ts` — ScanWorker 实现
- ❌ `electron/services/scan-worker-manager.ts` — ScanWorker 管理器

### 3.2 新增的文件

- ✅ `electron/services/ai-agent-tool-executor.ts` — AI Agent 工具调用执行器

### 3.3 修改的文件

- ✏️ `electron/services/ai-analyze-service.ts` — 重构为纯 AI Agent 模式
  - 移除 `analyzeWithScanWorker()` 方法
  - 移除 `ScanWorkerManager` 依赖
  - 新增 `analyzeWithAgent()` 方法
  - 新增流式输出支持

- ✏️ `electron/sse-manager.ts` — 增强 SSE 功能
  - 新增 `pushAgentThinking()` — 推送 AI 思考过程
  - 新增 `pushAgentToolCall()` — 推送工具调用事件
  - 新增 `pushAgentToolResult()` — 推送工具执行结果
  - 新增 token 缓冲区机制（避免高频推送）

- ✏️ `src/views/AiAnalysisView.vue` — 前端 UI 调整
  - 移除"扫描阶段"进度显示
  - 新增"AI 分析过程"实时显示
  - 新增工具调用记录显示

- ✏️ `src/services/ai-analysis-api.ts` — API 客户端更新
  - 更新 SSE 事件类型定义
  - 新增 `AgentThinkingEvent`、`AgentToolCallEvent`、`AgentToolResultEvent`

### 3.4 配置文件变更

**无配置变更** — 重构不影响用户配置

---

## 4. 技术细节

### 4.1 AIAgentToolExecutor

**功能**: 封装 AI 工具调用，提供文件系统操作能力

**安全机制**:
1. **路径遍历防护**: 使用 `path.resolve()` + 前缀检查，防止 `../../../etc/passwd` 攻击
2. **文件大小限制**: 限制读取文件大小为 1MB，防止内存溢出
3. **超时保护**: 每个工具调用限制 30 秒超时
4. **目录遍历限制**: 跳过 `node_modules`、`.git`、`vendor` 等目录

**代码示例**:
```typescript
// 路径遍历防护
private resolvePath(relativePath: string): string {
  const resolved = path.resolve(this.clonePath, relativePath)
  if (!resolved.startsWith(this.clonePath)) {
    throw new Error(`Path traversal detected: ${relativePath}`)
  }
  return resolved
}
```

### 4.2 流式输出

**实现方式**: 使用 OpenAI API 的 `stream: true` 参数

**推送事件**:
- `agent_thinking`: AI 思考过程（token 缓冲机制）
- `agent_tool_call`: AI 调用工具
- `agent_tool_result`: 工具执行结果
- `progress`: 分析进度
- `done`: 分析完成
- `error`: 分析错误

**token 缓冲机制**:
- 缓冲区大小：10 个 token
- 刷新超时：500ms
- 目的：避免高频推送导致客户端积压

### 4.3 SSE 连接管理

**心跳机制**:
- 间隔：30 秒
- 目的：保持连接活跃，检测断开

**空闲超时**:
- 时间：10 分钟
- 目的：自动清理无效连接

**重连机制**:
- 重试间隔：3 秒（通过 `retry: 3000` 字段告知客户端）
- 目的：网络抖动时自动恢复

---

## 5. 优势对比

| 对比项 | 重构前（ScanWorker） | 重构后（纯 AI Agent） |
|-------|-------------------|---------------------|
| **分析精度** | 依赖正则提取，容易失败 | AI 自主搜索，精度更高 |
| **内存占用** | ScanWorker 占用大量内存 | 按需读取文件，内存占用低 |
| **用户体验** | 容易卡死，无进度反馈 | 流式输出，实时反馈 |
| **可维护性** | 复杂的正则表达式 | 简单的工具调用 |
| **扩展性** | 新增语言支持需要重写正则 | AI 自动适配不同语言 |
| **分析深度** | 只分析匹配到的文件 | AI 自主决定分析深度 |

---

## 6. 迁移指南

### 6.1 对于用户

**无需任何操作** — 重构不影响用户配置和使用习惯

### 6.2 对于开发者

**代码变更**:
1. `AIAnalyzeService` 的 `analyze()` 方法现在直接调用 `analyzeWithAgent()`
2. 不再需要 `ScanWorkerManager` 实例
3. SSE 事件类型新增 `agent_thinking`、`agent_tool_call`、`agent_tool_result`

**API 变更**:
- ❌ 移除: `scan-progress` 事件中的 `phase: 'scanning'`
- ✅ 新增: `agent_thinking`、`agent_tool_call`、`agent_tool_result` 事件

**测试变更**:
- 移除 ScanWorker 相关测试
- 新增 AIAgentToolExecutor 测试
- 新增 AI Agent 分析流程测试

---

## 7. 已知问题

### 7.1 工具调用次数限制

- **问题**: 为了防止无限循环，限制最大工具调用次数为 20 次
- **影响**: 对于超大型项目，可能无法完成完整分析
- **计划**: 在未来版本中优化工具调用策略，或提供"深度分析"选项

### 7.2 API 限流处理

- **问题**: 当 API 限流时（429 错误），当前只显示友好提示，不自动重试
- **影响**: 用户需要手动重新分析
- **计划**: 在未来版本中实现指数退避重试机制

### 7.3 分析结果一致性

- **问题**: 由于 AI 的随机性，同一代码仓库的分析结果可能略有差异
- **影响**: 测试结果可能不稳定
- **计划**: 在 AI Prompt 中增加约束，提高一致性

---

## 8. 后续优化

### 8.1 短期优化（1-2 周）

- [ ] 实现 API 限流自动重试机制
- [ ] 优化 token 缓冲区算法（自适应缓冲）
- [ ] 增加分析结果缓存（相同代码仓库 + 相同 API 请求 = 直接返回缓存）

### 8.2 中期优化（1-2 月）

- [ ] 支持多种 AI 模型（Claude、Gemini 等）
- [ ] 提供"分析深度"配置选项（快速/标准/深度）
- [ ] 实现分析结果对比功能（对比不同版本代码的分析结果）

### 8.3 长期优化（3-6 月）

- [ ] 支持多种编程语言（Java、Python、Node.js 等）
- [ ] 实现"增量分析"功能（只分析变更的文件）
- [ ] 提供 VS Code 插件版本

---

## 9. 测试验证

### 9.1 单元测试

- ✅ `ai-agent-tool-executor.test.ts` — AIAgentToolExecutor 测试
- ✅ `ai-analyze-service.test.ts` — AIAnalyzeService 测试（更新）
- ✅ `sse-manager.test.ts` — SSE Manager 测试（更新）

### 9.2 集成测试

- ⏳ E2E 测试（进行中）

### 9.3 手动测试

**测试场景**:
1. 分析小型 Go 项目（< 100 个文件）✅
2. 分析中型 Go 项目（100-1000 个文件）⏳
3. 分析大型 Go 项目（> 1000 个文件）⏳
4. API 限流错误处理 ⏳
5. 网络连接错误处理 ⏳
6. 前端 UI 显示正确性 ⏳

---

## 10. 附录

### 10.1 相关文档

- [AI 代码分析 PRD](./ai-code-analysis-prd.md)
- [AI 代码分析架构设计](./ai-code-analysis-architecture.md)
- [系统设计方案](./system-design.md)

### 10.2 相关提交

- `T01: 清理 types.ts 中的 ScanWorker 相关类型定义`
- `T02: 创建 AIAgentToolExecutor 工具调用执行器`
- `T03: 重构 AIAnalyzeService`
- `T04: 前端 UI 调整 + SSE 连接优化`
- `T05: 测试 + 文档`

---

**文档版本**: v1.0  
**最后更新**: 2024年6月24日  
**维护者**: PowerCatch 开发团队
