# AI 代码分析混合模式 - 部署指南

> 文档版本：v1.0
> 日期：2026-06-24
> 状态：已确认 ✅

---

## 一、环境要求

### 1.1 开发环境

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 18.0.0 | 推荐 20.x LTS |
| npm | >= 9.0.0 | 或 yarn/pnpm |
| Electron | >= 28.0.0 | 项目已配置 |
| TypeScript | >= 5.0.0 | 项目已配置 |

### 1.2 运行环境

| 平台 | 最低版本 | 推荐版本 |
|------|----------|----------|
| macOS | 10.15+ | 12.0+ |
| Windows | 10+ | 11 |
| Linux | Ubuntu 20.04+ | Ubuntu 22.04+ |

---

## 二、安装依赖

### 2.1 克隆项目

```bash
git clone <repository-url>
cd packet-capture-app
```

### 2.2 安装依赖

```bash
# 使用 npm
npm install

# 或使用 yarn
yarn install

# 或使用 pnpm
pnpm install
```

### 2.3 新增依赖包

以下依赖包用于 AI 混合模式功能：

| 包名 | 版本 | 用途 |
|------|------|------|
| `eventsource` | ^2.0.2 | SSE 客户端（Electron 渲染进程 polyfill） |
| `openai` | ^4.0.0 | OpenAI SDK（Function Calling） |
| `highlight.js` | ^11.9.0 | 代码高亮（Python 断言） |
| `markdown-it` | ^14.0.0 | Markdown 渲染（分析摘要） |

```bash
npm install eventsource openai highlight.js markdown-it
```

---

## 三、配置

### 3.1 环境变量

在项目根目录创建 `.env` 文件：

```env
# OpenAI API 配置
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=gpt-4
OPENAI_MAX_TOKENS=4096

# SSE 服务器配置
SSE_PORT=3001
SSE_TIMEOUT=300000

# 分析配置
MAX_TOOL_CALLS=10
TOOL_CALL_TIMEOUT=5000
MAX_SCAN_FILES=500
```

### 3.2 Electron 配置

在 `electron/main.ts` 中配置 SSE 服务器：

```typescript
// SSE 服务器配置
const SSE_CONFIG = {
  port: process.env.SSE_PORT ? parseInt(process.env.SSE_PORT) : 3001,
  timeout: process.env.SSE_TIMEOUT ? parseInt(process.env.SSE_TIMEOUT) : 300000,
}
```

---

## 四、开发模式运行

### 4.1 启动开发服务器

```bash
# 启动 Electron + Vite 开发服务器
npm run dev

# 或
yarn dev
```

### 4.2 访问应用

开发模式下，应用会自动打开 Electron 窗口。

### 4.3 热重载

- 前端代码（`src/`）：Vite 热重载自动生效
- 主进程代码（`electron/`）：需要重启应用

---

## 五、构建与打包

### 5.1 构建应用

```bash
# 构建生产版本
npm run build

# 或
yarn build
```

### 5.2 打包应用

```bash
# 打包为可执行文件
npm run package

# 或
yarn package
```

### 5.3 平台特定打包

```bash
# macOS
npm run package:mac

# Windows
npm run package:win

# Linux
npm run package:linux
```

---

## 六、功能验证

### 6.1 验证 SSE 服务器

1. 启动应用
2. 打开 AI 代码分析页面
3. 检查控制台日志：`SSE server started on port 3001`

### 6.2 验证 AI 分析功能

1. 配置仓库 URL 和分支
2. 输入请求路径和 HTTP 方法
3. 点击"开始分析"
4. 观察实时日志输出
5. 验证分析结果页面

### 6.3 验证兜底分析

1. 输入一个不存在的路由路径
2. 阶段1 扫描应失败
3. 自动触发阶段2 AI 分析
4. 验证分析结果

---

## 七、故障排查

### 7.1 SSE 连接失败

**症状**：前端无法接收实时日志

**排查步骤**：
1. 检查端口 3001 是否被占用：`lsof -i :3001`
2. 检查防火墙设置
3. 查看主进程日志：`SSE server error: ...`

**解决方案**：
- 修改端口：在 `.env` 中设置 `SSE_PORT=3002`
- 杀死占用端口的进程：`kill -9 <PID>`

### 7.2 AI API 调用失败

**症状**：分析失败，错误信息包含 `OpenAI API error`

**排查步骤**：
1. 检查 API Key 是否正确
2. 检查账户余额
3. 检查网络连接

**解决方案**：
- 更新 API Key：在 `.env` 中设置 `OPENAI_API_KEY=...`
- 检查账户余额：登录 OpenAI 控制台
- 使用代理：在 `.env` 中设置 `HTTPS_PROXY=...`

### 7.3 Worker 线程崩溃

**症状**：分析过程中应用崩溃

**排查步骤**：
1. 查看主进程日志：`Worker error: ...`
2. 检查内存使用：`top -l 1 | grep -E "^Phys"`

**解决方案**：
- 增加内存限制：在 `electron/main.ts` 中调整 Worker 配置
- 重启应用

---

## 八、性能优化

### 8.1 SSE 连接优化

- 启用 Gzip 压缩
- 调整心跳间隔（默认 30 秒）
- 限制最大连接数（默认 10）

### 8.2 AI API 调用优化

- 缓存分析结果（localStorage）
- 限制工具调用次数（默认 10 次）
- 使用流式响应（减少等待时间）

### 8.3 Worker 线程优化

- 限制扫描文件数量（默认 500 个）
- 使用增量扫描（跳过已扫描文件）
- 定期清理 Worker 内存

---

## 九、相关文档

- [PRD 文档](./prd-ai-hybrid-mode.md)
- [技术方案](./technical-design-ai-hybrid-mode.md)
- [API 文档](./api-documentation.md)
- [任务依赖](./task-dependencies.md)
