# #6 断点 & 请求/响应修改 — 设计方案

## 1. 功能概述

在代理层拦截匹配规则的请求/响应，暂停流量转发，弹出编辑面板让用户手动修改 URL / Headers / Body / Status Code，然后放行（或丢弃）。

**对标产品**：Charles Breakpoints、Reqable 断点调试、Fiddler Composer

---

## 2. 现状分析

### 2.1 当前代理流程

```
Client → proxy.onRequest() → proxy.onResponse() → Client
         ↓                      ↓
         收集请求体              收集响应体
         pushRequestArrived()   pushResponseArrived()
```

**关键约束**：`http-mitm-proxy` 的 `onRequest(ctx, callback)` 和 `onResponse(ctx, callback)` 都是同步回调模式 — 调用 `callback()` 后才会继续转发。**如果不调用 callback()，请求就会暂停**。这正是实现断点的关键。

### 2.2 当前数据流

- `mitm-server.ts` 的 `onRequest` / `onResponse` 回调中，数据通过 IPC 推送到前端
- 前端 `request-store.ts` 通过 `subscribeToNewRequests()` 接收
- 目前没有任何"暂停-修改-放行"机制

### 2.3 不涉及现有流程

断点功能是**条件性触发**的 — 只有用户配置了断点规则且请求匹配时才暂停。不匹配的请求正常流转，零性能影响。

---

## 3. 功能设计

### 3.1 断点规则（BreakpointRule）

```typescript
interface BreakpointRule {
  id: string
  /** 是否启用 */
  enabled: boolean
  /** 规则名称（用户自定义） */
  name: string
  /** 匹配模式 */
  match: {
    /** URL 通配符，如 *api.shopline.com/login* */
    urlPattern: string
    /** HTTP 方法过滤（空 = 所有方法） */
    methods: HttpMethod[]
  }
  /** 拦截阶段 */
  stage: 'request' | 'response' | 'both'
  /** 创建时间 */
  createdAt: string
}
```

### 3.2 拦截会话（InterceptSession）

当请求命中断点规则时，创建一个拦截会话：

```typescript
interface InterceptSession {
  /** 会话 ID */
  id: string
  /** 触发的规则 ID */
  ruleId: string
  /** 拦截阶段 */
  stage: 'request' | 'response'
  /** 可编辑的请求数据（深拷贝，用户修改不影响原始数据） */
  editable: {
    method: HttpMethod
    url: string
    requestHeaders: HttpHeaders
    requestBody: string
    /** 仅 response 阶段可编辑 */
    statusCode?: number
    responseHeaders?: HttpHeaders
    responseBody?: string
  }
  /** 状态 */
  status: 'waiting' | 'resumed' | 'aborted'
  /** 命中时间 */
  interceptedAt: string
}
```

### 3.3 拦截流程

```
                    ┌─────────────────────────────────┐
                    │  用户配置断点规则                  │
                    │  (BreakpointRules.vue)           │
                    └──────────┬──────────────────────┘
                               │ IPC: breakpoint:add-rule
                               ▼
┌──────────────────────────────────────────────────────────┐
│  mitm-server.ts                                          │
│                                                          │
│  onRequest(ctx, callback)                                │
│    ├─ 检查是否命中断点规则                                 │
│    ├─ 未命中 → 正常 callback()                            │
│    └─ 命中 → 创建 InterceptSession                       │
│         ├─ IPC 发送到前端: breakpoint:intercepted         │
│         ├─ 创建 Promise + 等待                            │
│         └─ 不调用 callback()（请求暂停）                   │
│                                                          │
│  前端 BreakpointDialog.vue                               │
│    ├─ 显示编辑面板（URL/Headers/Body/StatusCode）          │
│    ├─ 用户修改后点击"放行"或"丢弃"                         │
│    └─ IPC 发送: breakpoint:resume(sessionId, modified)   │
│                                                          │
│  mitm-server.ts                                          │
│    ├─ 收到 resume → 应用修改到 ctx → callback()           │
│    └─ 收到 abort → 中断请求                               │
└──────────────────────────────────────────────────────────┘
```

### 3.4 请求阶段拦截

在 `onRequest` 中：
1. 收集完请求头和请求体后（`onRequestEnd`），检查是否命中断点规则
2. 如果命中且 `stage` 为 `request` 或 `both`：
   - 创建 `InterceptSession`，深拷贝请求数据
   - 通过 IPC `breakpoint:intercepted` 发送到前端
   - 创建 Promise，保存 resolve/reject 到 Map<sessionId, {resolve, reject}>
   - **不调用 callback()**，请求暂停
3. 前端收到拦截事件，弹出 `BreakpointDialog`
4. 用户编辑后点击"放行" → IPC `breakpoint:resume`
5. 主进程收到 resume，应用修改到 `ctx.clientToProxyRequest`，调用 `callback()`
6. 用户点击"丢弃" → IPC `breakpoint:abort` → 调用 `ctx.proxyToClientResponse.destroy()` 终止

### 3.5 响应阶段拦截

在 `onResponseEnd` 中：
1. 收集完响应数据后，检查是否命中断点规则
2. 如果命中且 `stage` 为 `response` 或 `both`：
   - 创建 `InterceptSession`，包含 statusCode + responseHeaders + responseBody
   - 通过 IPC 发送，暂停流程
3. 用户修改后放行 → 应用修改到 `ctx.serverToProxyResponse`

### 3.6 URL 匹配逻辑

```typescript
function matchBreakpoint(url: string, method: HttpMethod, rule: BreakpointRule): boolean {
  // 方法过滤
  if (rule.match.methods.length > 0 && !rule.match.methods.includes(method)) {
    return false
  }
  // URL 通配符匹配（与 domainFilters 同逻辑）
  const pattern = rule.match.urlPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${pattern}$`, 'i').test(url)
}
```

---

## 4. 架构设计

### 4.1 组件结构

```
App.vue
├── RequestList.vue（现有）
│   └── 顶部工具栏新增"断点"按钮（带徽标显示活跃规则数）
│   └── 请求项 @contextmenu.prevent → 显示 RequestContextMenu
├── RequestDetail.vue（现有，不受影响）
├── BreakpointDialog.vue（新增，全局模态弹窗）
│   ├── 顶部：拦截信息（规则名、URL、阶段）
│   ├── 编辑区（Tab 切换）：
│   │   ├── 请求 Tab：URL / Method / Headers / Body
│   │   └── 响应 Tab：StatusCode / Headers / Body（仅 response 阶段可编辑）
│   └── 底部操作栏：放行 / 丢弃 / 恢复原始
├── RequestContextMenu.vue（新增，右键上下文菜单）
│   ├── 🎯 为此请求添加断点（submenu → 请求/响应/两者）
│   ├── 📋 复制 URL
│   ├── 📋 复制为 cURL
│   └── 🗑️ 删除此请求
└── BreakpointRules.vue（新增，侧边面板或独立视图）
    ├── 规则列表（启用/禁用开关、编辑、删除）
    ├── 新增规则表单
    └── 快捷操作：全部启用 / 全部禁用 / 清空
```

### 4.2 数据流

```
mitm-server.ts
  └── onRequest / onResponse 命中断点
      └── IPC: breakpoint:intercepted → 前端
          └── breakpoint-store.ts
              ├── activeSessions: InterceptSession[]
              └── BreakpointDialog.vue（编辑）
                  └── IPC: breakpoint:resume / abort → 主进程
                      └── 应用修改 → callback() → 请求继续
```

### 4.3 IPC 通道

```typescript
// 新增 IPC 通道
BREAKPOINT_ADD_RULE: 'breakpoint:add-rule',
BREAKPOINT_REMOVE_RULE: 'breakpoint:remove-rule',
BREAKPOINT_UPDATE_RULE: 'breakpoint:update-rule',
BREAKPOINT_GET_RULES: 'breakpoint:get-rules',
BREAKPOINT_INTERCEPTED: 'breakpoint:intercepted',    // 主→前端：通知拦截
BREAKPOINT_RESUME: 'breakpoint:resume',               // 前端→主：放行（含修改）
BREAKPOINT_ABORT: 'breakpoint:abort',                 // 前端→主：丢弃
```

---

## 5. 文件变更清单

### 5.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/stores/breakpoint-store.ts` | 断点规则 + 拦截会话状态管理 |
| `src/components/BreakpointDialog.vue` | 拦截编辑弹窗（全局模态） |
| `src/components/BreakpointRules.vue` | 断点规则管理面板 |
| `src/components/RequestContextMenu.vue` | 请求列表右键上下文菜单 |
| `src/utils/breakpoint-matcher.ts` | URL 匹配引擎 |
| `src/utils/curl-generator.ts` | 将请求对象转换为 cURL 命令 |

### 5.2 修改文件

| 文件路径 | 改动说明 |
|---------|---------|
| `electron/proxy/mitm-server.ts` | 新增断点匹配 + Promise 暂停机制；`onRequest` / `onResponseEnd` 中插入断点检查 |
| `electron/main.ts` | 新增断点相关 IPC handler（add-rule / remove-rule / resume / abort） |
| `electron/preload.ts` | 暴露 breakpoint API 到渲染进程 |
| `src/services/types.ts` | 新增 `BreakpointRule`、`InterceptSession` 类型 + IPC 通道常量 |
| `src/services/ipc.ts` | 新增 `breakpoint` 命名空间的 IPC 封装 |
| `src/components/RequestList.vue` | 工具栏新增"断点"按钮（显示活跃规则数）；请求项新增 `@contextmenu.prevent` 右键菜单 |
| `src/App.vue` | 挂载 `BreakpointDialog` 全局弹窗 + `RequestContextMenu` |

### 5.3 不变文件

- `src/components/RequestDetail.vue` — 断点编辑在独立弹窗中完成，不影响详情面板
- `src/stores/request-store.ts` — 断点不改变请求存储逻辑
- `src/utils/filter-engine.ts` — 过滤系统独立运行

---

## 6. 关键技术要点

### 6.1 Promise 暂停机制

```typescript
// mitm-server.ts
const pendingInterceptions = new Map<string, {
  resolve: (modified: InterceptSession) => void
  reject: (reason: 'aborted') => void
}>()

// 在 onRequestEnd 中
if (matchedRule) {
  const sessionId = generateSessionId()
  const session = createInterceptSession(ctx, matchedRule, 'request')
  
  // 发送到前端
  mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
  
  // 暂停请求，等待前端响应
  await new Promise<void>((resolve, reject) => {
    pendingInterceptions.set(sessionId, {
      resolve: (modified) => {
        applyModifications(ctx, modified)
        resolve()
      },
      reject: (reason) => {
        if (reason === 'aborted') {
          ctx.proxyToClientResponse.destroy()
        }
        reject(reason)
      }
    })
  })
  
  // 继续 callback
  callback()
}
```

### 6.2 请求修改应用

修改 `ctx.clientToProxyRequest` 的 headers 和 body：

```typescript
function applyRequestModifications(ctx: any, modified: InterceptSession): void {
  // 修改 URL
  if (modified.editable.url !== ctx._url) {
    ctx.clientToProxyRequest.url = modified.editable.url
    ctx._url = modified.editable.url
  }
  // 修改 Headers（清空原有，写入修改后的）
  ctx.clientToProxyRequest.headers = { ...modified.editable.requestHeaders }
  // 修改 Body
  if (modified.editable.requestBody !== ctx._requestBody) {
    const newBody = Buffer.from(modified.editable.requestBody)
    ctx._requestBody = modified.editable.requestBody
    // http-mitm-proxy 需要在 onRequestData 中替换 chunk
  }
}
```

### 6.3 响应修改应用

修改 `ctx.serverToProxyResponse` 的 statusCode / headers / body：

```typescript
function applyResponseModifications(ctx: any, modified: InterceptSession): void {
  if (modified.editable.statusCode !== undefined) {
    ctx.serverToProxyResponse.statusCode = modified.editable.statusCode
  }
  if (modified.editable.responseHeaders) {
    ctx.serverToProxyResponse.headers = { ...modified.editable.responseHeaders }
  }
  // 响应体修改：需要在 onResponseData 中替换
}
```

### 6.4 规则持久化

断点规则通过 `settings-store` 持久化到 SQLite `settings` 表：

```typescript
// settings-store.ts
breakpointRules: BreakpointRule[]  // 存为 JSON 字符串
```

---

## 7. 任务列表

| 序号 | 任务 | 依赖 | 涉及文件 |
|------|------|------|---------|
| T1 | 类型定义 + IPC 通道常量 | 无 | `types.ts` |
| T2 | 断点匹配引擎 | T1 | `breakpoint-matcher.ts`（新增） |
| T3 | 断点 Store（规则管理 + 拦截会话） | T1 | `breakpoint-store.ts`（新增） |
| T4 | IPC 封装 | T1 | `ipc.ts` + `preload.ts` |
| T5 | mitm-server 断点拦截机制 | T1, T2 | `mitm-server.ts` |
| T6 | main.ts IPC handler | T4, T5 | `main.ts` |
| T7 | BreakpointDialog 编辑弹窗 | T3 | `BreakpointDialog.vue`（新增） |
| T8 | BreakpointRules 规则管理面板 | T3 | `BreakpointRules.vue`（新增） |
| T8.5 | 右键上下文菜单 + cURL 生成 | T3 | `RequestContextMenu.vue` + `curl-generator.ts`（新增）；`RequestList.vue`（修改） |
| T9 | RequestList 工具栏集成 + 右键菜单集成 + App.vue 挂载 | T7, T8, T8.5 | `RequestList.vue` + `App.vue` |
| T10 | 全局一致性审查 + 构建 | T9 | — |

---

## 8. 边界情况与降级

| 场景 | 处理 |
|------|------|
| 断点等待中关闭应用 | `before-quit` 中自动 abort 所有 pending interceptions |
| 断点等待中超时（5分钟） | 自动 abort，通知前端"断点超时" |
| 同时命中多个断点规则 | 取第一个匹配的规则，不重复拦截 |
| 响应体为二进制（Base64） | 编辑弹窗显示 Base64 解码后的文本，放行时重新编码 |
| HTTPS 请求 | 正常拦截（MITM 解密后已是明文） |
| 请求体修改后 Content-Length 不匹配 | 自动更新 Content-Length header |
| 原始 Body 是 gzip/deflate/br 压缩的 | 编辑前自动解压显示明文；修改后发送未压缩 Body，移除 Content-Encoding 头，更新 Content-Length |
| 右键菜单弹出时请求被删除 | 菜单自动关闭，不做任何操作 |
| 右键菜单超出视窗边界 | 自动调整位置（右溢出→左移，下溢出→上移） |
| 右键添加断点时 URL 解析失败 | 降级为 `*<原始URL>*` 模式 |
| URL 修改涉及 host 变更 | **不支持**，仅允许修改 path + query string，弹窗中 host 字段只读 |
| WebSocket / CONNECT 请求 | 跳过断点检查，正常转发 |
| 二进制 Body（Base64 格式） | 弹窗显示只读预览，不允许编辑 Body（仅 Headers/URL/StatusCode 可编辑） |
| Body 超过 100KB | 弹窗显示"Body 过大，不支持编辑"提示，仅允许修改 Headers/URL/StatusCode |
| 断点队列超过 20 个 | 新请求自动放行（不做拦截）+ Toast 警告"断点队列已满" |
| URL Pattern 为 `*` | 规则验证拒绝，提示"不能拦截所有流量" |
| 断点等待中代理被停止 | stopProxy() 中先 abort 所有 pending interceptions |

---

## 9. 性能影响

| 指标 | 无断点规则 | 有断点规则（不命中） | 命中断点 |
|------|-----------|-------------------|---------|
| 每请求额外开销 | 0 | ~0.1ms（URL 匹配） | Promise 等待（用户操作时间） |
| 内存 | 0 | 规则列表（<1KB/规则） | 拦截会话（~10KB/会话） |

---

## 10. 决策记录

| # | 问题 | 决策 | 依据 |
|---|------|------|------|
| 1 | 断点弹窗位置 | **全局模态弹窗**（覆盖全屏） | 拦截时需用户立即关注，模态弹窗强制聚焦 |
| 2 | 多会话排队 | **排队处理**，按拦截顺序依次弹出 | 避免多个弹窗混乱，保证可追溯 |
| 3 | Body 编辑后的压缩处理 | **不重新压缩**：编辑前自动解压（gzip/deflate/br）显示明文，修改后发送未压缩 Body，自动移除 `Content-Encoding` 头，更新 `Content-Length` | 与 Charles、Fiddler Everywhere、Reqable 三款工具行为一致（业界标准） |
| 4 | 规则导入导出 | **第一版不支持** | 后续迭代再加 |

### 10.1 Body 压缩处理详细方案

```
原始响应（gzip 压缩）
  ↓
断点拦截 → 自动解压（zlib.gunzipSync / zlib.inflateSync / zlib.brotliDecompressSync）
  ↓
编辑弹窗显示明文 Body
  ↓
用户修改 → 点击放行
  ↓
应用修改：
  1. Body = Buffer.from(modifiedBody)（明文，不重新压缩）
  2. 移除 Content-Encoding 头
  3. 移除 Transfer-Encoding 头（如有）
  4. 更新 Content-Length = newBody.length
  ↓
callback() → 请求继续
```

**支持的解压算法**：
- `gzip` → `zlib.gunzipSync()`
- `deflate` → `zlib.inflateSync()`
- `br` → `zlib.brotliDecompressSync()`

**注意**：如果 Body 未压缩（无 Content-Encoding 头），直接显示原文，无需解压。

---

## 11. 右键上下文菜单

### 11.1 功能概述

用户在请求列表中右键点击（macOS 两指点击触摸板）某个请求，弹出上下文菜单，提供快捷操作入口，包括快速添加断点规则。

### 11.2 菜单项设计

```
┌──────────────────────────────────────┐
│  🎯 为此请求添加断点            ▶  │
│  ──────────────────────────────────  │
│  📋 复制 URL                          │
│  📋 复制为 cURL                       │
│  ──────────────────────────────────  │
│  🗑️ 删除此请求                        │
└──────────────────────────────────────┘
```

**"为此请求添加断点"子菜单**：
```
┌────────────────────────┐
│  拦截请求               │ → stage: 'request'
│  拦截响应               │ → stage: 'response'
│  拦截请求和响应          │ → stage: 'both'
└────────────────────────┘
```

### 11.3 交互流程

```
用户右键点击请求项
  ↓
RequestList.vue @contextmenu.prevent
  ↓ 记录 request + x/y 坐标
  ↓
RequestContextMenu.vue 渲染浮动菜单
  ↓
用户点击菜单项：
  ├── "拦截请求/响应/两者"
  │     ↓
  │   breakpointStore.addBreakpointFromRequest(request, stage)
  │     ├── URL pattern = `*<host><pathname>*`（去掉 query string）
  │     ├── methods = [request.method]
  │     ├── name = `断点 - ${method} ${pathname}`
  │     ├── enabled = true
  │     └── 持久化到 settings store
  │     ↓
  │   显示 Toast: "断点规则已添加"
  │
  ├── "复制 URL"
  │     ↓ clipboard.writeText(request.url)
  │
  ├── "复制为 cURL"
  │     ↓ curl-generator.ts 生成 cURL 命令
  │     ↓ clipboard.writeText(curlCommand)
  │
  └── "删除此请求"
        ↓ requestStore.removeRequest(request.id)
```

### 11.4 URL Pattern 生成规则

右键添加断点时，自动从请求 URL 生成匹配模式：

```typescript
function generatePatternFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // 使用 host + pathname，不含 query string，两端加通配符
    return `*${parsed.host}${parsed.pathname}*`
  } catch {
    // URL 解析失败，直接用原始 URL
    return `*${url}*`
  }
}
```

**示例**：
- 请求 URL: `https://api.shopline.com/v1/products?limit=20&page=1`
- 生成的 Pattern: `*api.shopline.com/v1/products*`
- 匹配: 同一端点的所有请求（不同 query params）

### 11.5 cURL 生成器

```typescript
function generateCurl(request: RequestData): string {
  let curl = `curl -X ${request.method} '${request.url}'`
  // Headers
  for (const [key, value] of Object.entries(request.requestHeaders || {})) {
    curl += ` \\\n  -H '${key}: ${value}'`
  }
  // Body
  if (request.requestBody) {
    curl += ` \\\n  -d '${request.requestBody}'`
  }
  return curl
}
```

### 11.6 技术实现要点

- **菜单定位**：根据 `event.clientX/clientY` 定位，边界检测防止超出视窗
- **关闭机制**：点击菜单外部、ESC 键、滚动时自动关闭
- **submenu**：鼠标 hover "为此请求添加断点" 时显示子菜单（右侧展开）
- **键盘支持**：上下箭头导航，Enter 确认
- **z-index**：菜单 z-index 高于 BreakpointDialog（如果同时存在）

### 11.7 数据流

```
RequestList.vue
  └── @contextmenu.prevent on request item
      └── contextMenuState = { visible: true, x, y, request }
          └── RequestContextMenu.vue (teleport to body)
              ├── "添加断点" → breakpointStore.addBreakpointFromRequest()
              ├── "复制 URL" → navigator.clipboard.writeText()
              ├── "复制为 cURL" → curl-generator.ts → clipboard
              └── "删除" → requestStore.removeRequest()
```

---

## 12. Plan 审查问题与修复（2026-06-21）

### 12.1 P0 致命问题（3项）

#### P0-1：请求体修改不可能 — onRequestData 已转发原始 body

**问题**：当前 `onRequestData` 中 `callback(null, chunk)` 立即将每个 chunk 转发给 Server。到 `onRequestEnd` 时，原始 body 已完整发送，无法修改。

**plan 6.2 的注释** `"http-mitm-proxy 需要在 onRequestData 中替换 chunk"` 未给出实现方案。

**修复方案**：改造 `onRequestData` 为条件缓冲模式：

```typescript
// mitm-server.ts — 改造后的 onRequest
proxy.onRequest((ctx: any, callback: any) => {
  // ... 现有 URL/Method 解析逻辑 ...
  
  // 【新增】在 onRequest 中检查断点匹配（URL + Method 已知）
  const breakpointMatch = checkBreakpointMatch(url, method)
  ctx._breakpointMatched = breakpointMatch !== null
  ctx._breakpointRule = breakpointMatch
  ctx._breakpointStage = breakpointMatch?.stage || null
  
  const requestChunks: Buffer[] = []
  
  ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
    if (ctx._domainMatched) {
      requestChunks.push(chunk)
    }
    if (ctx._breakpointMatched && (ctx._breakpointStage === 'request' || ctx._breakpointStage === 'both')) {
      // 【关键】断点命中时，缓冲但不转发
      return callback()  // 不传 chunk，暂停数据流
    }
    return callback(null, chunk)  // 正常转发
  })
  
  ctx.onRequestEnd(async (ctx: any, callback: any) => {
    if (ctx._domainMatched) {
      const rawRequestBuffer = Buffer.concat(requestChunks)
      ctx._requestHeaders = ctx.clientToProxyRequest?.headers || {}
      ctx._requestBody = decodeRequestBody(rawRequestBuffer, ctx._requestHeaders)
    }
    
    // 【新增】断点拦截
    if (ctx._breakpointMatched && (ctx._breakpointStage === 'request' || ctx._breakpointStage === 'both')) {
      try {
        const session = createInterceptSession(ctx, ctx._breakpointRule, 'request')
        mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
        
        const modified = await waitForBreakpointResume(session.id)  // Promise 等待
        
        // 应用修改
        applyRequestModifications(ctx, modified)
        
        // 转发修改后的 body
        if (modified.editable.requestBody !== ctx._originalRequestBody) {
          const newBody = Buffer.from(modified.editable.requestBody)
          // 通过 proxyToServerRequest 写入修改后的 body
          ctx.proxyToServerRequest.write(newBody)
        } else {
          // 转发原始缓冲的 body
          ctx.proxyToServerRequest.write(Buffer.concat(requestChunks))
        }
      } catch (reason) {
        if (reason === 'aborted') {
          ctx.proxyToClientResponse.destroy()
          return  // 不调用 callback，请求终止
        }
        throw reason
      }
    }
    
    ctx._requestId = pushRequestArrived(...)
    return callback()
  })
  
  return callback()
})
```

#### P0-2：响应体修改不可能 — onResponseData 已转发原始 response

**问题**：当前 `onResponseData` 中 `callback(null, chunk)` 立即将每个 chunk 转发给 Client。到 `onResponseEnd` 时，Client 已收到完整响应。

**修复方案**：改造 `onResponseData` 为条件缓冲模式（与请求阶段对称）：

```typescript
proxy.onResponse((ctx: any, callback: any) => {
  const responseChunks: Buffer[] = []
  
  // 【新增】检查响应阶段断点
  const shouldInterceptResponse = ctx._breakpointMatched && 
    (ctx._breakpointStage === 'response' || ctx._breakpointStage === 'both')
  
  ctx.onResponseData((ctx: any, chunk: Buffer, callback: any) => {
    responseChunks.push(chunk)
    if (shouldInterceptResponse) {
      return callback()  // 缓冲但不转发
    }
    return callback(null, chunk)
  })
  
  ctx.onResponseEnd(async (ctx: any, callback: any) => {
    if (shouldInterceptResponse) {
      try {
        const session = createInterceptSession(ctx, ctx._breakpointRule, 'response')
        mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
        
        const modified = await waitForBreakpointResume(session.id)
        applyResponseModifications(ctx, modified)
        
        // 转发修改后的响应体
        const newBody = Buffer.from(modified.editable.responseBody || '')
        ctx.proxyToClientResponse.write(newBody)
      } catch (reason) {
        if (reason === 'aborted') {
          ctx.proxyToClientResponse.destroy()
          return
        }
        throw reason
      }
    }
    
    // 正常流程
    pushResponseArrived(...)
    return callback()
  })
  
  return callback()
})
```

#### P0-3：URL/Method/Headers 修改时机错误

**问题**：`onRequest` 的 `callback()` 调用后，http-mitm-proxy 已建立到目标 Server 的连接。plan 6.2 中修改 `ctx.clientToProxyRequest.url` 此时已无法改变目标服务器。

**修复方案**：在 `callback()` 调用前应用 URL/Method/Header 修改。但由于 `callback()` 必须在 `onRequest` 中调用（否则 `onRequestData` 不会触发），需要特殊处理：

```typescript
// 方案：在 onRequest 中，如果断点命中，先修改 ctx 再调用 callback
proxy.onRequest((ctx: any, callback: any) => {
  // ... URL/Method 解析 ...
  const breakpointMatch = checkBreakpointMatch(url, method)
  
  if (breakpointMatch && (breakpointMatch.stage === 'request' || breakpointMatch.stage === 'both')) {
    // 请求阶段断点：需要先收集完整 body 再暂停
    // URL/Method/Header 的修改在 onRequestEnd 中用户 resume 后应用
    // 此时需要修改 ctx.clientToProxyRequest 的相关字段
    // http-mitm-proxy 在 callback() 后才连接 server，所以在 onRequestEnd 中
    // 修改 ctx.clientToProxyRequest.url 仍然有效（如果 server 连接尚未建立）
    
    // 【注意】实测 http-mitm-proxy 的行为：
    // callback() 触发 server 连接，但连接是异步的
    // onRequestEnd 在 callback() 之后执行，此时连接可能已建立
    // 因此 URL 修改需要特殊处理：
    // 方案 A：修改 ctx.clientToProxyRequest.url + 重新解析 host
    // 方案 B：对于 URL 修改，直接 abort 原请求，用修改后的 URL 发起新请求
    // 推荐方案 A，限制 URL 修改只能改 path/query，不能改 host
  }
  
  // ... 设置 onRequestData / onRequestEnd ...
  return callback()
})
```

**限制说明**：URL 修改仅支持 path + query string 部分，不支持修改 host（目标服务器）。这与其他抓包工具的限制一致。Plan 中需明确标注此限制。

### 12.2 P1 高优先级问题（6项）

#### P1-1：InterceptSession 缺少 original 字段

**问题**：`BreakpointDialog` 有"恢复原始"按钮，但 `InterceptSession` 只有 `editable` 字段，没有 `original` 字段可恢复。

**修复**：在 `InterceptSession` 中新增 `original` 字段：

```typescript
interface InterceptSession {
  id: string
  ruleId: string
  stage: 'request' | 'response'
  /** 用户可编辑的副本 */
  editable: { /* ... 现有字段 ... */ }
  /** 【新增】原始数据快照（用于"恢复原始"按钮） */
  original: {
    method: HttpMethod
    url: string
    requestHeaders: HttpHeaders
    requestBody: string
    statusCode?: number
    responseHeaders?: HttpHeaders
    responseBody?: string
  }
  status: 'waiting' | 'resumed' | 'aborted'
  interceptedAt: string
}
```

"恢复原始"按钮逻辑：`session.editable = deepClone(session.original)`

#### P1-2：Promise reject 未 catch

**问题**：plan 6.1 中 `await new Promise(...)` 的 reject（abort 时触发）未被 catch，会导致 unhandled promise rejection。

**修复**：用 try-catch 包裹：

```typescript
try {
  const modified = await waitForBreakpointResume(session.id)
  applyModifications(ctx, modified)
} catch (reason) {
  if (reason === 'aborted') {
    ctx.proxyToClientResponse.destroy()
    return  // 不调用 callback，请求终止
  }
  // 其他异常：记录日志，放行原始请求
  console.error('[Breakpoint] 意外错误:', reason)
}
callback()
```

#### P1-3：stage:'both' 处理未定义

**问题**：plan 未定义 `stage: 'both'` 时是创建一个会话还是两个，以及请求阶段的修改是否传递到响应阶段。

**修复**：`stage: 'both'` 创建两个独立会话（请求阶段一个、响应阶段一个），但共享同一个 `ruleId`。请求阶段的修改通过 `ctx._modifiedRequest` 传递到响应阶段检查时使用。

```
请求到达 → 命中 both 规则
  ├─ 创建会话 A（request 阶段）
  ├─ 用户编辑 → resume → 应用修改 → 放行
  ├─ ctx._modifiedRequest = modified（记录修改）
  └─ 请求转发到 Server

响应到达 → 命中同一规则（response 阶段）
  ├─ 创建会话 B（response 阶段）
  ├─ 会话 B 的 editable 包含请求阶段的数据（含修改）
  └─ 用户编辑响应 → resume → 应用修改 → 放行
```

#### P1-4：二进制 Body 编辑方案缺失

**问题**：当前 `decodeResponseBody` / `decodeRequestBody` 对二进制数据返回 `[Base64:contentType:size:base64Data]` 格式。断点弹窗如何编辑这种格式？

**修复**：断点弹窗中的 Body 编辑区分模式：
- **文本模式**（默认）：直接编辑解压后的文本（JSON/HTML/XML/Form 等）
- **Hex 模式**：对二进制数据显示 Hex 编辑器（复用 `HexViewer` 组件的编辑模式）
- **只读降级**：如果 Body 超过 100KB，显示只读提示"Body 过大，不支持编辑"，仅允许修改 Headers/URL/StatusCode

弹窗中 Body 编辑区根据 Content-Type 自动选择模式：
- `application/json` / `text/*` / `application/x-www-form-urlencoded` → 文本编辑器
- `image/*` / `application/octet-stream` / Base64 格式 → 只读预览 + 提示
- 其他 → 文本编辑器（尽力而为）

#### P1-5：拦截中的请求在列表中的状态未定义

**问题**：请求被断点拦截后，在请求列表中应显示什么状态？用户需要知道哪个请求被暂停了。

**修复**：
1. `CaptureRequest` 新增 `breakpointStatus?: 'intercepting' | 'resumed' | 'aborted'` 字段
2. 拦截时通过 IPC 推送状态更新到前端，请求列表中该行显示：
   - 闪烁的橙色背景 + 暂停图标
   - Status 列显示"⏸ 拦截中"而非状态码
3. 排队中的请求显示"⏳ 排队中"状态
4. `BreakpointDialog` 头部显示"第 X/Y 个拦截会话"（队列位置）

#### P1-6：排队管理细节缺失

**问题**：plan 说"排队处理"但未定义队列 UI、跳过、重排等操作。

**修复**：
- **队列模型**：`activeSessions: InterceptSession[]`，FIFO 队列
- **当前显示**：`activeSessions[0]`（队首），其余排队
- **队列 UI**：弹窗顶部显示"还有 N 个请求等待处理"+ 展开列表可查看
- **操作**：
  - "放行"：处理当前会话，自动显示下一个
  - "丢弃"：abort 当前会话，自动显示下一个
  - "跳过"（可选）：放行当前会话但不显示编辑（直接 resume 原始数据），显示下一个
- **最大队列数**：20，超过后新请求自动放行（不做拦截）+ Toast 警告

### 12.3 P2 中等优先级问题（6项）

#### P2-1：URL 匹配有误报风险

**问题**：`*shopline*` 转为正则 `^.*shopline.*$`，会匹配 `evilshopline.com`。

**修复**：URL Pattern 匹配改为基于 URL 解析的精确匹配：

```typescript
function matchBreakpoint(url: string, method: HttpMethod, rule: BreakpointRule): boolean {
  if (rule.match.methods.length > 0 && !rule.match.methods.includes(method)) return false
  
  try {
    const parsed = new URL(url)
    const target = `${parsed.host}${parsed.pathname}`  // host + path，不含 query
    const pattern = rule.match.urlPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    return new RegExp(pattern, 'i').test(target)  // 去掉 ^ $，改为 includes 语义
  } catch {
    return false
  }
}
```

#### P2-2：cURL 生成不处理二进制 body

**修复**：`curl-generator.ts` 中检测 Base64 格式 body，降级处理：

```typescript
function generateCurl(request: RequestData): string {
  let curl = `curl -X ${request.method} '${request.url}'`
  for (const [key, value] of Object.entries(request.requestHeaders || {})) {
    curl += ` \\\n  -H '${key}: ${value}'`
  }
  if (request.requestBody) {
    if (request.requestBody.startsWith('[Base64:')) {
      // 二进制 body：用 --data-binary + 临时文件提示
      curl += ` \\\n  --data-binary @request_body.bin  # 二进制数据，请从文件加载`
    } else {
      curl += ` \\\n  -d '${request.requestBody}'`
    }
  }
  return curl
}
```

#### P2-3：WebSocket/CONNECT 未排除

**修复**：在 `onRequest` 中排除 CONNECT 方法和 WebSocket 升级请求：

```typescript
// 跳过 CONNECT 方法和 WebSocket 升级
if (method === 'CONNECT') return callback()
const upgradeHeader = ctx.clientToProxyRequest?.headers?.upgrade
if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') return callback()
```

#### P2-4：规则验证缺失

**修复**：`breakpoint-store.ts` 中新增规则时验证：

```typescript
function validateRule(rule: Partial<BreakpointRule>): string[] {
  const errors: string[]
  if (!rule.match?.urlPattern?.trim()) errors.push('URL 匹配模式不能为空')
  if (rule.match?.urlPattern?.trim() === '*') errors.push('URL 匹配模式不能为 *（会拦截所有流量）')
  if (rules.value.length >= 50) errors.push('断点规则最多 50 条')
  return errors
}
```

#### P2-5：IPC resume 载荷结构未定义

**修复**：明确 IPC 载荷结构：

```typescript
// breakpoint:resume 载荷
interface BreakpointResumePayload {
  sessionId: string
  action: 'resume' | 'abort'
  /** action='resume' 时，完整的编辑后数据（全量，非增量） */
  modified?: {
    method: HttpMethod
    url: string
    requestHeaders: HttpHeaders
    requestBody: string
    statusCode?: number
    responseHeaders?: HttpHeaders
    responseBody?: string
  }
}
```

#### P2-6：右键菜单 z-index 与模态冲突

**问题**：plan 11.6 说"菜单 z-index 高于 BreakpointDialog"，但模态打开时无法右键请求列表。

**修复**：移除该规则。右键菜单的 z-index 应低于 BreakpointDialog 模态。当模态打开时，请求列表被遮罩覆盖，右键菜单不会触发。两者不会同时出现。

---

### 12.4 修复后的任务列表（更新）

| 序号 | 任务 | 依赖 | 涉及文件 | 变更说明 |
|------|------|------|---------|---------|
| T1 | 类型定义 + IPC 通道常量 | 无 | `types.ts` | **新增** `original` 字段、`breakpointStatus` 字段、`BreakpointResumePayload` 类型 |
| T2 | 断点匹配引擎 | T1 | `breakpoint-matcher.ts` | **修复** P2-1 URL 匹配逻辑 |
| T3 | 断点 Store（规则管理 + 拦截会话） | T1 | `breakpoint-store.ts` | **新增** 规则验证、队列管理（FIFO，最大20） |
| T4 | IPC 封装 | T1 | `ipc.ts` + `preload.ts` | **明确** resume 载荷结构 |
| T5 | mitm-server 断点拦截机制 | T1, T2 | `mitm-server.ts` | **重构** onRequestData/onResponseData 为条件缓冲模式（P0-1/2/3 修复核心） |
| T6 | main.ts IPC handler | T4, T5 | `main.ts` | — |
| T7 | BreakpointDialog 编辑弹窗 | T3 | `BreakpointDialog.vue` | **新增** original 恢复、二进制 Body 只读降级、队列位置显示 |
| T8 | BreakpointRules 规则管理面板 | T3 | `BreakpointRules.vue` | — |
| T8.5 | 右键上下文菜单 + cURL 生成 | T3 | `RequestContextMenu.vue` + `curl-generator.ts` | **修复** cURL 二进制处理 |
| T9 | RequestList 工具栏 + 右键菜单 + App.vue 挂载 | T7, T8, T8.5 | `RequestList.vue` + `App.vue` | **新增** 拦截状态行样式 |
| T10 | 全局一致性审查 + 构建 | T9 | — | — |

---

## 13. 二次审查问题与修复（2026-06-21）

### 13.0 核心发现：Section 12 的 P0 修复本身有根本缺陷

**问题**：Section 12 的 P0-1/P0-2 修复方案中，`onRequest` 和 `onResponse` 仍然立即调用 `callback()`。但 http-mitm-proxy 的 `callback()` 不仅"继续数据流"，还**负责向目标端发送 headers**：
- `onRequest` 的 `callback()` → 向 Server 发送请求头（Method/URL/Headers）
- `onResponse` 的 `callback()` → 向 Client 发送响应头（StatusCode/Headers）

因此，在 `onRequestEnd`/`onResponseEnd` 中修改 headers/URL/statusCode **为时已晚** — 头已发送，修改被静默丢弃。只有 body 修改有效（因为 body 通过 `onRequestData`/`onResponseData` 逐块转发）。

**Section 3.3 原始方案的"不调用 callback()"实际上是对的**，但 Section 12 的 P0 修复改成了错误的即时调用。

### 13.1 P0 致命问题（4项，推翻 Section 12 的 P0 修复）

#### P0-R1：请求阶段断点 — 必须延迟 callback()

**正确方案**：不调用 `callback()`，直接监听 `ctx.clientToProxyRequest` 流收集 body，用户编辑后才调 `callback()`：

```typescript
proxy.onRequest((ctx: any, callback: any) => {
  // ... 现有 URL/Method 解析 ...
  
  const breakpointMatch = matchBreakpoint(url, method, breakpointRules)
  
  if (breakpointMatch && (breakpointMatch.stage === 'request' || breakpointMatch.stage === 'both')) {
    // 【关键】不调用 callback()！直接监听原始请求流收集 body
    const chunks: Buffer[] = []
    
    ctx.clientToProxyRequest.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    
    ctx.clientToProxyRequest.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks)
        const reqHeaders = ctx.clientToProxyRequest?.headers || {}
        const decodedBody = decodeRequestBody(rawBody, reqHeaders)
        
        // 创建拦截会话
        const session = createInterceptSession({
          ruleId: breakpointMatch.id,
          stage: 'request',
          method, url, requestHeaders: reqHeaders, requestBody: decodedBody,
        })
        
        // 立即推送到前端（显示"拦截中"状态）
        ctx._requestId = pushRequestArrived(method, url, ctx._path, ctx._host, ctx._clientIp)
        pushBreakpointStatus(ctx._requestId, 'intercepting')
        
        // 发送拦截事件到前端
        mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
        
        // 等待用户编辑
        const modified = await waitForBreakpointResume(session.id)
        
        // 【关键】在 callback() 之前应用所有修改
        // 修改 URL（仅 path+query，不能改 host）
        const parsedUrl = new URL(modified.editable.url)
        ctx.clientToProxyRequest.url = parsedUrl.pathname + parsedUrl.search
        // 修改 Method
        ctx.clientToProxyRequest.method = modified.editable.method
        // 修改 Headers
        ctx.clientToProxyRequest.headers = { ...modified.editable.requestHeaders }
        // 更新 Content-Length（body 修改后）
        const newBody = Buffer.from(modified.editable.requestBody)
        ctx.clientToProxyRequest.headers['content-length'] = String(newBody.length)
        // 移除 Content-Encoding（不重新压缩）
        delete ctx.clientToProxyRequest.headers['content-encoding']
        delete ctx.clientToProxyRequest.headers['transfer-encoding']
        
        // 存储修改后的 body，供 onRequestData 转发
        ctx._modifiedRequestBody = newBody
        ctx._breakpointResolved = true
        
        // 设置 onRequestData — 转发修改后的 body 而非原始数据
        ctx.onRequestData((ctx: any, _chunk: Buffer, callback: any) => {
          // 忽略原始 chunk（已被直接监听消费），不转发
          return callback()
        })
        ctx.onRequestEnd((ctx: any, callback: any) => {
          // 写入修改后的 body 到 server
          if (ctx._modifiedRequestBody) {
            ctx.proxyToServerRequest.write(ctx._modifiedRequestBody)
          }
          pushBreakpointStatus(ctx._requestId, 'resumed')
          return callback()
        })
        
        // 【关键】现在才调用 callback() — headers 带着修改发送到 Server
        callback()
        
      } catch (reason) {
        if (reason === 'aborted') {
          ctx.proxyToClientResponse.destroy()
          ctx.proxyToServerRequest?.destroy()
          pushBreakpointStatus(ctx._requestId, 'aborted')
          // 不调 callback()，请求终止
        } else {
          console.error('[Breakpoint] 意外错误:', reason)
          // 降级：放行原始请求
          callback()
        }
      }
    })
    
    // 【关键】return 但不调 callback() — 请求暂停
    return
  }
  
  // ===== 非断点请求：原有流程不变 =====
  const requestChunks: Buffer[] = []
  ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
    if (ctx._domainMatched) requestChunks.push(chunk)
    return callback(null, chunk)
  })
  ctx.onRequestEnd((ctx: any, callback: any) => {
    // ... 原有逻辑不变 ...
    return callback()
  })
  return callback()
})
```

**注意事项**：
- `ctx.clientToProxyRequest` 是 Node.js 的 `IncomingMessage` 流，可以直接监听 `data`/`end` 事件
- 直接监听后，`onRequestData` 不会收到数据（流已被消费），所以 `onRequestData` 中 `return callback()` 不转发
- `callback()` 调用后，proxy 建立 Server 连接并发送**修改后的** headers
- `onRequestEnd` 中 `ctx.proxyToServerRequest.write()` 写入修改后的 body
- **⚠️ 需要验证**：http-mitm-proxy 在 `callback()` 后是否会重新读取 `ctx.clientToProxyRequest` 的 headers — 如果是缓存了 headers 副本，修改可能无效。建议实现前写一个最小 PoC 验证。

#### P0-R2：响应阶段断点 — 同样延迟 callback()

```typescript
proxy.onResponse((ctx: any, callback: any) => {
  const shouldInterceptResponse = ctx._breakpointMatched && 
    (ctx._breakpointStage === 'response' || ctx._breakpointStage === 'both') &&
    !ctx._breakpointAborted  // 请求阶段被 abort 则跳过
  
  if (shouldInterceptResponse) {
    const chunks: Buffer[] = []
    
    // 直接监听 serverToProxyResponse 流
    ctx.serverToProxyResponse.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    
    ctx.serverToProxyResponse.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks)
        const statusCode = ctx.serverToProxyResponse?.statusCode || 200
        const respHeaders = ctx.serverToProxyResponse?.headers || {}
        const decodedBody = decodeResponseBody(rawBody, respHeaders)
        
        const session = createInterceptSession({
          ruleId: ctx._breakpointRule.id,
          stage: 'response',
          statusCode, responseHeaders: respHeaders, responseBody: decodedBody,
          // 包含请求阶段数据（可能已修改）
          method: ctx.clientToProxyRequest?.method,
          url: ctx._url,
          requestHeaders: ctx.clientToProxyRequest?.headers,
          requestBody: ctx._requestBody,
        })
        
        pushBreakpointStatus(ctx._requestId, 'intercepting')
        mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, session)
        
        const modified = await waitForBreakpointResume(session.id)
        
        // 【关键】在 callback() 之前应用响应修改
        ctx.serverToProxyResponse.statusCode = modified.editable.statusCode || statusCode
        ctx.serverToProxyResponse.headers = { ...modified.editable.responseHeaders }
        // 更新 Content-Length
        const newBody = Buffer.from(modified.editable.responseBody || '')
        ctx.serverToProxyResponse.headers['content-length'] = String(newBody.length)
        delete ctx.serverToProxyResponse.headers['content-encoding']
        delete ctx.serverToProxyResponse.headers['transfer-encoding']
        
        ctx._modifiedResponseBody = newBody
        
        // 设置 onResponseData — 不转发原始数据
        ctx.onResponseData((ctx: any, _chunk: Buffer, callback: any) => {
          return callback()
        })
        ctx.onResponseEnd((ctx: any, callback: any) => {
          if (ctx._modifiedResponseBody) {
            ctx.proxyToClientResponse.write(ctx._modifiedResponseBody)
          }
          pushBreakpointStatus(ctx._requestId, 'resumed')
          return callback()
        })
        
        // 现在才调用 callback() — 响应头带着修改发送到 Client
        callback()
        
      } catch (reason) {
        if (reason === 'aborted') {
          ctx.proxyToClientResponse.destroy()
          pushBreakpointStatus(ctx._requestId, 'aborted')
        } else {
          console.error('[Breakpoint] 响应拦截错误:', reason)
          callback()
        }
      }
    })
    
    return  // 不调 callback()
  }
  
  // ===== 非断点响应：原有流程不变 =====
  const responseChunks: Buffer[] = []
  ctx.onResponseData((ctx: any, chunk: Buffer, callback: any) => {
    responseChunks.push(chunk)
    return callback(null, chunk)
  })
  ctx.onResponseEnd((ctx: any, callback: any) => {
    // ... 原有逻辑不变 ...
    return callback()
  })
  return callback()
})
```

#### P0-R3：async/await 在 callback 模式中的风险

**问题**：http-mitm-proxy 使用 callback 模式，不保证 async handler 中的 `await` 会被正确等待。

**修复**：上面的方案中，`async` 回调用于 `ctx.clientToProxyRequest.on('end', async () => {...})`，这是 Node.js EventEmitter 的事件处理器，不是 http-mitm-proxy 的 callback。EventEmitter 不关心回调是否返回 Promise，所以 `await` 在这里正常工作。`callback()` 在 `await` 完成后才调用，proxy 会等待。

**但仍需验证**：http-mitm-proxy 是否有内部超时机制会在 callback 未调用时自动触发。

#### P0-R4：Section 3.3 vs Section 12 矛盾

**修复**：Section 3.3 的"不调用 callback()（请求暂停）"是正确方向。Section 12 的 P0-1/P0-2 修复代码应作废，以 Section 13.1 的 P0-R1/R2 为准。Section 6.1-6.3 的代码示例同步作废。

### 13.2 P1 高优先级问题（5项）

#### P1-R5：ctx._originalRequestBody 引用但未赋值

**问题**：P0-1 代码中 `if (modified.editable.requestBody !== ctx._originalRequestBody)` 引用了 `ctx._originalRequestBody`，但现有代码设置的是 `ctx._requestBody`。

**修复**：在 P0-R1 方案中已修复 — 不再比较 `ctx._originalRequestBody`，而是通过 `InterceptSession.original` 字段（P1-1 修复）保存原始数据，用户点"恢复原始"时从 `session.original` 恢复。

#### P1-R6：pushRequestArrived 时机冲突

**问题**：P0-1 在 resume 后才调用 `pushRequestArrived`，但 P1-5 要求拦截时立即显示"⏸ 拦截中"状态。

**修复**：在 P0-R1 方案中已修复 — 在创建 InterceptSession 后立即调用 `pushRequestArrived` + `pushBreakpointStatus(ctx._requestId, 'intercepting')`，不等用户编辑。

#### P1-R7：abort 不调 callback() → proxy 挂起

**问题**：abort 时 `ctx.proxyToClientResponse.destroy(); return` 不调 `callback()`，proxy 内部会一直等待。

**修复**：在 P0-R1 方案中已部分修复 — 同时 destroy server 端 `ctx.proxyToServerRequest?.destroy()`。对于"不调 callback()"的问题：
- **请求阶段 abort**：由于从未调过 `callback()`，proxy 不会建立 server 连接，只需 destroy client response 即可。但需要验证 proxy 是否有内部清理机制。
- **响应阶段 abort**：`callback()` 已在请求阶段调用，server 连接已建立。需 destroy `ctx.proxyToClientResponse`。
- **兜底方案**：如果 proxy 不清理，调用 `callback(new Error('aborted'))` 让 proxy 走错误处理路径。

#### P1-R8：断点规则未传递到 mitm-server.ts

**问题**：plan 未定义如何把断点规则从前端传到主进程的 proxy 层。现有 `domainFilters` 通过 `setDomainFilters()` 传递，断点规则需要类似机制。

**修复**：
```typescript
// mitm-server.ts 新增
let breakpointRules: BreakpointRule[] = []

export function setBreakpointRules(rules: BreakpointRule[]): void {
  breakpointRules = rules.filter(r => r.enabled)
}

// 在 onRequest 中使用
const breakpointMatch = breakpointRules.find(r => matchBreakpoint(url, method, r)) || null
```

```typescript
// main.ts — IPC handler 中同步规则到 proxy
ipcMain.handle(IPC_CHANNELS.BREAKPOINT_ADD_RULE, (_e, rule) => {
  breakpointStore.addRule(rule)
  setBreakpointRules(breakpointStore.getAllRules())  // 同步到 proxy
  sqlite.setSetting('breakpoint_rules', JSON.stringify(breakpointStore.getAllRules()))
})
// remove-rule / update-rule 同理
```

#### P1-R9：removeRequest() 不存在

**问题**：右键菜单"删除此请求"调用 `requestStore.removeRequest()`，但 `request-store.ts` 中没有此方法。

**修复**：在 `request-store.ts` 中新增：
```typescript
function removeRequest(id: string): void {
  const idx = requestIndexMap.get(id)
  if (idx !== undefined) {
    requests.value.splice(idx, 1)
    // 重建索引
    requestIndexMap.clear()
    requests.value.forEach((r, i) => requestIndexMap.set(r.id, i))
  }
}
```

### 13.3 P2 中等优先级问题（3项）

#### P2-R10：cURL 生成器未转义单引号

**修复**：
```typescript
function escapeShellSingleQuote(str: string): string {
  return str.replace(/'/g, "'\\''")
}

function generateCurl(request: RequestData): string {
  let curl = `curl -X ${request.method} '${escapeShellSingleQuote(request.url)}'`
  for (const [key, value] of Object.entries(request.requestHeaders || {})) {
    curl += ` \\\n  -H '${escapeShellSingleQuote(`${key}: ${value}`)}'`
  }
  if (request.requestBody) {
    if (request.requestBody.startsWith('[Base64:')) {
      curl += ` \\\n  --data-binary @request_body.bin  # 二进制数据，请从文件加载`
    } else {
      curl += ` \\\n  -d '${escapeShellSingleQuote(request.requestBody)}'`
    }
  }
  return curl
}
```

#### P2-R11：breakpointRules 未在 sqlite.ts 中定义

**问题**：plan 6.4 说规则通过 `settings-store` 持久化，但实际没有 `settings-store.ts`，持久化通过 `electron/db/sqlite.ts` 的 `getAllSettings()`/`saveAllSettings()` 实现。`AppSettings` 类型和这两个函数中都缺少 `breakpointRules` 字段。

**修复**：
1. `src/services/types.ts` — `AppSettings` 新增 `breakpointRules?: BreakpointRule[]`
2. `electron/db/sqlite.ts` — `getAllSettings()` 新增 `breakpointRules: JSON.parse(settingsMap.breakpoint_rules || '[]')`
3. `electron/db/sqlite.ts` — `saveAllSettings()` 新增 `if (settings.breakpointRules !== undefined) mapping.breakpoint_rules = JSON.stringify(settings.breakpointRules)`
4. `electron/ipc.ts` — `SETTINGS_SAVE_ALL` handler 中同步 `setBreakpointRules()` 到 proxy

#### P2-R12：stopProxy()/before-quit 未处理 pending interceptions

**问题**：当前 `stopProxy()` 直接 `proxyInstance.close()`，pending 的 `waitForBreakpointResume` Promise 永远不 resolve/reject，导致内存泄漏和前端 UI 卡在"拦截中"状态。

**修复**：
```typescript
// mitm-server.ts
const pendingInterceptions = new Map<string, {
  resolve: (modified: InterceptSession) => void
  reject: (reason: string) => void
}>()

export function abortAllPendingInterceptions(): void {
  for (const [id, { reject }] of pendingInterceptions) {
    reject('aborted')
  }
  pendingInterceptions.clear()
}

export async function stopProxy(): Promise<void> {
  // 先 abort 所有 pending interceptions
  abortAllPendingInterceptions()
  // 然后关闭 proxy
  if (proxyInstance) {
    proxyInstance.close()
    proxyInstance = null
  }
  proxyStatus = 'stopped'
}
```

```typescript
// main.ts — before-quit 中也调用
app.on('before-quit', async (e) => {
  // ... 现有 cleanup ...
  abortAllPendingInterceptions()
  // ...
})
```

### 13.4 修复后的任务列表（最终版）

| 序号 | 任务 | 依赖 | 涉及文件 | 变更说明 |
|------|------|------|---------|---------|
| T1 | 类型定义 + IPC 通道 + DB schema | 无 | `types.ts` + `sqlite.ts` | **新增** `original` 字段、`breakpointStatus`、`BreakpointResumePayload`、`AppSettings.breakpointRules` |
| T2 | 断点匹配引擎 | T1 | `breakpoint-matcher.ts` | **修复** URL 匹配逻辑（P2-1） |
| T3 | 断点 Store | T1 | `breakpoint-store.ts` | **新增** 规则验证、FIFO 队列、`removeRequest` |
| T4 | IPC 封装 + 规则同步 | T1 | `ipc.ts` + `preload.ts` | **新增** `setBreakpointRules` 同步机制 |
| T5 | mitm-server 断点拦截 | T1, T2 | `mitm-server.ts` | **⚠️ 核心重构**：延迟 callback + 直接监听流（P0-R1/R2），新增 `setBreakpointRules`、`abortAllPendingInterceptions` |
| T5.5 | **PoC 验证** | T5 | — | **新增**：写最小 PoC 验证 http-mitm-proxy 延迟 callback + headers 修改是否生效 |
| T6 | main.ts IPC handler | T4, T5 | `main.ts` | **新增** `before-quit`/`stopProxy` 中调 `abortAllPendingInterceptions` |
| T7 | BreakpointDialog | T3 | `BreakpointDialog.vue` | original 恢复、二进制只读、队列显示 |
| T8 | BreakpointRules 面板 | T3 | `BreakpointRules.vue` | — |
| T8.5 | 右键菜单 + cURL | T3 | `RequestContextMenu.vue` + `curl-generator.ts` | **修复** cURL 转义 |
| T9 | RequestList + App 集成 | T7, T8, T8.5 | `RequestList.vue` + `App.vue` | 拦截状态行样式 |
| T10 | 全局一致性审查 + 构建 | T9 | — | — |

### 13.5 ⚠️ 实现前必须验证的风险

| # | 风险 | 验证方法 | 降级方案 |
|---|------|---------|---------|
| R1 | http-mitm-proxy 延迟 callback() 后修改 `ctx.clientToProxyRequest.headers` 是否生效 | 写最小 PoC：onRequest 中不调 callback，监听流收集 body，修改 headers 后再调 callback，检查 Server 收到的 headers | 如果 headers 是缓存副本：用 `ctx.onRequestData` 替换整个请求流（PassThrough） |
| R2 | http-mitm-proxy 是否有 callback 超时机制 | 查看 http-mitm-proxy 源码 `onRequest` 实现 | 如有超时：设置更长的超时或禁用 |
| R3 | 直接监听 `ctx.clientToProxyRequest` 流是否与 proxy 内部管道冲突 | PoC 中检查是否有 `stream ended` 之类的错误 | 如果冲突：用 `ctx.onRequestData` + `callback()` 不转发的方式（body 有效但 headers 无效），或换用其他代理库 |
| R4 | async EventEmitter handler 中 callback() 延迟调用是否正常 | PoC 中检查请求是否正常完成 | 如果不正常：用 Promise + 同步 callback 组合 |

**建议**：T5.5 PoC 验证通过后再进入 T7-T10 的前端开发，避免返工。
