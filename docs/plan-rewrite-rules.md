# #11 请求重写规则（Rewrite Rules）- 技术方案

> **状态**: Plan v1.0  
> **工作量评估**: 中（约 3-4 人天）  
> **依赖**: 无  
> **优先级**: P0（高价值 - Charles 核心能力，最后一个）

---

## 1. 功能概述

### 1.1 核心能力

**请求重写规则**允许用户配置规则，**持久化自动修改**匹配请求的 URL/Header/Body/Status。

与断点的区别：

| 维度 | 断点 (#6) | Rewrite Rules (#11) |
|------|----------|---------------------|
| **执行方式** | 手动干预（挂起等待用户编辑） | 自动执行（无需人工干预） |
| **持久化** | 临时（每次需要手动添加） | 持久化（规则保存后自动生效） |
| **适用场景** | 调试、临时修改 | 生产环境模拟、持续测试 |
| **修改范围** | 请求/响应的任意字段 | 预定义的修改规则 |

### 1.2 典型使用场景

1. **自动添加认证 Header**
   - 规则：匹配 `/api/*`，添加 `Authorization: Bearer xxx`
   - 用途：调试需要认证的接口

2. **自动修改请求参数**
   - 规则：匹配 `/api/search*`，添加查询参数 `debug=true`
   - 用途：开启调试模式

3. **URL 重写**
   - 规则：匹配 `/old-api/*`，重写为 `/new-api/*`
   - 用途：API 迁移测试

4. **响应状态码覆盖**
   - 规则：匹配 `/api/payment*`，覆盖状态码为 500
   - 用途：模拟支付服务故障

5. **响应 Header 修改**
   - 规则：匹配 `*.css`，添加 `Cache-Control: no-cache`
   - 用途：调试缓存问题

---

## 2. 数据模型

### 2.1 RewriteRule 接口

```typescript
// src/services/types.ts

export interface RewriteRule {
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
  /** 重写配置 */
  rewrite: {
    /** URL 重写（可选） */
    url?: {
      /** 路径替换模式（正则表达式） */
      pattern: string
      /** 替换为 */
      replacement: string
    }
    /** 请求头修改（可选） */
    requestHeaders?: {
      /** 添加的请求头 */
      add: Record<string, string>
      /** 删除的请求头 */
      remove: string[]
      /** 修改的请求头（覆盖） */
      modify: Record<string, string>
    }
    /** 响应头修改（可选） */
    responseHeaders?: {
      /** 添加的响应头 */
      add: Record<string, string>
      /** 删除的响应头 */
      remove: string[]
      /** 修改的响应头（覆盖） */
      modify: Record<string, string>
    }
    /** 请求体修改（可选） */
    requestBody?: {
      /** 替换模式（字符串匹配） */
      pattern?: string
      /** 替换为 */
      replacement?: string
      /** 完整替换（忽略 pattern） */
      fullReplace?: string
    }
    /** 响应体修改（可选） */
    responseBody?: {
      /** 替换模式（字符串匹配） */
      pattern?: string
      /** 替换为 */
      replacement?: string
      /** 完整替换（忽略 pattern） */
      fullReplace?: string
    }
    /** 状态码覆盖（可选） */
    statusCode?: number
  }
  /** 创建时间 */
  createdAt: string
}
```

### 2.2 与其他规则的对比

```typescript
// MapLocalRule - 替换整个响应为本地文件
{
  match: { urlPattern, methods }
  localPath: string      // ← 指向本地文件
  mimeType: string
}

// MapRemoteRule - 转发到不同目标
{
  match: { urlPattern, methods }
  target: { protocol, host, port, pathReplacement }
}

// AutoResponderRule - 返回预设响应
{
  match: { urlPattern, methods }
  response: { statusCode, headers, body, delay }
}

// RewriteRule - 修改请求/响应的部分内容（新增）
{
  match: { urlPattern, methods }
  rewrite: {
    url?: { pattern, replacement }
    requestHeaders?: { add, remove, modify }
    responseHeaders?: { add, remove, modify }
    requestBody?: { pattern, replacement, fullReplace }
    responseBody?: { pattern, replacement, fullReplace }
    statusCode?: number
  }
}
```

---

## 3. 技术方案

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    请求重写规则架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ RewriteRules │      │ rewrite-     │      │ mitm-server│ │
│  │   .vue       │ ───► │ matcher.ts   │ ───► │    .ts     │ │
│  │    (UI)      │      │  (匹配引擎)   │      │  (拦截器)   │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│         │                      │                     │       │
│         ▼                      ▼                     ▼       │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ rewrite-     │      │   Pinia      │      │   SQLite   │ │
│  │ rules-store  │      │   Store      │      │   (持久化)  │ │
│  │  (状态管理)   │      │              │      │            │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 匹配引擎

**文件**: `src/utils/rewrite-matcher.ts`

```typescript
/**
 * 请求重写规则 URL 匹配引擎
 * 复用 breakpoint-matcher 的匹配逻辑
 */
import { matchBreakpoint } from './breakpoint-matcher'
import type { RewriteRule, HttpMethod } from '../services/types'

/**
 * 在多个重写规则中查找所有匹配的规则
 * @param url 请求 URL
 * @param method 请求方法
 * @param rules 重写规则列表
 * @returns 匹配的规则数组（可能多个规则同时生效）
 */
export function matchRewriteRules(
  url: string,
  method: HttpMethod,
  rules: RewriteRule[]
): RewriteRule[] {
  const matched: RewriteRule[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchBreakpoint(url, method, rule as any)) {
      matched.push(rule)
    }
  }
  return matched
}
```

**设计决策**：与 MapLocal/MapRemote/AutoResponder 不同，Rewrite Rules 支持**多个规则同时生效**（first-match 不适用）。

### 3.3 主进程拦截逻辑

**文件**: `electron/proxy/mitm-server.ts`

**优先级顺序**：

```
1. Map Local       (最高优先级，完全短路)
2. Auto Responder  (次高优先级，完全短路)
3. Map Remote      (第三优先级，修改目标后继续)
4. Rewrite Rules   (第四优先级，修改请求/响应后继续) ← 新增
5. Breakpoint      (最低优先级，挂起等待用户)
```

**实现代码**：

```typescript
// 在 Map Remote 之后，Breakpoint 之前添加

// 4. 检查 Rewrite Rules
const rewriteMatches = matchRewriteRules(url, method, rewriteRules)
if (rewriteMatches.length > 0) {
  // 应用所有匹配的重写规则
  for (const rule of rewriteMatches) {
    const { rewrite } = rule

    // 4.1 URL 重写
    if (rewrite.url) {
      const { pattern, replacement } = rewrite.url
      try {
        const newUrl = ctx.proxyToServerRequestOptions.path.replace(
          new RegExp(pattern), replacement
        )
        ctx.proxyToServerRequestOptions.path = newUrl
      } catch (e) {
        console.error('URL rewrite error:', e)
      }
    }

    // 4.2 请求头修改
    if (rewrite.requestHeaders) {
      const { add, remove, modify } = rewrite.requestHeaders
      // 添加请求头
      for (const [key, value] of Object.entries(add || {})) {
        ctx.clientToProxyRequest.headers[key.toLowerCase()] = value
      }
      // 删除请求头
      for (const key of remove || []) {
        delete ctx.clientToProxyRequest.headers[key.toLowerCase()]
      }
      // 修改请求头
      for (const [key, value] of Object.entries(modify || {})) {
        ctx.clientToProxyRequest.headers[key.toLowerCase()] = value
      }
    }

    // 4.3 请求体修改（需要在 onData 回调中处理）
    if (rewrite.requestBody) {
      ctx._rewriteRequestBody = rewrite.requestBody
    }

    // 4.4 响应头修改（需要在 onResponse 回调中处理）
    if (rewrite.responseHeaders) {
      ctx._rewriteResponseHeaders = rewrite.responseHeaders
    }

    // 4.5 响应体修改（需要在 onResponse 回调中处理）
    if (rewrite.responseBody) {
      ctx._rewriteResponseBody = rewrite.responseBody
    }

    // 4.6 状态码覆盖（需要在 onResponse 回调中处理）
    if (rewrite.statusCode) {
      ctx._rewriteStatusCode = rewrite.statusCode
    }

    // 记录命中的规则 ID
    ctx._rewriteRuleId = rule.id
  }
}

// 继续正常流程（不短路）
callback()
```

### 3.4 状态管理

**文件**: `src/stores/rewrite-rules-store.ts`

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { RewriteRule } from '../services/types'
import { ipc } from '../services/ipc'

const MAX_RULES = 50

export const useRewriteRulesStore = defineStore('rewrite-rules', () => {
  // State
  const rules = ref<RewriteRule[]>([])
  const loaded = ref<boolean>(false)

  // Getters
  const enabledRulesCount = computed(() => rules.value.filter(r => r.enabled).length)

  // Actions
  async function loadRules(): Promise<void> {
    if (loaded.value) return
    const settings = await ipc.settings.getAll()
    rules.value = settings.rewriteRules || []
    loaded.value = true
  }

  async function saveRules(): Promise<void> {
    await ipc.settings.saveAll({ rewriteRules: rules.value })
    await ipc.rewriteRules.syncRules(rules.value)
  }

  async function addRule(rule: Omit<RewriteRule, 'id' | 'createdAt'>): Promise<void> {
    if (rules.value.length >= MAX_RULES) {
      throw new Error(`规则数量已达上限（${MAX_RULES}）`)
    }
    const newRule: RewriteRule = {
      ...rule,
      id: `rewrite_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    }
    rules.value.push(newRule)
    await saveRules()
  }

  async function removeRule(ruleId: string): Promise<void> {
    rules.value = rules.value.filter(r => r.id !== ruleId)
    await saveRules()
  }

  async function updateRule(ruleId: string, updates: Partial<RewriteRule>): Promise<void> {
    const index = rules.value.findIndex(r => r.id === ruleId)
    if (index === -1) return
    rules.value[index] = { ...rules.value[index], ...updates }
    await saveRules()
  }

  async function toggleRule(ruleId: string): Promise<void> {
    const rule = rules.value.find(r => r.id === ruleId)
    if (!rule) return
    rule.enabled = !rule.enabled
    await saveRules()
  }

  async function enableAllRules(): Promise<void> {
    rules.value.forEach(r => r.enabled = true)
    await saveRules()
  }

  async function disableAllRules(): Promise<void> {
    rules.value.forEach(r => r.enabled = false)
    await saveRules()
  }

  async function clearAllRules(): Promise<void> {
    rules.value = []
    await saveRules()
  }

  return {
    rules, loaded, enabledRulesCount,
    loadRules, addRule, removeRule, updateRule, toggleRule,
    enableAllRules, disableAllRules, clearAllRules,
  }
})
```

### 3.5 UI 组件

**文件**: `src/components/RewriteRules.vue`

参考 `AutoResponderRules.vue` 的设计，主要区别：

1. **规则表单**：支持配置多种重写操作
   - URL 重写：pattern + replacement
   - 请求头修改：add/remove/modify 三个编辑器
   - 响应头修改：add/remove/modify 三个编辑器
   - 请求体修改：pattern + replacement 或 fullReplace
   - 响应体修改：pattern + replacement 或 fullReplace
   - 状态码覆盖：数字输入

2. **规则列表**：显示重写摘要
   - URL 重写标记（如果有）
   - Header 修改数量
   - Body 修改标记（如果有）
   - 状态码覆盖标记（如果有）

3. **批量操作**：与 Auto Responder 一致
   - 全部启用/禁用
   - 清空所有规则

---

## 4. 数据库设计

### 4.1 使用 Settings 存储

Rewrite Rules 不需要单独的数据库表，使用现有的 `AppSettings` 存储：

```typescript
// src/services/types.ts

export interface AppSettings {
  // ... 已有字段
  rewriteRules?: RewriteRule[]
}
```

**理由**：
- 与 MapLocal/MapRemote/AutoResponder 保持一致
- 规则数量有限（最多 50 条），不需要单独的表
- 简化实现，复用现有的 settings 持久化机制

---

## 5. IPC 通道

### 5.1 通道定义

```typescript
// src/services/types.ts

export const IPC_CHANNELS = {
  // ... 已有通道

  // Rewrite Rules 功能（新增）
  REWRITE_RULES_GET_RULES: 'rewrite-rules:get-rules',
  REWRITE_RULES_ADD_RULE: 'rewrite-rules:add-rule',
  REWRITE_RULES_REMOVE_RULE: 'rewrite-rules:remove-rule',
  REWRITE_RULES_UPDATE_RULE: 'rewrite-rules:update-rule',
  REWRITE_RULES_SYNC_RULES: 'rewrite-rules:sync-rules',
} as const
```

### 5.2 IPC 处理器

```typescript
// electron/ipc.ts

// Rewrite Rules 规则管理
ipcMain.handle(IPC_CHANNELS.REWRITE_RULES_GET_RULES, () => {
  return listRewriteRules()
})

ipcMain.handle(IPC_CHANNELS.REWRITE_RULES_ADD_RULE, (_, rule) => {
  const newRule = addRewriteRule(rule)
  // 同步规则到主进程
  setRewriteRules(listRewriteRules())
  return newRule
})

ipcMain.handle(IPC_CHANNELS.REWRITE_RULES_UPDATE_RULE, (_, id, updates) => {
  updateRewriteRule(id, updates)
  // 同步规则到主进程
  setRewriteRules(listRewriteRules())
})

ipcMain.handle(IPC_CHANNELS.REWRITE_RULES_REMOVE_RULE, (_, id) => {
  deleteRewriteRule(id)
  // 同步规则到主进程
  setRewriteRules(listRewriteRules())
})

ipcMain.handle(IPC_CHANNELS.REWRITE_RULES_SYNC_RULES, () => {
  // 手动同步规则到主进程
  setRewriteRules(listRewriteRules())
})
```

---

## 6. UI 设计

### 6.1 规则列表 UI

```
┌─────────────────────────────────────────────────────────────┐
│  Rewrite Rules 规则                               +   ×     │
├─────────────────────────────────────────────────────────────┤
│  [全部启用]  [全部禁用]  [清空]                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ● 添加认证 Header                                      ││
│  │    *api.example.com/*                                   ││
│  │    📝 请求头 +1  🗑️                                     ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ○ URL 重写                                             ││
│  │    */old-api/* → */new-api/*                            ││
│  │    🔗 URL 重写  🗑️                                      ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ● 模拟支付故障                                          ││
│  │    *api.payment*                                        ││
│  │    📊 状态码: 500  🗑️                                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 6.2 添加/编辑规则表单

```
┌─────────────────────────────────────────────────────────────┐
│  添加 Rewrite Rule 规则                                      │
├─────────────────────────────────────────────────────────────┤
│  规则名称                                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 添加认证 Header                                         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  URL 匹配模式                                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ *api.example.com/*                                      ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  HTTP 方法（可选）                                            │
│  ┌────┐ ┌────┐ ┌────┐ ┌─────┐ ┌────┐ ┌─────┐ ┌─────┐     │
│  │GET │ │POST│ │PUT │ │PATCH│ │DELETE│ │HEAD │ │OPTIONS│    │
│  └────┘ └────┘ └────┘ └─────┘ └────┘ └─────┘ └─────┘     │
│                                                              │
│  重写配置                                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ ☑ URL 重写                                              ││
│  │   Pattern: [________________]                           ││
│  │   Replacement: [________________]                       ││
│  │                                                          ││
│  │ ☑ 请求头修改                                             ││
│  │   添加:                                                  ││
│  │   ┌──────────────┐ ┌────────────────────────────────┐  ││
│  │   │ Authorization │ │ Bearer xxx                     │  ││
│  │   └──────────────┘ └────────────────────────────────┘  ││
│  │   [+ 添加 Header]                                       ││
│  │                                                          ││
│  │   删除:                                                  ││
│  │   ┌──────────────┐                                     ││
│  │   │ X-Debug      │ [×]                                 ││
│  │   └──────────────┘                                     ││
│  │   [+ 添加 Header]                                       ││
│  │                                                          ││
│  │ ☐ 响应头修改                                             ││
│  │ ☐ 请求体修改                                             ││
│  │ ☐ 响应体修改                                             ││
│  │ ☐ 状态码覆盖                                             ││
│  │   Status: [200]                                         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│                    [取消]  [保存]                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 实现任务分解

### T1: 数据模型 + 匹配引擎（0.5 天）

**文件**:
- `src/services/types.ts` (新增 `RewriteRule` 接口 + IPC 通道)
- `src/utils/rewrite-matcher.ts` (新增，匹配引擎)
- `src/stores/rewrite-rules-store.ts` (新增，状态管理)

**验收标准**:
- ✅ `RewriteRule` 接口定义正确
- ✅ `matchRewriteRules()` 复用 `matchBreakpoint()` 逻辑
- ✅ Store 包含完整的 CRUD + 批量操作

---

### T2: IPC 通道（0.5 天）

**文件**:
- `electron/ipc.ts` (新增 IPC 处理器)
- `src/services/ipc.ts` (新增 `rewriteRules` 命名空间)
- `electron/preload.ts` (新增 `rewriteRules` API)

**验收标准**:
- ✅ IPC 通道定义正确
- ✅ IPC 处理器实现完整
- ✅ Preload API 暴露正确

---

### T3: UI 组件（1.5 天）

**文件**:
- `src/components/RewriteRules.vue` (新增，规则管理 UI)

**验收标准**:
- ✅ 规则列表显示正常
- ✅ 添加/编辑表单功能完整
- ✅ URL 重写配置正常
- ✅ Header 修改配置正常（add/remove/modify）
- ✅ Body 修改配置正常
- ✅ 状态码覆盖配置正常
- ✅ 批量操作功能正常
- ✅ UI 风格与 Auto Responder 一致

---

### T4: 入口集成 + 拦截逻辑（1 天）

**文件**:
- `src/components/RecordControl.vue` (添加工具菜单入口)
- `src/views/MainView.vue` (添加入口逻辑)
- `electron/proxy/mitm-server.ts` (添加拦截逻辑)

**验收标准**:
- ✅ 工具菜单显示"Rewrite Rules"选项
- ✅ 点击打开规则管理弹窗
- ✅ 拦截逻辑正确（优先级：Map Local > Auto Responder > Map Remote > Rewrite Rules > Breakpoint）
- ✅ URL 重写功能正常
- ✅ Header 修改功能正常
- ✅ Body 修改功能正常
- ✅ 状态码覆盖功能正常

---

## 8. 测试计划

### 8.1 功能测试

| 测试场景 | 预期结果 |
|---------|---------|
| URL 重写 | 请求路径按规则重写 |
| 添加请求头 | 请求包含新增的 Header |
| 删除请求头 | 请求不包含删除的 Header |
| 修改请求头 | 请求 Header 值被覆盖 |
| 添加响应头 | 响应包含新增的 Header |
| 删除响应头 | 响应不包含删除的 Header |
| 修改响应头 | 响应 Header 值被覆盖 |
| 状态码覆盖 | 响应状态码被覆盖 |
| 多个规则匹配 | 所有规则按顺序应用 |
| 禁用规则 | 禁用后不再生效 |

### 8.2 边界测试

| 测试场景 | 预期结果 |
|---------|---------|
| 空规则 | 正常请求不被修改 |
| 无效正则 | 跳过该规则，不影响其他规则 |
| 超大 Body | 正常处理（无截断） |
| 并发请求 | 所有请求正确处理 |

---

## 9. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 正则表达式错误 | 中 | 低 | 捕获异常，跳过该规则 |
| 多个规则冲突 | 低 | 低 | 按顺序应用，用户自行调整 |
| 性能影响 | 低 | 低 | 规则数量有限（最多 50） |

---

## 10. 与其他功能的关系

### 10.1 与断点的关系

- **互补**：断点是手动干预，Rewrite Rules 是自动执行
- **优先级**：Rewrite Rules > Breakpoint
- **共存**：可以同时配置

### 10.2 与 Map Local 的关系

- **优先级**：Map Local > Rewrite Rules
- **互斥**：如果 Map Local 匹配，Rewrite Rules 不执行

### 10.3 与 Auto Responder 的关系

- **优先级**：Auto Responder > Rewrite Rules
- **互斥**：如果 Auto Responder 匹配，Rewrite Rules 不执行

### 10.4 与 Map Remote 的关系

- **优先级**：Map Remote > Rewrite Rules
- **顺序**：先执行 Map Remote（修改目标），再执行 Rewrite Rules（修改请求/响应）

---

## 11. 总结

#11 请求重写规则是一个**中工作量、高价值**的功能，可以：

1. **持久化自动修改**：配置一次，永久生效
2. **多维度修改**：URL/Header/Body/Status 全方位覆盖
3. **与现有功能互补**：断点用于调试，Rewrite Rules 用于持续测试

**预计工作量**：3-4 人天  
**依赖**：无  
**优先级**：P0（高价值 - Charles 核心能力，最后一个）
