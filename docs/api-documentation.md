# AI 代码分析混合模式 - API 接口文档

> 文档版本：v1.0
> 日期：2026-06-24
> 状态：已确认 ✅

---

## 一、IPC 通道（主进程 ↔ 渲染进程）

### 1.1 SSE 服务器控制

| 通道名 | 方向 | 说明 | 参数 | 返回值 |
|--------|------|------|------|--------|
| `ai:sse-start` | 渲染 → 主 | 启动 SSE 服务器 | 无 | `{ port: number }` |
| `ai:sse-stop` | 渲染 → 主 | 停止 SSE 服务器 | 无 | `{ success: boolean }` |
| `ai:sse-get-port` | 渲染 → 主 | 获取 SSE 服务器端口 | 无 | `{ port: number }` |

### 1.2 分析控制

| 通道名 | 方向 | 说明 | 参数 | 返回值 |
|--------|------|------|------|--------|
| `ai:start-analysis` | 渲染 → 主 | 开始 AI 分析 | `AnalysisRequest` | `{ sessionId: string }` |
| `ai:cancel-analysis` | 渲染 → 主 | 取消 AI 分析 | `{ sessionId: string }` | `{ success: boolean }` |
| `ai:get-logs` | 渲染 → 主 | 获取分析日志（轮询备选） | `{ sessionId: string, lastLogId?: number }` | `{ logs: AnalysisLogEntry[] }` |

### 1.3 事件推送（主 → 渲染）

| 通道名 | 方向 | 说明 | 数据格式 |
|--------|------|------|----------|
| `ai:analysis-log` | 主 → 渲 | 推送分析日志 | `AnalysisLogEntry` |
| `ai:analysis-progress` | 主 → 渲 | 推送分析进度 | `AnalysisProgress` |
| `ai:analysis-done` | 主 → 渲 | 推送分析完成 | `AIDeepAnalysisResult` |
| `ai:analysis-error` | 主 → 渲 | 推送分析错误 | `{ message: string }` |

---

## 二、SSE 端点

### 2.1 连接端点

```
GET http://localhost:3001/ai-analysis-progress?sessionId={sessionId}
```

**请求参数**：
- `sessionId`：分析会话 ID（必填）

**响应格式**：
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 2.2 事件类型

| 事件类型 | 数据格式 | 说明 |
|----------|----------|------|
| `log` | `AnalysisLogEntry` | 实时日志 |
| `progress` | `AnalysisProgress` | 分析进度 |
| `done` | `AIDeepAnalysisResult` | 分析完成 |
| `error` | `{ message: string }` | 分析错误 |

### 2.3 事件示例

```
event: log
data: {"id":1,"timestamp":"2026-06-24T12:00:00Z","level":"info","message":"开始克隆仓库..."}

event: progress
data: {"phase":"cloning","percent":20,"currentStep":"克隆仓库"}

event: done
data: {"success":true,"scenarios":[...]}

event: error
data: {"message":"分析失败：仓库不存在"}
```

---

## 三、TypeScript 类型定义

### 3.1 分析阶段枚举

```typescript
export type AnalysisPhase =
  | 'idle'              // 空闲
  | 'cloning'          // 克隆仓库中
  | 'scanning'         // 阶段1：扫描中
  | 'scan-failed'      // 阶段1：扫描失败
  | 'analyzing'        // 阶段2：AI 分析中
  | 'generating'       // 生成报告中
  | 'done'             // 完成
  | 'error'            // 错误
```

### 3.2 实时日志条目

```typescript
export interface AnalysisLogEntry {
  /** 日志 ID（递增） */
  id: number
  /** 时间戳（ISO 8601） */
  timestamp: string
  /** 日志级别 */
  level: 'info' | 'warn' | 'error' | 'debug'
  /** 日志消息 */
  message: string
}
```

### 3.3 场景调用链路步骤

```typescript
export interface CallChainStep {
  /** 步骤序号 */
  step: number
  /** 组件类型（Router/Handler/Service/Model/DB） */
  component: string
  /** 文件路径 */
  filePath: string
  /** 函数名 */
  functionName: string
  /** 描述 */
  description: string
}
```

### 3.4 场景定义

```typescript
export interface AnalysisScenario {
  /** 场景名称（正常流程/参数校验失败/权限校验失败） */
  scenarioName: string
  /** 场景类型 */
  scenarioType: 'normal' | 'param-error' | 'auth-error'
  /** 调用链路 */
  callChain: CallChainStep[]
  /** curl 命令 */
  curlCommand: string
  /** Python 断言代码 */
  pythonAssertion: string
}
```

### 3.5 AI 深度分析结果

```typescript
export interface AIDeepAnalysisResult {
  /** 是否成功 */
  success: boolean
  /** 仓库名称 */
  repoName?: string
  /** Handler 文件路径 */
  handlerFile?: string
  /** Handler 函数名 */
  handlerFunction?: string
  /** 场景列表（3 个场景） */
  scenarios: AnalysisScenario[]
  /** 分析摘要（Markdown） */
  analysisSummary?: string
  /** 错误信息 */
  error?: string
}
```

### 3.6 分析进度

```typescript
export interface AnalysisProgress {
  /** 当前阶段 */
  phase: AnalysisPhase
  /** 进度百分比（0-100） */
  percent: number
  /** 当前步骤描述 */
  currentStep?: string
}
```

### 3.7 SSE 消息格式

```typescript
export interface SSEMessage {
  /** 事件类型 */
  event: 'log' | 'progress' | 'done' | 'error'
  /** 事件数据 */
  data: any
}
```

---

## 四、Preload API（渲染进程可用）

### 4.1 分析控制

```typescript
window.electronAPI.aiCodeAnalysis.startAnalysis(request: AnalysisRequest): Promise<{ sessionId: string }>
window.electronAPI.aiCodeAnalysis.cancelAnalysis(sessionId: string): Promise<{ success: boolean }>
window.electronAPI.aiCodeAnalysis.getSSEPort(): Promise<{ port: number }>
window.electronAPI.aiCodeAnalysis.startSSEServer(): Promise<{ port: number }>
window.electronAPI.aiCodeAnalysis.stopSSEServer(): Promise<{ success: boolean }>
window.electronAPI.aiCodeAnalysis.getLogs(sessionId: string, lastLogId?: number): Promise<{ logs: AnalysisLogEntry[] }>
```

### 4.2 事件监听

```typescript
window.electronAPI.aiCodeAnalysis.onAnalysisLog(callback: (entry: AnalysisLogEntry) => void): () => void
window.electronAPI.aiCodeAnalysis.onAnalysisProgress(callback: (progress: AnalysisProgress) => void): () => void
window.electronAPI.aiCodeAnalysis.onAnalysisDone(callback: (result: AIDeepAnalysisResult) => void): () => void
window.electronAPI.aiCodeAnalysis.onAnalysisError(callback: (error: { message: string }) => void): () => void
```

---

## 五、相关文档

- [PRD 文档](./prd-ai-hybrid-mode.md)
- [技术方案](./technical-design-ai-hybrid-mode.md)
- [任务依赖](./task-dependencies.md)
- [部署指南](./deployment-guide.md)
