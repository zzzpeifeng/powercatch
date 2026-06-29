# #17 Cookie 管理器 - 技术方案

> **状态**: Plan v1.1（评审修复版）  
> **工作量评估**: 中小（约 2-3 人天）  
> **依赖**: 无  
> **优先级**: P1（中价值 - 提升效率）  
> **评审日期**: 2026-06-27  
> **修复问题**: 1 个 P0 问题

---

## 1. 功能概述

### 1.1 核心能力

**Cookie 管理器**允许用户查看、编辑、删除请求中的 Cookie，并支持 Cookie Jar 导入导出。

### 1.2 典型使用场景

1. **查看 Cookie**
   - 查看某个域名下的所有 Cookie
   - 查看 Cookie 的过期时间、路径、HttpOnly 等属性

2. **编辑 Cookie**
   - 修改 Cookie 的值
   - 修改 Cookie 的过期时间
   - 添加新的 Cookie

3. **删除 Cookie**
   - 删除单个 Cookie
   - 清空某个域名下的所有 Cookie

4. **Cookie Jar 导入导出**
   - 导出 Cookie 为 JSON 文件
   - 从 JSON 文件导入 Cookie
   - 从浏览器导出的 Cookie 文件导入

---

## 2. 数据模型

### 2.1 Cookie 接口

```typescript
// src/services/types.ts

export interface Cookie {
  /** Cookie 名称 */
  name: string
  /** Cookie 值 */
  value: string
  /** 所属域名 */
  domain: string
  /** 路径 */
  path: string
  /** 过期时间（ISO 8601 字符串，空表示会话 Cookie） */
  expires?: string
  /** 是否 HttpOnly */
  httpOnly: boolean
  /** 是否 Secure */
  secure: boolean
  /** SameSite 属性 */
  sameSite?: 'Strict' | 'Lax' | 'None'
  /** 创建时间 */
  createdAt: string
}

export interface CookieJar {
  /** Cookie 列表 */
  cookies: Cookie[]
  /** 导出时间 */
  exportedAt: string
  /** 来源 */
  source: string
}
```

### 2.2 CaptureRequest 中的 Cookie

```typescript
// 现有的 CaptureRequest 已经包含 requestHeaders 和 responseHeaders
// Cookie 存储在 requestHeaders.cookie 中
// Set-Cookie 存储在 responseHeaders['set-cookie'] 中
```

---

## 3. 技术方案

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Cookie 管理器架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ CookieManager│      │ cookie-      │      │ mitm-server│ │
│  │   .vue       │ ───► │ parser.ts    │ ───► │    .ts     │ │
│  │    (UI)      │      │  (解析器)     │      │  (拦截器)   │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│         │                      │                     │       │
│         ▼                      ▼                     ▼       │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ cookie-      │      │   Pinia      │      │   SQLite   │ │
│  │ store.ts     │      │   Store      │      │   (持久化)  │ │
│  │  (状态管理)   │      │              │      │            │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Cookie 解析器

**文件**: `src/utils/cookie-parser.ts`

```typescript
/**
 * Cookie 解析工具
 * 从请求/响应头中解析 Cookie
 */

/**
 * 从请求头中解析 Cookie
 * @param cookieHeader Cookie 请求头的值
 * @param domain 请求域名
 * @returns Cookie 数组
 */
export function parseCookieHeader(cookieHeader: string, domain: string): Cookie[] {
  if (!cookieHeader) return []
  
  return cookieHeader.split(';').map(pair => {
    const [name, ...rest] = pair.trim().split('=')
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain,
      path: '/',
      httpOnly: false,
      secure: false,
      createdAt: new Date().toISOString(),
    }
  })
}

/**
 * 从响应头中解析 Set-Cookie
 * @param setCookieHeader Set-Cookie 响应头的值（可能是数组）
 * @param domain 响应域名
 * @returns Cookie 数组
 */
export function parseSetCookieHeader(setCookieHeader: string | string[], domain: string): Cookie[] {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  
  return headers.map(header => {
    const parts = header.split(';').map(p => p.trim())
    const [nameValue, ...attributes] = parts
    const [name, ...rest] = nameValue.split('=')
    
    const cookie: Cookie = {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain,
      path: '/',
      httpOnly: false,
      secure: false,
      createdAt: new Date().toISOString(),
    }
    
    // 解析属性
    for (const attr of attributes) {
      const [key, val] = attr.split('=').map(s => s.trim().toLowerCase())
      switch (key) {
        case 'domain':
          cookie.domain = val || domain
          break
        case 'path':
          cookie.path = val || '/'
          break
        case 'expires':
          cookie.expires = val
          break
        case 'httponly':
          cookie.httpOnly = true
          break
        case 'secure':
          cookie.secure = true
          break
        case 'samesite':
          cookie.sameSite = val as any
          break
      }
    }
    
    return cookie
  })
}

/**
 * 将 Cookie 数组转换为 Cookie 请求头
 * @param cookies Cookie 数组
 * @returns Cookie 请求头的值
 */
export function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

/**
 * 合并 Cookie（新的覆盖旧的）
 * @param existing 现有 Cookie 列表
 * @param newCookies 新 Cookie 列表
 * @returns 合并后的 Cookie 列表
 */
export function mergeCookies(existing: Cookie[], newCookies: Cookie[]): Cookie[] {
  const map = new Map<string, Cookie>()
  
  for (const cookie of existing) {
    const key = `${cookie.domain}:${cookie.path}:${cookie.name}`
    map.set(key, cookie)
  }
  
  for (const cookie of newCookies) {
    const key = `${cookie.domain}:${cookie.path}:${cookie.name}`
    map.set(key, cookie)
  }
  
  return Array.from(map.values())
}
```

### 3.3 状态管理

**文件**: `src/stores/cookie-store.ts`

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Cookie, CookieJar } from '../services/types'
import { ipc } from '../services/ipc'

export const useCookieStore = defineStore('cookie', () => {
  // State
  const cookies = ref<Cookie[]>([])
  const loaded = ref<boolean>(false)
  const selectedDomain = ref<string | null>(null)

  // Getters
  const domains = computed(() => {
    const domainSet = new Set(cookies.value.map(c => c.domain))
    return Array.from(domainSet).sort()
  })

  const filteredCookies = computed(() => {
    if (!selectedDomain.value) return cookies.value
    return cookies.value.filter(c => c.domain === selectedDomain.value)
  })

  const cookieCount = computed(() => cookies.value.length)

  // Actions
  async function loadCookies(): Promise<void> {
    if (loaded.value) return
    cookies.value = await ipc.cookie.getAll()
    loaded.value = true
  }

  async function addCookie(cookie: Cookie): Promise<void> {
    await ipc.cookie.add(cookie)
    cookies.value.push(cookie)
  }

  async function updateCookie(domain: string, name: string, updates: Partial<Cookie>): Promise<void> {
    await ipc.cookie.update(domain, name, updates)
    const index = cookies.value.findIndex(c => c.domain === domain && c.name === name)
    if (index !== -1) {
      cookies.value[index] = { ...cookies.value[index], ...updates }
    }
  }

  async function deleteCookie(domain: string, name: string): Promise<void> {
    await ipc.cookie.delete(domain, name)
    cookies.value = cookies.value.filter(c => !(c.domain === domain && c.name === name))
  }

  async function clearDomain(domain: string): Promise<void> {
    await ipc.cookie.clearDomain(domain)
    cookies.value = cookies.value.filter(c => c.domain !== domain)
  }

  async function clearAll(): Promise<void> {
    await ipc.cookie.clearAll()
    cookies.value = []
  }

  async function exportJar(): Promise<CookieJar> {
    const jar: CookieJar = {
      cookies: cookies.value,
      exportedAt: new Date().toISOString(),
      source: 'PowerCatch',
    }
    return jar
  }

  async function importJar(jar: CookieJar): Promise<void> {
    await ipc.cookie.importJar(jar)
    cookies.value = mergeCookies(cookies.value, jar.cookies)
  }

  function selectDomain(domain: string | null): void {
    selectedDomain.value = domain
  }

  return {
    cookies, loaded, selectedDomain,
    domains, filteredCookies, cookieCount,
    loadCookies, addCookie, updateCookie, deleteCookie,
    clearDomain, clearAll, exportJar, importJar, selectDomain,
  }
})
```

### 3.4 UI 组件

**文件**: `src/components/CookieManager.vue`

参考 `AutoResponderRules.vue` 的设计，主要功能：

1. **左侧域名列表**
   - 显示所有域名
   - 点击域名过滤 Cookie
   - 显示每个域名的 Cookie 数量

2. **右侧 Cookie 列表**
   - 显示 Cookie 的名称、值、过期时间、属性
   - 支持编辑、删除单个 Cookie
   - 支持添加新 Cookie

3. **工具栏**
   - 导入 Cookie Jar
   - 导出 Cookie Jar
   - 清空当前域名 Cookie
   - 清空所有 Cookie

### 3.5 代理层集成

**文件**: `electron/proxy/mitm-server.ts`

**请求拦截 - Cookie 注入**：

```typescript
// 在 proxy.onRequest 中
const matchingCookies = cookieStore.filter(c => {
  // 域名匹配（支持 .example.com 匹配 example.com）
  const domainMatch = c.domain === host || 
    (c.domain.startsWith('.') && host.endsWith(c.domain))
  // 路径匹配
  const pathMatch = path.startsWith(c.path)
  // 过期时间检查
  const notExpired = !c.expires || new Date(c.expires) > new Date()
  
  return domainMatch && pathMatch && notExpired
})

if (matchingCookies.length > 0) {
  const existingCookie = ctx.proxyToServerRequestOptions.headers?.cookie || ''
  const newCookie = cookiesToHeader(matchingCookies)
  
  // 合并 Cookie（Store 的优先）
  ctx.proxyToServerRequestOptions.headers = {
    ...ctx.proxyToServerRequestOptions.headers,
    cookie: newCookie + (existingCookie ? '; ' + existingCookie : ''),
  }
}
```

**响应拦截 - Set-Cookie 提取**：

```typescript
// 在 proxy.onResponse 中
const setCookie = ctx.serverToProxyResponse?.headers?.['set-cookie']
if (setCookie) {
  const newCookies = parseSetCookieHeader(setCookie, host)
  // 更新 Cookie Store
  for (const cookie of newCookies) {
    await cookieStore.add(cookie)
  }
}
```

**⚠️ 关键设计决策**：
- 请求头修改使用 `ctx.proxyToServerRequestOptions.headers`（不是 `ctx.clientToProxyRequest.headers`）
- Cookie 注入在 `proxy.onRequest` 中 `callback()` 之前执行
- Set-Cookie 提取在 `proxy.onResponse` 中 `callback()` 之前执行
- Cookie 合并策略：Store 优先级高于请求头

---

## 4. IPC 通道

### 4.1 通道定义

```typescript
// src/services/types.ts

export const IPC_CHANNELS = {
  // ... 已有通道

  // Cookie 管理
  COOKIE_GET_ALL: 'cookie:get-all',
  COOKIE_ADD: 'cookie:add',
  COOKIE_UPDATE: 'cookie:update',
  COOKIE_DELETE: 'cookie:delete',
  COOKIE_CLEAR_DOMAIN: 'cookie:clear-domain',
  COOKIE_CLEAR_ALL: 'cookie:clear-all',
  COOKIE_IMPORT_JAR: 'cookie:import-jar',
  COOKIE_EXPORT_JAR: 'cookie:export-jar',
} as const
```

---

## 5. 数据库设计

### 5.1 cookies 表

```sql
CREATE TABLE IF NOT EXISTS cookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  domain TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '/',
  expires TEXT,
  http_only INTEGER NOT NULL DEFAULT 0,
  secure INTEGER NOT NULL DEFAULT 0,
  same_site TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain, path, name)
);

-- 索引：加速域名查询
CREATE INDEX IF NOT EXISTS idx_cookies_domain ON cookies(domain);

-- 索引：加速过期时间查询
CREATE INDEX IF NOT EXISTS idx_cookies_expires ON cookies(expires);
```

### 5.2 过期清理

```typescript
// 定期清理过期 Cookie（每天执行一次）
export function cleanExpiredCookies(): void {
  const stmt = db.prepare('DELETE FROM cookies WHERE expires IS NOT NULL AND expires < datetime("now")')
  stmt.run()
}
```

---

## 6. 实现任务分解

### T1: 数据模型 + 解析器 + Store（0.5 天）

**文件**:
- `src/services/types.ts` (新增 Cookie/CookieJar 接口 + IPC 通道)
- `src/utils/cookie-parser.ts` (新增，Cookie 解析工具)
- `src/stores/cookie-store.ts` (新增，状态管理)

**验收标准**:
- ✅ Cookie/CookieJar 接口定义正确
- ✅ Cookie 解析器功能完整
- ✅ Store 包含完整的 CRUD + 批量操作

---

### T2: 数据库 + IPC（0.5 天）

**文件**:
- `electron/db/migrations.ts` (新增 cookies 表)
- `electron/db/sqlite.ts` (新增 CRUD 函数)
- `electron/ipc.ts` (新增 IPC 处理器)
- `src/services/ipc.ts` (新增 cookie 命名空间)
- `electron/preload.ts` (新增 cookie API)

**验收标准**:
- ✅ 数据库表创建成功
- ✅ CRUD 操作正常
- ✅ IPC 通信正常

---

### T3: UI 组件（1 天）

**文件**:
- `src/components/CookieManager.vue` (新增，Cookie 管理 UI)

**验收标准**:
- ✅ 域名列表显示正常
- ✅ Cookie 列表显示正常
- ✅ 编辑/删除/添加功能正常
- ✅ 导入/导出功能正常
- ✅ UI 风格与现有组件一致

---

### T4: 入口集成 + 代理层集成（0.5 天）

**文件**:
- `src/components/RecordControl.vue` (添加工具菜单入口)
- `src/views/MainView.vue` (添加入口逻辑)
- `electron/proxy/mitm-server.ts` (添加 Cookie 注入/提取逻辑)

**验收标准**:
- ✅ 工具菜单显示"Cookie 管理器"选项
- ✅ 点击打开 Cookie 管理弹窗
- ✅ 代理层自动注入 Cookie
- ✅ 代理层自动提取 Set-Cookie

---

## 6. 测试计划

### 6.1 功能测试

| 测试场景 | 预期结果 |
|---------|---------|
| 查看 Cookie | 正确显示域名和 Cookie 列表 |
| 编辑 Cookie | 修改后生效 |
| 删除 Cookie | 删除后不再显示 |
| 导入 Cookie Jar | 导入成功，Cookie 生效 |
| 导出 Cookie Jar | 导出文件格式正确 |
| 代理注入 Cookie | 请求包含 Store 中的 Cookie |
| 代理提取 Set-Cookie | 响应的 Set-Cookie 存入 Store |

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Cookie 解析错误 | 中 | 低 | 使用成熟的解析逻辑，边界测试 |
| Cookie 冲突 | 低 | 低 | Store 优先级高于请求头 |
| 性能影响 | 低 | 低 | Cookie 数量有限 |

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Cookie 解析错误 | 中 | 低 | 使用成熟的解析逻辑，边界测试 |
| Cookie 冲突 | 低 | 低 | Store 优先级高于请求头，明确合并策略 |
| 性能影响 | 低 | 低 | Cookie 数量有限，使用索引加速查询 |
| Cookie 过期 | 低 | 低 | 定期清理过期 Cookie |

---

## 9. 评审修复记录

**评审日期**: 2026-06-27  
**Plan 版本**: v1.0 → v1.1

### 修复的 P0 问题

| # | 问题 | 修复方案 | 影响文件 |
|---|------|---------|---------|
| 1 | 代理层 Cookie 注入逻辑不完整 | 添加具体的实现代码，使用 `ctx.proxyToServerRequestOptions.headers` | Plan 文档 |

### 修复的 P1 问题

| # | 问题 | 修复方案 | 影响文件 |
|---|------|---------|---------|
| 2 | 缺少数据库表设计 | 添加 cookies 表 schema 和索引 | Plan 文档 |
| 3 | 缺少 Cookie 合并策略 | 明确 Store 优先级高于请求头 | Plan 文档 |
| 4 | 缺少 Cookie 过期清理 | 添加定期清理逻辑 | Plan 文档 |

### 优化建议

1. **简化功能范围**：v1.0 只实现查看和删除，编辑和导入导出放在 v1.1
2. **使用内存存储**：v1.0 不持久化到数据库，只在会话期间有效
3. **复用现有 UI**：参考 AutoResponderRules.vue 的布局，减少开发时间

---

## 10. 总结

#17 Cookie 管理器是一个**中小工作量、中价值**的功能，可以：

1. **查看 Cookie**：按域名分组显示
2. **编辑 Cookie**：修改值、过期时间等属性
3. **删除 Cookie**：单个或批量删除
4. **导入导出**：Cookie Jar JSON 格式
5. **代理集成**：自动注入/提取 Cookie

**预计工作量**：2-3 人天  
**依赖**：无  
**优先级**：P1（中价值 - 提升效率）
