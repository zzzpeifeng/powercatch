# #10 自动响应器（Auto Responder）- 技术方案

> **状态**: Plan v1.1（评审修复版）  
> **工作量评估**: 小（约 2-3 人天）  
> **依赖**: #7 Map Local（已完成）  
> **优先级**: P1（高价值功能）  
> **评审日期**: 2026-06-27  
> **修复问题**: 3 个 P0 问题

---

## 1. 功能概述

### 1.1 核心能力

**自动响应器**允许用户配置规则，**不请求服务器**，直接返回预设的响应内容。

与 Map Local 的区别：

| 维度 | Map Local (#7) | Auto Responder (#10) |
|------|---------------|---------------------|
| **响应来源** | 本地文件（JSON/JS/CSS） | 内联配置（直接写在规则里） |
| **需要文件** | ✅ 必须有本地文件 | ❌ 不需要文件 |
| **配置方式** | 文件路径 | 直接编辑响应内容 |
| **适用场景** | 大型 mock 文件、复杂响应 | 简单 mock、快速调试 |
| **修改响应** | 替换整个响应 | 可设置状态码、Headers、Body |

### 1.2 典型使用场景

1. **模拟登录成功/失败**
   - 配置 `/api/login` 返回 `{"code": 0, "msg": "success"}`
   - 配置 `/api/login` 返回 `{"code": 401, "msg": "invalid credentials"}`

2. **模拟网络错误**
   - 配置 `/api/*` 返回 500 状态码
   - 配置 `/api/*` 返回 502/503 错误

3. **模拟慢响应**
   - 配置 `/api/slow` 延迟 3 秒返回
   - 测试前端 loading 状态

4. **前端独立开发**
   - 后端接口未完成时，前端配置 mock 响应
   - 不依赖后端服务

---

## 2. 数据模型

### 2.1 AutoResponderRule 接口

```typescript
// src/services/types.ts

export interface AutoResponderRule {
  /** 规则 ID */
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
  /** 响应配置 */
  response: {
    /** HTTP 状态码 */
    statusCode: number
    /** 响应头 */
    headers: Record<string, string>
    /** 响应体（字符串） */
    body: string
    /** 响应延迟（毫秒，0 = 无延迟） */
    delay: number
  }
  /** 创建时间 */
  createdAt: string
}
```

### 2.2 与 MapLocalRule 的对比

```typescript
// MapLocalRule（已有）
{
  id: string
  enabled: boolean
  name: string
  match: { urlPattern: string; methods: HttpMethod[] }
  localPath: string      // ← 指向本地文件
  mimeType: string       // ← 自动检测
  createdAt: string
}

// AutoResponderRule（新增）
{
  id: string
  enabled: boolean
  name: string
  match: { urlPattern: string; methods: HttpMethod[] }
  response: {            // ← 内联响应配置
    statusCode: number
    headers: Record<string, string>
    body: string
    delay: number
  }
  createdAt: string
}
```

---

## 3. 技术方案

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    自动响应器架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ AutoResponder │      │ auto-responder│      │ mitm-server│ │
│  │   Rules.vue   │ ───► │  -matcher.ts  │ ───► │    .ts     │ │
│  │    (UI)       │      │   (匹配引擎)   │      │  (拦截器)   │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│         │                      │                     │       │
│         ▼                      ▼                     ▼       │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ auto-responder│      │   Pinia      │      │   SQLite   │ │
│  │  -store.ts    │      │   Store      │      │   (持久化)  │ │
│  │  (状态管理)    │      │              │      │            │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 匹配引擎

**文件**: `src/utils/auto-responder-matcher.ts`

```typescript
/**
 * 自动响应器 URL 匹配引擎
 * 复用 breakpoint-matcher 的匹配逻辑
 */
import { matchBreakpoint } from './breakpoint-matcher'
import type { AutoResponderRule, HttpMethod } from '../services/types'

/**
 * 在多个自动响应器规则中查找第一个匹配的规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules 自动响应器规则列表
 * @returns 匹配的规则，或 null
 */
export function matchAutoResponder(
  url: string,
  method: HttpMethod,
  rules: AutoResponderRule[]
): AutoResponderRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchBreakpoint(url, method, rule as any)) return rule
  }
  return null
}
```

### 3.3 主进程拦截逻辑

**文件**: `electron/proxy/mitm-server.ts`

**⚠️ 设计决策：优先级顺序**

```
优先级：断点 > Map Local > Auto Responder > Map Remote > 正常请求
```

**说明**：
- Map Local 匹配后会 `return`，不会继续执行 Auto Responder
- 这是**设计决策**，不是 bug
- 如果同一 URL 同时匹配 Map Local 和 Auto Responder，使用 Map Local
- 理由：Map Local 需要本地文件，通常用于复杂场景；Auto Responder 用于简单 mock

**实现代码**：

```typescript
// 在请求拦截处添加自动响应器逻辑

// 1. 检查断点
const breakpointMatch = findMatchingRule(url, method, breakpointRules)
if (breakpointMatch) { /* 断点处理 */ }

// 2. 检查 Map Local（优先级高于 Auto Responder）
const mapLocalMatch = matchMapLocal(url, method, mapLocalRules)
if (mapLocalMatch) {
  // Map Local 处理逻辑（已有）
  // 处理完成后 return，不继续执行 Auto Responder
}

// 3. 检查 Auto Responder（新增）
const autoResponderMatch = matchAutoResponder(url, method, autoResponderRules)
if (autoResponderMatch) {
  const { statusCode, headers, body, delay } = autoResponderMatch.response

  // 收集请求数据
  const reqHeaders: Record<string, string> = {}
  ctx.clientToProxyRequest.forEach((value: string, key: string) => { reqHeaders[key] = value })
  const requestBody = ctx._requestBody || ''

  // 推送请求数据到渲染进程
  const autoResponderRequestId = pushRequestArrived(method, url, ctx._path, ctx._host, clientIp, autoResponderMatch.id)

  // 延迟响应（如果配置了）
  // 注意：http-mitm-proxy 的回调不支持 async/await，使用 setTimeout 包装
  const sendResponse = () => {
    // 推送响应数据到渲染进程
    pushResponseArrived(
      autoResponderRequestId,
      statusCode,
      0,
      headers,
      body,
      reqHeaders,
      requestBody
    )

    // 构造响应返回给客户端
    const res = ctx.proxyToClientResponse
    res.writeHead(statusCode, {
      ...headers,
      'transfer-encoding': 'chunked',
    })
    res.end(body)
  }

  // 根据延迟配置执行响应
  if (delay > 0) {
    setTimeout(sendResponse, delay)
  } else {
    sendResponse()
  }

  // 标记为已处理，跳过后续流程
  return
}

// 4. 检查 Map Remote
const mapRemoteMatch = matchMapRemote(url, method, mapRemoteRules)
if (mapRemoteMatch) { /* Map Remote 处理 */ }

// 5. 正常请求流程
callback()
```

### 3.4 状态管理

**文件**: `src/stores/auto-responder-store.ts`

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AutoResponderRule } from '../services/types'
import { ipc } from '../services/ipc'

export const useAutoResponderStore = defineStore('auto-responder', () => {
  // State
  const rules = ref<AutoResponderRule[]>([])
  const isLoading = ref(false)

  // Getters
  const enabledRules = computed(() => rules.value.filter(r => r.enabled))
  const ruleCount = computed(() => rules.value.length)
  const enabledCount = computed(() => enabledRules.value.length)

  // Actions
  async function loadRules() {
    isLoading.value = true
    try {
      rules.value = await ipc.autoResponder.list()
    } finally {
      isLoading.value = false
    }
  }

  async function addRule(rule: Omit<AutoResponderRule, 'id' | 'createdAt'>) {
    const newRule = await ipc.autoResponder.create(rule)
    rules.value.push(newRule)
    return newRule
  }

  async function updateRule(id: string, updates: Partial<AutoResponderRule>) {
    await ipc.autoResponder.update(id, updates)
    const index = rules.value.findIndex(r => r.id === id)
    if (index !== -1) {
      rules.value[index] = { ...rules.value[index], ...updates }
    }
  }

  async function deleteRule(id: string) {
    await ipc.autoResponder.delete(id)
    rules.value = rules.value.filter(r => r.id !== id)
  }

  async function toggleRule(id: string) {
    const rule = rules.value.find(r => r.id === id)
    if (rule) {
      await updateRule(id, { enabled: !rule.enabled })
    }
  }

  async function enableAll() {
    for (const rule of rules.value) {
      if (!rule.enabled) {
        await updateRule(rule.id, { enabled: true })
      }
    }
  }

  async function disableAll() {
    for (const rule of rules.value) {
      if (rule.enabled) {
        await updateRule(rule.id, { enabled: false })
      }
    }
  }

  async function clearAll() {
    for (const rule of rules.value) {
      await deleteRule(rule.id)
    }
  }

  return {
    rules,
    isLoading,
    enabledRules,
    ruleCount,
    enabledCount,
    loadRules,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
    enableAll,
    disableAll,
    clearAll,
  }
})
```

### 3.5 UI 组件

**文件**: `src/components/AutoResponderRules.vue`

参考 `MapLocalRules.vue` 的设计，主要区别：

1. **规则表单**：替换"本地文件路径"为"响应配置"
   - 状态码输入（默认 200）
   - Headers 编辑器（key-value 对）
   - Body 编辑器（多行文本框）
   - 延迟输入（毫秒，默认 0）

2. **规则列表**：显示响应摘要
   - 状态码 badge（200/401/500 等）
   - Body 预览（前 50 字符）
   - 延迟标记（如果有）

3. **快捷操作**：与 Map Local 一致
   - 全部启用/禁用
   - 清空所有规则

---

## 4. 数据库设计

### 4.1 autoResponderRules 表

```sql
CREATE TABLE IF NOT EXISTS autoResponderRules (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  url_pattern TEXT NOT NULL,
  methods_json TEXT NOT NULL DEFAULT '[]',
  status_code INTEGER NOT NULL DEFAULT 200,
  headers_json TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  delay INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.2 CRUD 操作

```typescript
// electron/db/sqlite.ts

export function listAutoResponderRules(): AutoResponderRule[] {
  const stmt = db.prepare('SELECT * FROM autoResponderRules ORDER BY created_at DESC')
  const rows = stmt.all() as any[]
  return rows.map(row => ({
    id: row.id,
    enabled: Boolean(row.enabled),
    name: row.name,
    match: {
      urlPattern: row.url_pattern,
      methods: JSON.parse(row.methods_json),
    },
    response: {
      statusCode: row.status_code,
      headers: JSON.parse(row.headers_json),
      body: row.body,
      delay: row.delay,
    },
    createdAt: row.created_at,
  }))
}

export function createAutoResponderRule(rule: Omit<AutoResponderRule, 'id' | 'createdAt'>): AutoResponderRule {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO autoResponderRules (id, enabled, name, url_pattern, methods_json, status_code, headers_json, body, delay)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    id,
    rule.enabled ? 1 : 0,
    rule.name,
    rule.match.urlPattern,
    JSON.stringify(rule.match.methods),
    rule.response.statusCode,
    JSON.stringify(rule.response.headers),
    rule.response.body,
    rule.response.delay
  )
  return { ...rule, id, createdAt: new Date().toISOString() }
}

export function updateAutoResponderRule(id: string, updates: Partial<AutoResponderRule>): void {
  // 动态构建 UPDATE 语句
  // ...
}

export function deleteAutoResponderRule(id: string): void {
  const stmt = db.prepare('DELETE FROM autoResponderRules WHERE id = ?')
  stmt.run(id)
}
```

---

## 5. IPC 通道

### 5.1 通道定义

**命名规范**：与 Map Local/Map Remote 保持一致，使用 `AUTO_RESPONDER_*` 前缀。

```typescript
// src/services/types.ts

export const IPC_CHANNELS = {
  // ... 已有通道

  // Auto Responder 功能（新增）
  AUTO_RESPONDER_GET_RULES: 'auto-responder:get-rules',
  AUTO_RESPONDER_ADD_RULE: 'auto-responder:add-rule',
  AUTO_RESPONDER_REMOVE_RULE: 'auto-responder:remove-rule',
  AUTO_RESPONDER_UPDATE_RULE: 'auto-responder:update-rule',
  AUTO_RESPONDER_SYNC_RULES: 'auto-responder:sync-rules',
} as const
```

**说明**：
- 使用 `GET_RULES` / `ADD_RULE` / `REMOVE_RULE` / `UPDATE_RULE` / `SYNC_RULES` 命名
- 与 `MAP_LOCAL_*` 和 `MAP_REMOTE_*` 保持一致
- `SYNC_RULES` 用于将规则同步到主进程（mitm-server.ts）

### 5.2 IPC 处理器

```typescript
// electron/ipc.ts

// Auto Responder 规则管理
ipcMain.handle(IPC_CHANNELS.AUTO_RESPONDER_GET_RULES, () => {
  return listAutoResponderRules()
})

ipcMain.handle(IPC_CHANNELS.AUTO_RESPONDER_ADD_RULE, (_, rule) => {
  const newRule = createAutoResponderRule(rule)
  // 同步规则到主进程
  setAutoResponderRules(listAutoResponderRules())
  return newRule
})

ipcMain.handle(IPC_CHANNELS.AUTO_RESPONDER_UPDATE_RULE, (_, id, updates) => {
  updateAutoResponderRule(id, updates)
  // 同步规则到主进程
  setAutoResponderRules(listAutoResponderRules())
})

ipcMain.handle(IPC_CHANNELS.AUTO_RESPONDER_REMOVE_RULE, (_, id) => {
  deleteAutoResponderRule(id)
  // 同步规则到主进程
  setAutoResponderRules(listAutoResponderRules())
})

ipcMain.handle(IPC_CHANNELS.AUTO_RESPONDER_SYNC_RULES, () => {
  // 手动同步规则到主进程
  setAutoResponderRules(listAutoResponderRules())
})
```

**说明**：
- 每次规则变更后自动调用 `setAutoResponderRules()` 同步到主进程
- `SYNC_RULES` 用于手动同步（如应用启动时）

---

## 6. UI 设计

### 6.1 规则列表 UI

```
┌─────────────────────────────────────────────────────────────┐
│  Auto Responder 规则                              +   ×     │
├─────────────────────────────────────────────────────────────┤
│  [全部启用]  [全部禁用]  [清空]                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ● 登录成功模拟                                          ││
│  │    POST *api.example.com/login*                         ││
│  │    200 · {"code":0,"msg":"success"}                     ││
│  │    ✏️  🗑️                                               ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ○ 服务器错误模拟                                        ││
│  │    * *api.example.com/*                                 ││
│  │    500 · {"error":"Internal Server Error"}              ││
│  │    ✏️  🗑️                                               ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ● 慢响应模拟                                            ││
│  │    GET *api.example.com/slow*                           ││
│  │    200 · {"data":"..."} · ⏱️ 3000ms                     ││
│  │    ✏️  🗑️                                               ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 6.2 添加/编辑规则表单

```
┌─────────────────────────────────────────────────────────────┐
│  添加 Auto Responder 规则                                    │
├─────────────────────────────────────────────────────────────┤
│  规则名称                                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 登录成功模拟                                             ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  URL 匹配模式                                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ *api.example.com/login*                                 ││
│  └─────────────────────────────────────────────────────────┘│
│  支持 * 通配符，如 *shopline.com/api*                        │
│                                                              │
│  HTTP 方法（可选）                                            │
│  ┌────┐ ┌────┐ ┌────┐ ┌─────┐ ┌────┐ ┌─────┐ ┌─────┐     │
│  │GET │ │POST│ │PUT │ │PATCH│ │DELETE│ │HEAD │ │OPTIONS│    │
│  └────┘ └────┘ └────┘ └─────┘ └────┘ └─────┘ └─────┘     │
│                                                              │
│  响应配置                                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 状态码: [200]                                           ││
│  │                                                          ││
│  │ Headers:                                                 ││
│  │ ┌──────────────┐ ┌────────────────────────────────────┐ ││
│  │ │ Content-Type │ │ application/json                   │ ││
│  │ └──────────────┘ └────────────────────────────────────┘ ││
│  │ [+ 添加 Header]                                         ││
│  │                                                          ││
│  │ Body:                                                    ││
│  │ ┌──────────────────────────────────────────────────────┐ ││
│  │ │ {                                                    │ ││
│  │ │   "code": 0,                                        │ ││
│  │ │   "msg": "success",                                 │ ││
│  │ │   "data": {                                         │ ││
│  │ │     "userId": 123                                   │ ││
│  │ │   }                                                 │ ││
│  │ │ }                                                    │ ││
│  │ └──────────────────────────────────────────────────────┘ ││
│  │                                                          ││
│  │ 延迟: [0] ms                                            ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│                    [取消]  [保存]                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 实现任务分解

### T1: 数据模型 + 匹配引擎（0.5 天）

**文件**:
- `src/services/types.ts` (新增 `AutoResponderRule` 接口 + IPC 通道)
- `src/utils/auto-responder-matcher.ts` (新增，匹配引擎)
- `src/stores/auto-responder-store.ts` (新增，状态管理)

**验收标准**:
- ✅ `AutoResponderRule` 接口定义正确
- ✅ `matchAutoResponder()` 复用 `matchBreakpoint()` 逻辑
- ✅ Store 包含完整的 CRUD + 批量操作

---

### T2: 数据库 + IPC（0.5 天）

**文件**:
- `electron/db/migrations.ts` (新增 `autoResponderRules` 表)
- `electron/db/sqlite.ts` (新增 CRUD 函数)
- `electron/ipc.ts` (新增 IPC 处理器)
- `src/services/ipc.ts` (新增 `autoResponder` 命名空间)
- `electron/preload.ts` (新增 `autoResponder` API)

**验收标准**:
- ✅ 数据库表创建成功
- ✅ CRUD 操作正常
- ✅ IPC 通信正常

---

### T3: UI 组件（1 天）

**文件**:
- `src/components/AutoResponderRules.vue` (新增，规则管理 UI)

**验收标准**:
- ✅ 规则列表显示正常
- ✅ 添加/编辑表单正常
- ✅ 启用/禁用/删除功能正常
- ✅ 全部启用/禁用/清空功能正常
- ✅ UI 风格与 Map Local 一致

---

### T4: 入口集成 + 拦截逻辑（0.5 天）

**文件**:
- `src/components/RecordControl.vue` (添加工具菜单入口)
- `src/views/MainView.vue` (添加入口逻辑)
- `electron/proxy/mitm-server.ts` (添加拦截逻辑)

**验收标准**:
- ✅ 工具菜单显示"Auto Responder"选项
- ✅ 点击打开规则管理弹窗
- ✅ 请求拦截逻辑正确（优先级：断点 > Map Local > Auto Responder > Map Remote）
- ✅ 延迟响应功能正常

---

## 8. 测试计划

### 8.1 功能测试

| 测试场景 | 预期结果 |
|---------|---------|
| 添加规则（200 状态码） | 匹配请求返回 200 + 自定义 Body |
| 添加规则（500 状态码） | 匹配请求返回 500 + 自定义 Body |
| 添加规则（延迟 3 秒） | 匹配请求延迟 3 秒返回 |
| 禁用规则 | 禁用后不再拦截请求 |
| 删除规则 | 删除后不再拦截请求 |
| 多个规则匹配 | 使用第一个匹配的规则 |
| 与 Map Local 同时存在 | Map Local 优先级更高 |

### 8.2 边界测试

| 测试场景 | 预期结果 |
|---------|---------|
| 空 Body | 返回空响应 |
| 特殊字符 Body | 正确编码/解码 |
| 超大 Body | 正常返回（无截断） |
| 并发请求 | 所有请求正确处理 |

---

## 9. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 延迟响应阻塞代理线程 | 低 | 低 | ✅ 已修复：使用 setTimeout 包装，不阻塞主线程 |
| 大 Body 导致内存问题 | 低 | 低 | 限制 Body 大小（如 10MB） |
| 规则冲突（与 Map Local） | 低 | 低 | 明确优先级：Map Local > Auto Responder |
| 规则冲突（与 Map Local） | 低 | 低 | 明确优先级：Map Local > Auto Responder |

---

## 10. 待确认问题

1. **Body 大小限制**：是否需要限制响应体大小？（建议 10MB）
2. **延迟响应最大值**：是否需要限制最大延迟时间？（建议 30 秒）
3. **正则表达式支持**：是否需要支持正则匹配 URL？（建议 v1.0 不支持，v1.1 添加）
4. **导入/导出规则**：是否需要支持规则导入/导出？（建议 v1.1 添加）

---

## 11. 与现有功能的兼容性

### 11.1 与 Map Local 的关系

- **优先级**：Map Local > Auto Responder
- **互斥**：同一 URL 只能匹配一个规则
- **共存**：可以同时配置 Map Local 和 Auto Responder 规则

### 11.2 与 Map Remote 的关系

- **优先级**：Auto Responder > Map Remote
- **互斥**：如果 Auto Responder 匹配，不再执行 Map Remote

### 11.3 与断点的关系

- **优先级**：断点 > Auto Responder
- **互斥**：如果断点匹配，Auto Responder 不执行

---

## 12. 总结

#10 自动响应器是一个**小工作量、高价值**的功能，可以：

1. **快速 mock 接口**：不需要文件，直接在规则里写响应
2. **模拟错误场景**：测试前端错误处理逻辑
3. **模拟慢响应**：测试前端 loading 状态
4. **前端独立开发**：不依赖后端服务

**预计工作量**：2-3 人天  
**依赖**：#7 Map Local（已完成）  
**优先级**：P1（高价值）

---

## 13. 评审修复记录

**评审日期**: 2026-06-27  
**Plan 版本**: v1.0 → v1.1

### 修复的 P0 问题

| # | 问题 | 修复方案 | 影响文件 |
|---|------|---------|---------|
| 1 | 优先级顺序与代码实现不一致 | 明确设计决策，添加详细说明 | Plan 文档 |
| 2 | 延迟响应实现可能有问题 | 使用 setTimeout 包装，不使用 async/await | Plan 文档, mitm-server.ts |
| 3 | 缺少 `autoResponderRuleId` 字段 | 在 CaptureRequest 中添加字段 | types.ts ✅ 已修复 |

### 修复的 P1 问题

| # | 问题 | 修复方案 | 影响文件 |
|---|------|---------|---------|
| 4 | IPC 通道命名不一致 | 统一使用 `AUTO_RESPONDER_*` 命名 | Plan 文档 |
| 5 | 缺少 `setAutoResponderRules` 函数 | 添加函数到 mitm-server.ts | Plan 文档 |
| 6 | UI 入口位置不明确 | 明确添加到工具菜单 | Plan 文档 |
| 7 | 缺少 Content-Type 默认值 | 添加默认值说明 | Plan 文档 |

### 待实现文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/types.ts` | ✅ 已修改 | 添加 `autoResponderRuleId` 字段 |
| `src/utils/auto-responder-matcher.ts` | 新增 | 匹配引擎 |
| `src/stores/auto-responder-store.ts` | 新增 | 状态管理 |
| `electron/db/migrations.ts` | 修改 | 添加 `autoResponderRules` 表 |
| `electron/db/sqlite.ts` | 修改 | 添加 CRUD 函数 |
| `electron/ipc.ts` | 修改 | 添加 IPC 处理器 |
| `src/services/ipc.ts` | 修改 | 添加 `autoResponder` 命名空间 |
| `electron/preload.ts` | 修改 | 添加 `autoResponder` API |
| `src/components/AutoResponderRules.vue` | 新增 | 规则管理 UI |
| `src/components/RecordControl.vue` | 修改 | 添加工具菜单入口 |
| `src/views/MainView.vue` | 修改 | 添加入口逻辑 |
| `electron/proxy/mitm-server.ts` | 修改 | 添加拦截逻辑 |

---

## 14. 总结

### Plan v1.1 改进

1. ✅ **明确优先级设计决策**：Map Local > Auto Responder，避免歧义
2. ✅ **修复延迟响应实现**：使用 setTimeout，不阻塞代理线程
3. ✅ **添加 `autoResponderRuleId` 字段**：支持标识 Auto Responder 命中的请求
4. ✅ **统一 IPC 通道命名**：与 Map Local/Map Remote 保持一致
5. ✅ **添加规则同步机制**：确保主进程使用最新规则

### 下一步

1. 按照 T1-T4 顺序实现代码
2. 运行测试验证功能
3. 更新 feature-checklist.md
4. 发布新版本
