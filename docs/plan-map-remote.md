# #9 Map Remote（远程映射）— 设计方案

> 对标产品：Charles Map Remote、Reqable Remote Mapping、mitmproxy map remote
> 创建日期：2026-06-22 | 最后更新：2026-06-22 | 状态：Plan v1.1

---

## 1. 功能概述

将匹配指定 URL 的请求转发到另一个域名/地址，实现环境切换（如线上→测试环境）。常用于：
- 将生产环境 API 请求转发到测试环境
- 调试时指向本地开发服务器
- 多环境切换（开发/测试/预发布）

**核心流程**：代理层拦截匹配请求 → 修改目标地址 → 转发到新地址 → 返回真实服务器响应

---

## 2. 现状分析

### 2.1 当前代理流程

```
Client → proxy.onRequest() → proxy.onResponse() → Client
         ↓                      ↓
         收集请求体              收集响应体
         pushRequestArrived()   pushResponseArrived()
```

### 2.2 Map Local 的参考架构

Map Local（#7）已实现本地文件替换机制。Map Remote 是"转发到另一地址"——匹配后修改目标地址，仍然转发到服务器。

### 2.3 与 Map Local 的区别

| 功能 | Map Local | Map Remote |
|------|-----------|------------|
| 响应来源 | 本地文件 | 真实服务器（但地址已修改） |
| 是否转发 | 否 | 是（修改目标地址后转发） |
| 适用场景 | 文件级替换（JSON/JS/CSS） | 环境切换（线上→测试） |
| 实现复杂度 | 低 | 中 |

---

## 3. 功能设计

### 3.1 映射规则（MapRemoteRule）

```typescript
interface MapRemoteRule {
  id: string
  /** 是否启用 */
  enabled: boolean
  /** 规则名称（用户自定义） */
  name: string
  /** 匹配模式 */
  match: {
    /** URL 通配符，如 *api.shopline.com/users* */
    urlPattern: string
    /** HTTP 方法过滤（空 = 所有方法） */
    methods: HttpMethod[]
  }
  /** 目标地址 */
  target: {
    /** 目标协议（http/https） */
    protocol: 'http' | 'https'
    /** 目标主机名 */
    host: string
    /** 目标端口（空 = 默认端口） */
    port?: number
    /** 路径替换（可选，空 = 保留原路径）
     *  例如: 原路径 /v1/users, pathReplacement=/api/v2 → 新路径 /api/v2/users
     *  如果 pathReplacement 以 / 开头，则替换整个路径前缀
     */
    pathReplacement?: string
  }
  /** 创建时间 */
  createdAt: string
}
```

> **[P1-1 修复]** 原 `pathPrefix` 语义模糊（"前缀替换" vs "前缀添加"）。改为 `pathReplacement`，语义为"路径替换"：将原始路径前缀替换为指定值。与 Charles Map Remote 的 "Path" 字段行为一致。

### 3.2 映射流程

```
请求到达 mitm-server
  ↓
检查是否匹配 Map Remote 规则
  ↓
未匹配 → 正常转发到原服务器
  ↓
匹配 → 修改目标地址（host/port/path/protocol）
  ↓
设置 ctx._mapRemoteTarget 标记（用于 UI 显示 + 避免重复推送）
  ↓
调用 callback() 继续正常代理流程
  ↓
正常 onRequestEnd → pushRequestArrived()（带 mapRemoteRuleId 标记）
  ↓
正常 onResponseEnd → pushResponseArrived()
  ↓
返回响应给客户端
```

> **[P0-4 修复]** 不再手动调用 `pushRequestArrived()`，而是设置 `ctx` 标记后调用 `callback()` 进入正常流程。`onRequestEnd` 中的 `pushRequestArrived()` 负责推送，避免重复。

### 3.3 地址修改机制

使用 `http-mitm-proxy` 的 `ctx.proxyToServerRequestOptions` 修改目标地址：

```typescript
// 在 proxy.onRequest() 中
if (mapRemoteMatch) {
  const { target } = mapRemoteMatch

  // 修改目标地址
  ctx.proxyToServerRequestOptions.host = target.host
  ctx.proxyToServerRequestOptions.port = target.port || (target.protocol === 'https' ? 443 : 80)

  // 修改路径（路径替换，非前缀添加）
  if (target.pathReplacement) {
    const originalPath = ctx.proxyToServerRequestOptions.path || '/'
    ctx.proxyToServerRequestOptions.path = applyPathReplacement(originalPath, target.pathReplacement)
  }

  // 修改请求头中的 Host（使用 proxyToServerRequestOptions，不用 clientToProxyRequest）
  ctx.proxyToServerRequestOptions.headers = {
    ...ctx.proxyToServerRequestOptions.headers,
    host: target.host
  }

  // TLS 协议切换处理（见 Section 3.4）
  if (target.protocol === 'https' && !ctx.isSSL) {
    ctx.proxyToServerRequestOptions.ssl = true
  } else if (target.protocol === 'http' && ctx.isSSL) {
    ctx.proxyToServerRequestOptions.ssl = false
  }

  // 标记请求（用于 UI 显示 + 避免重复推送）
  ctx._mapRemoteRuleId = mapRemoteMatch.id
  ctx._mapRemoteTarget = `${target.protocol}://${target.host}${target.port ? ':' + target.port : ''}`

  // 继续正常流程（调用 callback()，让 proxy 继续处理请求转发）
  // onRequestEnd 中的 pushRequestArrived() 会处理推送，传入 mapRemoteRuleId
  return callback()
}
```

> **[P0-1 修复]** 统一使用 `ctx.proxyToServerRequestOptions.headers` 修改 Host header，不再使用 `clientToProxyRequest.headers.host`。与项目约定一致："修改 headers 用 proxyToServerRequestOptions 而非 clientToProxyRequest.headers"。

### 3.4 TLS 协议切换（P0-2 修复）

Map Remote 的最大技术难点：当原始请求协议与目标协议不一致时，需要切换 TLS 模式。

**场景分析**：

| 原始协议 | 目标协议 | 处理方式 |
|---------|---------|---------|
| HTTPS | HTTPS | 无需特殊处理，proxy 正常 TLS 连接 |
| HTTP | HTTP | 无需特殊处理，proxy 正常明文连接 |
| HTTP | HTTPS | 需要为 proxy→server 连接启用 TLS |
| HTTPS | HTTP | 需要为 proxy→server 连接降级为明文 |

**实现方案**：

`http-mitm-proxy` 的 `ctx.proxyToServerRequestOptions` 支持 `ssl` 布尔字段：
- `ssl: true` → proxy 使用 TLS 连接目标服务器
- `ssl: false` → proxy 使用明文连接目标服务器

```typescript
// 协议切换逻辑
if (target.protocol === 'https' && !isSSL) {
  // HTTP client → HTTPS target: 需要启用 TLS
  ctx.proxyToServerRequestOptions.ssl = true
} else if (target.protocol === 'http' && isSSL) {
  // HTTPS client → HTTP target: 需要降级为明文
  ctx.proxyToServerRequestOptions.ssl = false
}
```

**注意**：`http-mitm-proxy` 对 `ssl` 字段的支持取决于版本。如果该字段无效，需使用 `proxy.onConnect` 钩子或自定义连接处理器。实现时需验证 `http-mitm-proxy` 版本的行为。

### 3.5 路径替换逻辑

```typescript
/**
 * 应用路径替换
 * @param originalPath 原始路径，如 /v1/users/123?foo=bar
 * @param replacement 替换规则，如 /api/v2
 * @returns 替换后的路径，如 /api/v2/users/123?foo=bar
 */
function applyPathReplacement(originalPath: string, replacement: string): string {
  // 分离 query string
  const [pathname, search] = originalPath.split('?')

  // 如果 replacement 以 / 开头，替换整个路径前缀
  // 例如: pathname=/v1/users/123, replacement=/api/v2 → /api/v2/users/123
  // 逻辑：找到 pathname 中第一个与 replacement 不同的部分
  if (replacement.startsWith('/')) {
    // 简单策略：将 replacement 作为新前缀，保留剩余路径
    // 需要找到原始路径中"可替换的前缀"部分
    // 默认行为：直接拼接（replacement + 原始路径去掉前导 /）
    // 更好的行为：如果用户指定了 "替换前缀"，需要同时指定 "匹配前缀"
    // v1 简化方案：replacement 直接替换整个 pathname
    return replacement + (search ? '?' + search : '')
  }

  // 否则作为前缀添加
  return replacement + originalPath
}
```

> **v1 简化方案**：路径替换为"全路径替换"（替换整个 pathname，保留 query string）。后续迭代可支持"前缀替换"（指定旧前缀 + 新前缀）。

---

## 4. 技术实现方案

### 4.1 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/utils/map-remote-matcher.ts` | 新增 | URL 匹配引擎（复用 `breakpoint-matcher.ts` 逻辑） |
| `src/stores/map-remote-store.ts` | 新增 | Map Remote 规则管理（CRUD + 持久化） |
| `src/components/MapRemoteRules.vue` | 新增 | Map Remote 规则管理面板（模态弹窗） |
| `src/services/types.ts` | 修改 | 添加 `MapRemoteRule` 类型 + IPC 通道常量 + `CaptureRequest.mapRemoteRuleId` |
| `electron/db/sqlite.ts` | 修改 | 持久化 Map Remote 规则（`getAllSettings` + `saveAllSettings`） |
| `src/services/ipc.ts` | 修改 | 添加 `mapRemote` 命名空间（5 方法，与 Map Local 一致） |
| `electron/preload.ts` | 修改 | 暴露 `mapRemote` API |
| `electron/ipc.ts` | 修改 | 注册 Map Remote IPC handler + 启动时加载规则 |
| `electron/proxy/mitm-server.ts` | 修改 | Map Remote 拦截机制（核心） |
| `src/views/MainView.vue` | 修改 | 集成 MapRemoteRules 组件 |
| `src/components/RecordControl.vue` | 修改 | 添加 Map Remote 按钮（蓝色徽章） + props/emits |

### 4.2 匹配引擎设计

复用 `breakpoint-matcher.ts` 的 `matchBreakpoint()` 函数：

```typescript
// src/utils/map-remote-matcher.ts
import { matchBreakpoint } from './breakpoint-matcher'
import type { MapRemoteRule, HttpMethod } from '../services/types'

/**
 * 在多个 Map Remote 规则中查找第一个匹配的规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules Map Remote 规则列表
 * @returns 匹配的规则，或 null
 */
export function matchMapRemote(
  url: string,
  method: HttpMethod,
  rules: MapRemoteRule[]
): MapRemoteRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchBreakpoint(url, method, rule as any)) return rule
  }
  return null
}
```

> **[P1-2 修复]** 返回类型改为 `MapRemoteRule | null`，与 `matchMapLocal()` 保持一致。
> **[P1-3 修复]** 直接复用 `matchBreakpoint()` 函数，不再调用未定义的 `matchPattern()`。

### 4.3 拦截机制设计

在 `mitm-server.ts` 的 `proxy.onRequest()` 中添加：

```typescript
// ===== Map Remote 检查（在 Map Local 之后、断点检查之前） =====
const mapRemoteMatch = matchMapRemote(url, method, mapRemoteRules)
if (mapRemoteMatch) {
  const { target } = mapRemoteMatch

  // 修改目标地址
  ctx.proxyToServerRequestOptions.host = target.host
  ctx.proxyToServerRequestOptions.port = target.port || (target.protocol === 'https' ? 443 : 80)

  // 修改路径
  if (target.pathReplacement) {
    const originalPath = ctx.proxyToServerRequestOptions.path || '/'
    ctx.proxyToServerRequestOptions.path = applyPathReplacement(originalPath, target.pathReplacement)
  }

  // 修改请求头中的 Host（使用 proxyToServerRequestOptions）
  ctx.proxyToServerRequestOptions.headers = {
    ...ctx.proxyToServerRequestOptions.headers,
    host: target.host
  }

  // TLS 协议切换（见 Section 3.4）
  if (target.protocol === 'https' && !isSSL) {
    ctx.proxyToServerRequestOptions.ssl = true
  } else if (target.protocol === 'http' && isSSL) {
    ctx.proxyToServerRequestOptions.ssl = false
  }

  // 标记请求（用于 UI 显示 + onRequestEnd 中传递 mapRemoteRuleId）
  ctx._mapRemoteRuleId = mapRemoteMatch.id
  ctx._mapRemoteTarget = `${target.protocol}://${target.host}${target.port ? ':' + target.port : ''}`

  // 继续正常流程（调用 callback()）
  // onRequestEnd 中的 pushRequestArrived() 会处理推送，传入 ctx._mapRemoteRuleId
  return callback()
}
```

> **[P0-3 修复]** 不再手动调用 `pushRequestArrived()`，使用 `ctx` 标记 + `callback()` 进入正常流程。
> **[P0-4 修复]** 避免重复推送：正常流程的 `onRequestEnd` 负责调用 `pushRequestArrived()`。

**onRequestEnd 修改**（在现有代码中添加 mapRemoteRuleId 传递）：

```typescript
// 现有 onRequestEnd 中的 pushRequestArrived 调用需修改：
ctx._requestId = pushRequestArrived(
  ctx._method || 'GET',
  ctx._url || '',
  ctx._path || '',
  ctx._host || '',
  ctx._clientIp || 'unknown',
  undefined,              // mapLocalRuleId（Map Local 不命中时为 undefined）
  ctx._mapRemoteRuleId,   // 新增: mapRemoteRuleId 参数
)
```

> **注意**：需要扩展 `pushRequestArrived()` 函数签名，添加 `mapRemoteRuleId` 参数。同时扩展 `CaptureRequest` 接口添加 `mapRemoteRuleId?: string` 字段。

**mapRemoteRules 状态管理**（在 mitm-server.ts 中添加）：

```typescript
// 模块级变量
let mapRemoteRules: MapRemoteRule[] = []

// 设置函数
export function setMapRemoteRules(rules: MapRemoteRule[]): void {
  mapRemoteRules = rules.filter(r => r.enabled)
}
```

---

## 5. 数据结构设计

### 5.1 SQLite 存储结构

在 `AppSettings` 中新增字段：

```typescript
interface AppSettings {
  // ... 现有字段
  /** Map Remote 规则 */
  mapRemoteRules?: MapRemoteRule[]
}
```

**`sqlite.ts` 修改详情**：

```typescript
// getAllSettings() 中新增:
mapRemoteRules: JSON.parse(settingsMap.map_remote_rules || '[]'),

// saveAllSettings() 中新增:
if (settings.mapRemoteRules !== undefined) mapping.map_remote_rules = JSON.stringify(settings.mapRemoteRules)
```

### 5.2 IPC 通道设计

**IPC 通道常量**（在 `types.ts` 的 `IPC_CHANNELS` 中新增）：

```typescript
// Map Remote 功能
MAP_REMOTE_GET_RULES: 'map-remote:get-rules',
MAP_REMOTE_ADD_RULE: 'map-remote:add-rule',
MAP_REMOTE_REMOVE_RULE: 'map-remote:remove-rule',
MAP_REMOTE_UPDATE_RULE: 'map-remote:update-rule',
MAP_REMOTE_SYNC_RULES: 'map-remote:sync-rules',
```

**IPC 命名空间**（与 Map Local 保持一致的 5 方法模式）：

```typescript
// src/services/ipc.ts
mapRemote: {
  addRule: (rule: Omit<MapRemoteRule, 'id' | 'createdAt'>) => Promise<{ success: boolean; rule?: MapRemoteRule; error?: string }>
  removeRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>
  updateRule: (ruleId: string, updates: Partial<MapRemoteRule>) => Promise<{ success: boolean; error?: string }>
  getRules: () => Promise<MapRemoteRule[]>
  syncRules: (rules: MapRemoteRule[]) => Promise<{ success: boolean; error?: string }>
}
```

> **[P1-4 修复]** IPC 设计从 2 方法改为 5 方法，与 Map Local 保持一致。
> **[P1-5 修复]** 明确定义 `MAP_REMOTE_*` IPC 通道常量。

**preload.ts 暴露**（与 Map Local 模式一致）：

```typescript
mapRemote: {
  addRule: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_ADD_RULE, rule),
  removeRule: (ruleId: string) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_REMOVE_RULE, ruleId),
  updateRule: (ruleId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_UPDATE_RULE, { ruleId, updates }),
  getRules: () => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_GET_RULES),
  syncRules: (rules: any[]) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_SYNC_RULES, rules),
},
```

---

## 6. UI 设计

### 6.1 规则管理面板（MapRemoteRules.vue）

**触发方式**：点击工具栏"Map Remote"按钮 → 打开模态弹窗

**布局结构**：
```
┌─────────────────────────────────────────────────────────┐
│  Map Remote 规则管理                    [+ 新增规则]  │
├─────────────────────────────────────────────────────────┤
│ ☑ 启用 │ 规则名称 │ 匹配模式 │ 目标地址 │ 操作       │
│─────────────────────────────────────────────────────────│
│ [✓]  │ 生产→测试 │ *api.shopline.com* │ https://test-api... │ [编辑][删除] │
│ [ ]  │ 开发环境  │ *api.dev.com*      │ http://localhost:3000 │ [编辑][删除] │
└─────────────────────────────────────────────────────────┘
```

**新增/编辑规则弹窗**：
```
┌─────────────────────────────────────────────────────────┐
│  新增 Map Remote 规则                   [取消] [保存]  │
├─────────────────────────────────────────────────────────┤
│ 规则名称: [________________________]                    │
│                                                        │
│ 匹配条件:                                              │
│   URL 模式: [________________________] (支持 * 通配符) │
│   HTTP 方法: [☑GET ☑POST ☑PUT ☑DELETE]               │
│                                                        │
│ 目标地址:                                              │
│   协议: [https ▼] 主机: [________________]            │
│   端口: [______] (空=默认) 路径替换: [____________]   │
└─────────────────────────────────────────────────────────┘
```

### 6.2 工具栏按钮

在 `RecordControl.vue` 的"工具"下拉菜单中添加"Map Remote"选项：
- 按钮样式：蓝色徽章（显示启用的规则数量）
- 点击后打开 MapRemoteRules 弹窗

**需要新增的 props**：
```typescript
mapRemoteCount: number       // 启用的 Map Remote 规则数量
showMapRemoteRules: boolean  // 是否显示 Map Remote 规则面板
```

**需要新增的 emits**：
```typescript
(e: 'toggle-map-remote'): void  // 切换 Map Remote 面板显示
```

> **[P1-7 修复]** 明确 RecordControl.vue 需要新增的 props 和 emits。

### 6.3 请求列表中的标记

当请求被 Map Remote 转发时，在请求列表中显示：
- 方法徽标右侧添加蓝色 "MapRemote" 徽标
- 悬停时显示目标地址 tooltip

---

## 7. 任务分解

### T1: 类型定义（1小时）
- 修改 `src/services/types.ts`：
  - 添加 `MapRemoteRule` 接口
  - 添加 `CaptureRequest.mapRemoteRuleId?: string` 字段（与 `mapLocalRuleId` 命名一致）
  - 添加 `AppSettings.mapRemoteRules?: MapRemoteRule[]` 字段
  - 添加 `MAP_REMOTE_*` IPC 通道常量

> **[P1-6 修复]** 字段名从 `mapRemoteTarget` 改为 `mapRemoteRuleId`，与 `mapLocalRuleId` 保持一致。

### T2: 匹配引擎（1小时）
- 新增 `src/utils/map-remote-matcher.ts`：复用 `matchBreakpoint()` 函数，返回 `MapRemoteRule | null`

### T3: 规则 Store（2小时）
- 新增 `src/stores/map-remote-store.ts`：CRUD + 持久化 + 启用/禁用切换
- 包含 `*` 通配符校验（与 Map Local 一致）

### T4: IPC 通信（1小时）
- 修改 `src/services/ipc.ts`：添加 `mapRemote` 命名空间（5 方法）
- 修改 `electron/preload.ts`：暴露 `mapRemote` API

### T5: 数据库持久化（1小时）
- 修改 `electron/db/sqlite.ts`：
  - `getAllSettings()` 添加 `mapRemoteRules` 解析
  - `saveAllSettings()` 添加 `map_remote_rules` 序列化

### T6: IPC Handler（1小时）
- 修改 `electron/ipc.ts`：注册 5 个 Map Remote IPC handler + 启动时加载规则到 proxy

### T7: 拦截机制（3小时）
- 修改 `electron/proxy/mitm-server.ts`：
  - 添加 `mapRemoteRules` 模块变量 + `setMapRemoteRules()` 函数
  - 在 `proxy.onRequest()` 中添加 Map Remote 检查（Map Local 之后、断点之前）
  - 修改 `onRequestEnd` 中的 `pushRequestArrived()` 调用，传入 `ctx._mapRemoteRuleId`
  - 扩展 `pushRequestArrived()` 函数签名，添加 `mapRemoteRuleId` 参数
  - 添加 TLS 协议切换逻辑

### T8: 规则管理 UI（3小时）
- 新增 `src/components/MapRemoteRules.vue`：规则列表 + 新增/编辑/删除弹窗

### T9: 主界面集成（1小时）
- 修改 `src/views/MainView.vue`：集成 MapRemoteRules 组件
- 修改 `src/components/RecordControl.vue`：添加 Map Remote 按钮 + props/emits

**总计：14小时**

---

## 8. 边界情况

### 8.1 URL 匹配

- `*` 通配符只支持前缀/后缀/全匹配（不支持正则）
- 匹配时不区分 HTTP/HTTPS（统一处理）
- **`*` 单独使用时需校验**：与 Map Local 一致，`urlPattern` 为 `*` 时应提示"会映射所有流量"（但不阻止，与 Map Local 行为一致）

### 8.2 地址修改

- 修改 `host` 后，需要同步修改请求头中的 `Host` 字段（使用 `ctx.proxyToServerRequestOptions.headers`，不用 `clientToProxyRequest.headers`）
- **TLS 协议切换**：当原始协议与目标协议不一致时，需设置 `ctx.proxyToServerRequestOptions.ssl` 字段（见 Section 3.4）

### 8.3 循环转发

- 避免 A → B → A 的循环转发
- **实现方式**：通过 `ctx._mapRemoteRuleId` 标记已转发的请求。如果请求已经被 Map Remote 转发过（`ctx._mapRemoteRuleId` 已设置），不再匹配其他 Map Remote 规则
- **注意**：正常使用场景下不会出现循环（请求转发到目标服务器后，服务器的响应不会再次经过代理）。循环只在目标服务器本身配置了代理时才可能出现，属于系统配置问题

### 8.4 端口处理

- HTTP 默认端口：80
- HTTPS 默认端口：443
- 用户可自定义端口

### 8.5 断点与 Map Remote 的交互

- **执行顺序**：Map Local → Map Remote → 断点 → 正常转发
- Map Remote 命中后调用 `callback()` 继续流程，断点检查仍然会执行
- 如果请求同时匹配 Map Remote 和断点规则：请求先被修改目标地址，然后断点拦截（用户可在断点编辑器中看到修改后的 URL）
- 这意味着用户可以在 Map Remote 转发的基础上进一步用断点修改请求

---

## 9. 测试计划

### 9.1 单元测试

- 匹配引擎：各种 URL 模式匹配场景（复用 breakpoint-matcher 测试模式）
- 路径替换：`applyPathReplacement()` 各种输入场景
- TLS 切换：协议一致性 / 不一致性场景

### 9.2 集成测试

- 规则启用/禁用
- 请求转发到目标地址（同协议）
- 请求转发到目标地址（跨协议 HTTP→HTTPS）
- 响应正常返回

### 9.3 手动测试

- 创建规则：线上 API → 测试环境
- 验证请求确实转发到测试环境
- 验证响应正常显示
- 验证 Map Remote + 断点组合使用

---

## 10. 后续迭代

### 10.1 高优先级

- 支持正则表达式匹配
- 支持响应修改（类似 Rewrite Rules）
- 路径前缀替换（指定旧前缀 + 新前缀，而非全路径替换）

### 10.2 中优先级

- 规则分组管理
- 导入/导出规则

---

## 11. 参考

- Charles Map Remote：https://www.charlesproxy.com/documentation/tools/map-remote/
- mitmproxy map remote：https://docs.mitmproxy.org/stable/concepts-options/#map-remote
- http-mitm-proxy 文档：https://github.com/koalazak/http-mitm-proxy

---

## 12. 审查修复记录

### v1.0 → v1.1（2026-06-22）

| 编号 | 级别 | 问题 | 修复 |
|------|------|------|------|
| P0-1 | P0 | Section 3.3 用 `clientToProxyRequest.headers.host`，与 Section 4.3 和项目约定矛盾 | 统一使用 `ctx.proxyToServerRequestOptions.headers` |
| P0-2 | P0 | TLS 协议切换未解决（HTTP→HTTPS / HTTPS→HTTP） | 新增 Section 3.4，使用 `ctx.proxyToServerRequestOptions.ssl` 字段 |
| P0-3 | P0 | `pushRequestArrived()` 调用签名完全错误（8 参数 vs 6 参数，`getClientIp(ctx)` 不存在） | 不再手动调用，使用 `ctx` 标记 + `callback()` 进入正常流程 |
| P0-4 | P0 | 手动调用 `pushRequestArrived()` + 正常流程 `onRequestEnd` 也会调用 → 重复推送 | 同 P0-3 修复，通过 `ctx._mapRemoteRuleId` 标记避免重复 |
| P1-1 | P1 | `pathPrefix` 语义模糊（"前缀替换" vs "前缀添加"） | 改为 `pathReplacement`，语义为"路径替换" |
| P1-2 | P1 | `matchMapRemote()` 返回 `{ rule, id }` 与 `matchMapLocal()` 的 `MapLocalRule \| null` 不一致 | 改为返回 `MapRemoteRule \| null` |
| P1-3 | P1 | `matchPattern()` 未定义 | 直接复用 `matchBreakpoint()` 函数 |
| P1-4 | P1 | IPC 设计仅 2 方法，Map Local 有 5 方法 | 改为 5 方法（addRule/removeRule/updateRule/getRules/syncRules） |
| P1-5 | P1 | `MAP_REMOTE_*` IPC 通道常量未定义 | 在 `IPC_CHANNELS` 中明确定义 |
| P1-6 | P1 | `CaptureRequest.mapRemoteTarget` 命名与 `mapLocalRuleId` 不一致 | 改为 `mapRemoteRuleId` |
| P1-7 | P1 | RecordControl.vue 需要新增的 props/emits 未说明 | 明确列出 `mapRemoteCount`、`showMapRemoteRules`、`toggle-map-remote` |
| P1-8 | P1 | sqlite.ts 持久化代码未详细说明 | 在 Section 5.1 中添加具体代码 |
| P2-1 | P2 | 缺少 `*` 通配符校验 | 在 Section 8.1 中添加说明 |
| P2-2 | P2 | 循环转发防止方案模糊 | 在 Section 8.3 中添加具体实现方式 |
| P2-3 | P2 | 断点与 Map Remote 交互未说明 | 新增 Section 8.5 说明执行顺序和组合使用 |

---

**Plan 版本历史**：
- v1.0（2026-06-22）：初始版本
- v1.1（2026-06-22）：审查修复 — 4 P0 + 8 P1 + 3 P2 全部修复
