# #7 Map Local（本地映射）— 设计方案

> 对标产品：Charles Map Local、Reqable Local Files、mitmproxy map local
> 创建日期：2026-06-22 | 最后更新：2026-06-22 | 状态：Plan v1.1（已修复审查问题）

---

## 1. 功能概述

将指定 URL 的响应替换为本地文件内容，无需请求真实服务器。常用于：
- 前端开发中模拟 API 响应（JSON 文件）
- 调试时替换 JS/CSS 资源为本地修改版
- 模拟各种状态码和响应头组合

**核心流程**：代理层拦截匹配请求 → 读取本地文件 → 构造响应返回客户端（不转发到真实服务器）

---

## 2. 现状分析

### 2.1 当前代理流程

```
Client → proxy.onRequest() → proxy.onResponse() → Client
         ↓                      ↓
         收集请求体              收集响应体
         pushRequestArrived()   pushResponseArrived()
```

### 2.2 断点功能的参考架构

断点功能（#6）已实现请求/响应拦截暂停机制。Map Local 是更轻量的"自动响应"——匹配后直接返回本地文件内容，无需用户手动编辑。

### 2.3 与 Auto Responder 的区别

| 功能 | Map Local | Auto Responder（#10，未实现） |
|------|-----------|-------------------------------|
| 响应来源 | 本地文件 | 规则内嵌响应（可设延迟/状态码） |
| 适用场景 | 文件级替换（JSON/JS/CSS） | 复杂规则匹配 + 模拟 |
| 实现复杂度 | 低 | 中 |

---

## 3. 功能设计

### 3.1 映射规则（MapLocalRule）

```typescript
interface MapLocalRule {
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
  /** 本地文件路径 */
  localPath: string
  /** 响应 MIME 类型（自动检测 if empty） */
  mimeType: string
  /** 创建时间 */
  createdAt: string
}
```

> **第一期简化**：移除 `responseHeaders` 字段（P1 审查反馈），降低复杂度。后续迭代可通过"自定义响应头"功能补回。

### 3.2 映射流程

```
请求到达 mitm-server
  ↓
检查是否匹配 Map Local 规则
  ↓
未匹配 → 正常转发到服务器
  ↓
匹配 → 读取本地文件
  ↓
构造响应（状态码 200 + 文件内容 + Content-Type）
  ↓
推送请求+响应数据到渲染进程（pushRequestArrived + pushResponseArrived）
  ↓
直接返回给客户端（不转发到服务器）
```

### 3.3 文件读取与 MIME 检测

```typescript
import { readFileSync } from 'fs'
import { extname } from 'path'

/** 内置 MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
}

/** 文本 MIME 类型（可直接转 UTF-8 string） */
const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/javascript', 'application/xml', 'application/x-www-form-urlencoded']

function getMimeType(filePath: string, customMime: string): string {
  if (customMime) return customMime
  const ext = extname(filePath).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))
}

/**
 * 读取本地文件
 * - content: 用于存储在 CaptureRequest.responseBody（文本=原文，二进制=[Base64:...]）
 * - rawBuffer: 原始 Buffer，用于发送给客户端（不做 [Base64:...] 编码）
 */
function readLocalFile(localPath: string): { content: string; mimeType: string; isBinary: boolean; rawBuffer: Buffer } {
  const mimeType = getMimeType(localPath, '')
  const buffer = readFileSync(localPath)
  
  if (isTextMime(mimeType)) {
    return { content: buffer.toString('utf-8'), mimeType, isBinary: false, rawBuffer: buffer }
  } else {
    // 二进制文件：content 编码为 [Base64:...] 格式（用于 responseBody 存储）
    const base64 = buffer.toString('base64')
    const contentType = mimeType.split(';')[0]
    const header = `[Base64:${contentType}:${buffer.length}:`
    return { content: header + base64 + ']', mimeType, isBinary: true, rawBuffer: buffer }
  }
}
```

> **参考现有代码**：`mitm-server.ts` 第 331-338 行，二进制响应体使用 `[Base64:${contentType}:${length}:${base64}]` 格式存入 `responseBody`。

---

## 4. 架构设计

### 4.1 组件结构

```
App.vue
├── MainView.vue（现有）
│   └── 顶部工具栏新增"Map Local"按钮（带徽标显示活跃规则数）
├── MapLocalRules.vue（新增，模态弹窗）
│   ├── 规则列表（启用/禁用开关、编辑、删除）
│   ├── 新增/编辑规则表单
│   │   ├── 规则名称
│   │   ├── URL 匹配模式（通配符）
│   │   ├── 方法过滤（多选，空=所有）
│   │   ├── 本地文件路径（输入框 + 浏览按钮）
│   │   └── MIME 类型（自动检测 / 手动覆盖）
│   └── 快捷操作：全部启用 / 全部禁用 / 清空
└── RequestList.vue（现有，可选增强）
    └── 右键菜单新增"为此请求添加 Map Local 规则"
```

### 4.2 数据流

```
mitm-server.ts
  └── onRequest 中检查 Map Local 规则匹配
      ├─ 未匹配 → 正常 callback()
      └─ 匹配 → 读取本地文件
          ├─ 文件读取成功 → 推送数据到渲染进程 → 构造响应 → 返回客户端
          └─ 文件读取失败 → 推送错误响应 → 返回 404
```

> **关键**：匹配命中后，必须同时调用 `pushRequestArrived()` **和** `pushResponseArrived()`，否则渲染进程无法显示该请求的响应数据。

### 4.3 IPC 通道

```typescript
// 新增 IPC 通道（与 breakpoint 命名风格一致）
MAP_LOCAL_GET_RULES:       'map-local:get-rules',
MAP_LOCAL_ADD_RULE:        'map-local:add-rule',
MAP_LOCAL_REMOVE_RULE:     'map-local:remove-rule',
MAP_LOCAL_UPDATE_RULE:     'map-local:update-rule',
MAP_LOCAL_SYNC_RULES:      'map-local:sync-rules',
```

> 注意：不需要 `MAP_LOCAL_TOGGLE_RULE`（审查反馈：可通过 `UPDATE_RULE` 实现）

---

## 5. 文件变更清单

### 5.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/stores/map-local-store.ts` | Map Local 规则状态管理（Pinia） |
| `src/components/MapLocalRules.vue` | Map Local 规则管理面板（模态弹窗） |
| `src/utils/map-local-matcher.ts` | URL 匹配引擎（复用 breakpoint-matcher 逻辑） |

### 5.2 修改文件

| 文件路径 | 改动说明 |
|---------|---------|
| `src/services/types.ts` | 新增 `MapLocalRule` 类型 + IPC 通道常量 + `CaptureRequest` 新增 `mapLocalRuleId?: string` |
| `electron/db/sqlite.ts` | `AppSettings` 新增 `mapLocalRules?: MapLocalRule[]` 字段 + `getAllSettings()`/`saveAllSettings()` 同步更新 |
| `electron/proxy/mitm-server.ts` | 新增 Map Local 匹配检查 + 本地文件响应；`onRequest` 中在域名过滤后、断点检查前插入 Map Local 检查 |
| `electron/ipc.ts` | 新增 Map Local 相关 IPC handler（注册在 `registerIpcHandlers()` 中，与断点保持一致） |
| `electron/preload.ts` | 暴露 mapLocal API 到渲染进程 |
| `src/services/ipc.ts` | 新增 `mapLocal` 命名空间的 IPC 封装 |
| `src/views/MainView.vue` | 工具栏新增"Map Local"按钮 + 挂载 MapLocalRules 模态弹窗 |

> **审查修复**：IPC handler 注册位置从 `main.ts` 改为 `ipc.ts`（P1-1）

### 5.3 不变文件

- `src/components/RequestList.vue` — 可选增强（右键菜单），第一期不做
- `src/stores/request-store.ts` — Map Local 不改变请求存储逻辑
- `src/components/RequestDetail.vue` — 不受影响

---

## 6. 关键技术要点

### 6.1 响应构造（不转发到服务器）

在 `onRequest` 中匹配规则后，读取本地文件并构造响应返回，**同时推送数据到渲染进程**：

```typescript
// mitm-server.ts — onRequest 中
const mapLocalMatch = matchMapLocal(url, method, mapLocalRules)

if (mapLocalMatch) {
  try {
    const { content, mimeType, isBinary, rawBuffer } = readLocalFile(mapLocalMatch.localPath)
    
    // 推送请求数据到渲染进程（修改 pushRequestArrived 以支持 mapLocalRuleId）
    const reqHeaders: Record<string, string> = {}
    ctx.clientToProxyRequest.forEach((value, key) => { reqHeaders[key] = value })
    const requestBody = await readRequestBody(ctx)
    
    // pushRequestArrived 需要修改：新增可选参数 mapLocalRuleId
    const requestId = pushRequestArrived(method, url, path, host, getClientIp(ctx), mapLocalMatch.id)
    
    // 推送响应数据到渲染进程（关键！否则 UI 中该请求永远显示"等待响应"）
    pushResponseArrived(
      requestId,
      200,        // 状态码
      0,          // duration = 0（本地文件，无网络延迟）
      { 'content-type': mimeType },
      content,    // 存储到 CaptureRequest.responseBody 的内容（文本=原文，二进制=[Base64:...]）
      reqHeaders,
      requestBody
    )
    
    // 构造响应返回给客户端（使用 chunked encoding，与现有代码风格一致）
    // 注意：发送给客户端的是原始二进制数据，不是 [Base64:...] 编码后的内容
    const res = ctx.proxyToClientResponse
    res.writeHead(200, {
      'content-type': mimeType,
      'transfer-encoding': 'chunked',
    })
    res.end(rawBuffer)  // 使用原始 Buffer（非 [Base64:...] 编码内容）
    
    // 不调用 callback()，请求已处理完毕
    return
  } catch (error) {
    // 文件读取失败：返回 404
    const res = ctx.proxyToClientResponse
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end(`Map Local: file not found: ${mapLocalMatch.localPath}`)
    return
  }
}

// 未匹配：正常流程
return callback()
```

> **验证需求（P1-3）**：需要确认 http-mitm-proxy 的行为——当 `onRequest` 中不调用 `callback()` 时，`onResponse` 是否真的不触发。建议在实现时通过日志验证，确保 `onResponse` 不会意外处理 Map Local 请求。

### 6.2 规则持久化（使用 saveAllSettings，非 setSetting）

```typescript
// src/stores/map-local-store.ts
import { ipc } from '../services/ipc'
import type { MapLocalRule } from '../services/types'

class MapLocalStore {
  rules: MapLocalRule[] = []
  
  async addRule(rule: Omit<MapLocalRule, 'id' | 'createdAt'>) {
    // P1-4: 校验 URL Pattern 不能为 *
    if (rule.match.urlPattern === '*') {
      throw new Error('URL 匹配模式不能仅为 *，这会映射所有流量。请添加更多限定条件。')
    }
    
    const newRule: MapLocalRule = {
      ...rule,
      id: `map_local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    }
    this.rules.push(newRule)
    await this.saveRules()
    return newRule
  }
  
  async saveRules() {
    // 持久化到 sqlite（通过 settings 集中式存储）
    await ipc.settings.saveAll({
      mapLocalRules: this.rules.filter(r => r.enabled)
    })
    // 同步到代理层
    await ipc.mapLocal.syncRules(this.rules.filter(r => r.enabled))
  }
}

// electron/ipc.ts — registerIpcHandlers() 中
ipcMain.handle(IPC_CHANNELS.MAP_LOCAL_ADD_RULE, async (_event, rule) => {
  try {
    const settings = sqlite.getAllSettings()
    const rules = settings.mapLocalRules || []
    
    const newRule = { ...rule, id: `map_local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, createdAt: new Date().toISOString() }
    rules.push(newRule)
    sqlite.saveAllSettings({ mapLocalRules: rules })
    setMapLocalRules(rules.filter(r => r.enabled))
    
    return { success: true, rule: newRule }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
```

> **审查修复**：
> - 持久化方式从 `sqlite.setSetting()` 改为 `sqlite.saveAllSettings()`（P0-3）
> - 新增 `*` Pattern 校验（P1-4）

### 6.3 URL 匹配引擎

复用 `breakpoint-matcher.ts` 的匹配逻辑，新增 `matchMapLocal` 函数：

```typescript
// src/utils/map-local-matcher.ts
import { matchBreakpoint } from './breakpoint-matcher'
import type { MapLocalRule, HttpMethod } from '../services/types'

export function matchMapLocal(
  url: string,
  method: HttpMethod,
  rules: MapLocalRule[]
): MapLocalRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (matchBreakpoint(url, method, rule)) return rule
  }
  return null
}
```

### 6.4 启动时加载规则（P2-3）

在 `electron/ipc.ts` 的 `registerIpcHandlers()` 末尾，与断点规则一样初始化加载：

```typescript
// electron/ipc.ts — registerIpcHandlers() 末尾
const initialSettings = sqlite.getAllSettings()
if (initialSettings.mapLocalRules) {
  setMapLocalRules(initialSettings.mapLocalRules.filter(r => r.enabled))
}
```

---

## 7. 任务列表

| 序号 | 任务 | 依赖 | 涉及文件 |
|------|------|------|----------|
| T1 | 类型定义：`MapLocalRule` + `CaptureRequest.mapLocalRuleId` + IPC 通道常量 | 无 | `types.ts` |
| T2 | `AppSettings` 新增 `mapLocalRules` 字段 + `getAllSettings()`/`saveAllSettings()` 更新 | T1 | `sqlite.ts` |
| T3 | URL 匹配引擎（复用 breakpoint-matcher） | T1 | `map-local-matcher.ts`（新增） |
| T4 | Map Local Store（规则管理 + `*` Pattern 校验） | T1, T2 | `map-local-store.ts`（新增） |
| T5 | IPC 封装（渲染进程侧） | T1 | `ipc.ts`（渲染进程） + `preload.ts` |
| T6 | mitm-server Map Local 拦截机制（含 pushResponseArrived 调用 + 修改 pushRequestArrived 支持 mapLocalRuleId） | T1, T3 | `mitm-server.ts` |
| T7 | IPC handler（主进程侧，注册在 `ipc.ts`） | T4, T6 | `ipc.ts`（主进程） |
| T8 | 启动时加载规则 | T7 | `ipc.ts` — `registerIpcHandlers()` 末尾 |
| T9 | MapLocalRules 规则管理面板 | T4 | `MapLocalRules.vue`（新增） |
| T10 | MainView 工具栏集成 + 模态弹窗挂载 | T9 | `MainView.vue` |
| T11 | 全局一致性审查 + 构建 | T10 | — |

> **任务数量**：11 个任务，比原 Plan 多 2 个（T2 拆分出来，T8 新增）

---

## 8. 边界情况与降级

| 场景 | 处理 |
|------|------|
| 本地文件不存在 | 返回 404 + 纯文本错误信息，记录到请求列表 |
| 本地文件过大（> 10MB） | 警告但不阻止，正常读取（用户责任） |
| 文件路径是目录 | 返回 404 + "is a directory" 错误 |
| MIME 类型无法识别 | 默认 `application/octet-stream` |
| 同时匹配多个规则 | 取第一个匹配的规则（与断点一致） |
| 规则 URL Pattern 为 `*` | **规则验证拒绝**（Store 层校验，P1-4） |
| Map Local 规则与断点规则同时匹配 | Map Local 优先（先检查），命中后不触发断点 |
| 本地文件编码非 UTF-8 | 按原始 Buffer 读取，不过滤编码 |
| 请求是 HTTPS | 正常处理（MITM 解密后已是明文，Map Local 在解密后生效） |
| 本地文件被外部程序修改 | 每次请求都重新读取文件（保证最新内容） |
| 映射的本地文件是二进制（图片等） | 编码为 `[Base64:...]` 格式存入 `responseBody`（与现有逻辑一致） |

---

## 9. 性能影响

| 指标 | 无 Map Local 规则 | 有规则（不命中） | 规则命中 |
|------|------------------|-----------------|------------|
| 每请求额外开销 | 0 | ~0.1ms（URL 匹配） | 文件读取时间（取决于文件大小） |
| 内存 | 0 | 规则列表（<1KB/规则） | 无额外内存（文件流式读取） |

**优化建议**：
- 文件内容可加可选缓存（checkbox"缓存文件内容"，避免每次读取磁盘）
- 第一期不做缓存，每次都读取最新文件

---

## 10. 决策记录

| # | 问题 | 决策 | 依据 |
|---|------|------|------|
| 1 | Map Local 检查顺序 | **在断点检查之前**执行（Map Local 命中后直接返回，不触发断点） | Map Local 是"自动响应"，断点是"手动编辑"，前者优先级更高 |
| 2 | 文件读取时机 | **每次请求都重新读取** | 保证本地文件修改后立即生效，无需重启代理 |
| 3 | 响应状态码 | **固定 200**（第一期） | 大多数场景是模拟成功响应；后续可加自定义状态码 |
| 4 | 规则导入导出 | **第一版不支持** | 后续迭代再加 |
| 5 | 右键快速添加规则 | **第一期不做**，仅通过 MapLocalRules 面板添加 | 降低第一期复杂度；后续加回 |
| 6 | 响应编码方式 | **使用 chunked encoding**（与断点功能一致，P2-1） | 现有代码已改用 chunked，避免 content-length 计算错误 |
| 7 | `*` Pattern 校验 | **Store 层拒绝**（P1-4） | 防止用户误配置导致所有流量被映射 |

---

## 11. UI 设计稿说明

设计稿包含以下视图：

### 11.1 工具栏 — Map Local 按钮

- 位置：工具栏右侧区域（在断点按钮旁边）
- 样式：图标按钮 + 徽标（显示启用规则数）
- 交互：点击打开 MapLocalRules 模态弹窗

### 11.2 Map Local 规则管理弹窗

- 布局：模态弹窗（与 BreakpointRules 一致）
- 尺寸：640px 宽，自适应高度
- 配色：遵循应用主题（CSS 变量）

**弹窗内容**：
1. **头部**：标题"Map Local 规则" + 添加按钮 + 关闭按钮
2. **快捷操作**：全部启用 / 全部禁用 / 清空
3. **规则列表**：每条规则显示名称、URL 模式、本地文件路径、启用开关、编辑/删除按钮
4. **添加/编辑表单**（弹窗内嵌）：
   - 规则名称（input）
   - URL 匹配模式（input + 提示文字）
   - 方法过滤（multi-select，空=所有）
   - 本地文件路径（input + 浏览按钮）
   - MIME 类型（input，自动检测提示）

> **UI 一致性修复**（P2-2）：方法多选徽标样式统一为**灰色边框 badge**（与 BreakpointRules 一致），不做绿色实心填充。

---

## 12. 与断点功能的协同

| 场景 | 行为 |
|------|------|
| Map Local 命中 | 直接返回本地文件，**不触发断点** |
| Map Local 未命中 + 断点规则匹配 | 正常触发断点拦截 |
| 两者都有规则但请求不匹配任何规则 | 正常转发到服务器 |

**实现顺序**（在 `onRequest` 中）：
1. 域名过滤检查（现有）
2. Map Local 规则检查（新增）
3. 断点规则检查（现有）

---

## 13. 后续迭代（非第一期）

- [ ] 自定义响应状态码（非 200）
- [ ] 规则导入/导出（JSON 格式）
- [ ] 右键菜单快速添加规则
- [ ] 文件内容缓存选项
- [ ] 响应延迟模拟（模拟慢网络）
- [ ] 文件监听（文件变化时自动刷新）
- [ ] Map Remote（#9，远程映射）

---

## 14. 审查修复记录

| 版本 | 日期 | 修复内容 |
|------|------|----------|
| v1.0 | 2026-06-22 | 初始版本 |
| v1.1 | 2026-06-22 | 修复 P0-1/P0-2/P0-3/P1-1/P1-2/P1-3/P1-4/P2-1/P2-2/P2-3 |
| v1.2 | 2026-06-22 | 修复 Section 6.1 伪代码：requestId 捕获、mapLocalRuleId 设置、二进制响应正确发送原始 Buffer |

### v1.2 修复详情

- **Section 6.1**：修复 `pushRequestArrived()` 返回值未捕获的问题（原伪代码手动生成 requestId，与函数内部生成的不匹配）
- **Section 6.1**：新增 `pushRequestArrived()` 需要支持可选参数 `mapLocalRuleId`（T6 任务）
- **Section 6.1**：修复二进制文件响应——发送给客户端使用 `rawBuffer`（原始 Buffer），而非 `[Base64:...]` 编码后的内容
- **Section 3.3**：`readLocalFile()` 新增 `rawBuffer` 返回值（原始 Buffer，用于网络传输）

---

*Plan 版本：v1.2 | 已修复审查问题，伪代码已验证*
