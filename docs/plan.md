# PowerCatch 左侧栏树状结构改造设计方案

> 参考 Charles 的 Structure 模式，将左侧栏请求列表从 Sequence 平铺列表改造为**按域名分组的树状结构**。

---

## 目录

1. [整体架构说明与数据流设计](#1-整体架构说明与数据流设计)
2. [树状结构的节点模型定义](#2-树状结构的节点模型定义)
3. [UI 线框图 / ASCII 示意图](#3-ui-线框图--ascii-示意图)
4. [与现有请求捕获流程的对接方案](#4-与现有请求捕获流程的对接方案)
5. [关键交互细节](#5-关键交互细节)

---

## 1. 整体架构说明与数据流设计

### 1.1 改造目标

将左侧栏请求列表从单一的 Sequence 平铺模式，扩展为支持两种视图模式：

| 模式 | viewMode 值 | 行为 | 对标 |
|------|------------|------|------|
| **列表模式（现有）** | `'list'` | 所有请求按时间倒序平铺，与现有行为完全一致 | Charles Sequence |
| **分组模式（新增）** | `'group'` | 按 `host`（域名）分组为树状结构，域名节点可展开/折叠 | Charles Structure |

两种模式通过 `RecordControl.vue` 中已有的 `toggle-view` 按钮切换，`viewMode` 状态存储在 `request-store.ts` 的 `viewMode` ref 中（当前已存在但 group 视图未实现）。

### 1.2 核心设计原则：树是扁平数组的派生视图

**关键决策：不改变 Store 的核心数据模型。**

现有 `requests: ref<CaptureRequest[]>` 扁平数组是唯一数据源（Single Source of Truth）。树状结构是通过 **computed 派生** 出来的视图层转换，而非独立的数据结构。

这样做的好处：

1. **零侵入**：`addRequest()` / `updateRequest()` / `flushPending()` / 淘汰逻辑全部不需要修改——它们操作的仍然是扁平数组。
2. **自动同步**：响应更新（`statusCode` 从 `null` 变为实际值）、淘汰清理（超出 `MAX_MEMORY_REQUESTS` 删除旧请求）都会自动反映到树中，因为树是 computed。
3. **模式切换零成本**：list / group 两种模式共享同一个 `requests` 源，切换时无数据迁移。
4. **性能可控**：computed 仅在 `requests.value` 发生变化时（即 flush 时）重新计算，频率受 `getFlushInterval()`（50ms~500ms）控制。

### 1.3 改造后的完整数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                                   │
│                                                                         │
│  mitm-server.ts                                                         │
│  ┌──────────────┐    ┌───────────────────┐    ┌──────────────────────┐ │
│  │  onRequest   │    │  onRequestEnd     │    │  onResponseEnd       │ │
│  │ 收集请求体   │───▶│ pushRequestArrived│    │ pushResponseArrived  │ │
│  │              │    │ (partial,code=null)│   │ (statusCode等更新)   │ │
│  └──────────────┘    └────────┬──────────┘    └──────────┬───────────┘ │
│                               │                          │             │
│                    IPC: PROXY_NEW_REQUEST    IPC: PROXY_REQUEST_UPDATED │
└───────────────────────────────┼──────────────────────────┼─────────────┘
                                │                          │
                    ┌───────────▼─────────────────────────▼──────────┐
                    │              前端 (Renderer)                     │
                    │                                                │
                    │  src/services/ipc.ts                           │
                    │  ipc.proxy.onNewRequest(cb)  ◀── 第一阶段推送   │
                    │  ipc.proxy.onRequestUpdated(cb) ◀── 第二阶段推送│
                    │                    │                   │        │
                    │                    ▼                   ▼        │
                    │  src/stores/request-store.ts                   │
                    │  ┌─────────────────────────────────────────┐   │
                    │  │ addRequest(req)        updateRequest(upd)│   │
                    │  │  ├─ id已存在?→原地更新   ├─ requestIndexMap│   │
                    │  │  ├─ pendingRequests     │  O(1)查找       │   │
                    │  │  │  .push(req)          ├─ pendingRequests│   │
                    │  │  └─ (去重逻辑不变)      └─ 原地更新字段   │   │
                    │  └──────────────┬──────────────────────────┘   │
                    │                 │                               │
                    │     flushPending() (50ms~500ms动态间隔)         │
                    │     ├─ requests.value.push(...batch)            │
                    │  ppp├─ appendToIndexMap()                       │
                    │     └─ 超限淘汰 (MAX_MEMORY_REQUESTS=5000)     │
                    │                 │                               │
                    │     ┌───────────▼───────────────────────────┐  │
                    │     │  requests: ref<CaptureRequest[]>       │  │
                    │     │  [oldest, ..., newest]  ← 唯一数据源   │  │
                    │     └───────────┬───────────────────────────┘  │
                    │                 │                               │
                    │     ┌───────────▼───────────────────────────┐  │
                    │     │  filteredRequests (computed, 现有)     │  │
                    │     │  ├─ domainFilters 过滤 (OR, *通配符)   │  │
                    │     │  └─ .reverse() (最新在前)              │  │
                    │     └──────┬────────────────────┬───────────┘  │
                    │            │ list模式            │ group模式     │
                    │            ▼                    ▼              │
                    │     ┌──────────────┐   ┌────────────────────┐  │
                    │     │ displayReq   │   │ groupedTreeRequests│  │
                    │     │ uests(现有)  │   │ (computed, 新增)   │  │
                    │     │ +searchQuery │   │ 按host分组→Domain  │  │
                    │     │ 过滤         │   │ Node[]             │  │
                    │     └──────┬───────┘   └────────┬───────────┘  │
                    │            │                    │              │
                    │            │           ┌────────▼──────────┐   │
                    │            │           │ flatTreeRows      │   │
                    │            │           │ (computed, 新增)  │   │
                    │            │           │ 展平为可见行数组  │   │
                    │            │           │ (含展开/折叠状态) │   │
                    │            │           │ +searchQuery过滤  │   │
                    │            │           └────────┬──────────┘   │
                    │            │                    │              │
                    │     ┌──────▼────────────────────▼──────────┐  │
                    │     │     RequestList.vue                   │  │
                    │     │  ┌─────────────────────────────────┐  │  │
                    │     │  │  RecycleScroller (虚拟滚动)      │  │  │
                    │     │  │  items = displayRequests         │  │  │
                    │     │  │     OR flatTreeRows              │  │  │
                    │     │  │  (由 viewMode 决定)              │  │  │
                    │     │  │  item-size = 48                  │  │  │
                    │     │  └─────────────────────────────────┘  │  │
                    │     └───────────────────────────────────────┘  │
                    └────────────────────────────────────────────────┘
```

### 1.4 新增/修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/types.ts` | 修改 | 新增 `FlatTreeNode`、`DomainSortMode` 类型定义 |
| `src/utils/tree-builder.ts` | **新增** | 树构建 + 展平工具函数（纯函数，无副作用） |
| `src/stores/request-store.ts` | 修改 | 新增 `collapsedDomains`、`domainSortMode` 状态，`groupedTreeRequests`、`flatTreeRows` computed，`toggleDomainExpand` 等 action |
| `src/components/RequestList.vue` | 修改 | 支持双模式渲染（list / group），group 模式渲染树形行 |
| `src/components/RecordControl.vue` | 微调 | 视图切换按钮文案优化（可选） |
| `src/views/MainView.vue` | 修改 | 传递 `viewMode` 给 RequestList；键盘导航适配树模式 |

### 1.5 架构层次划分

```
┌─────────────────────────────────────────────┐
│  View 层 (RequestList.vue, MainView.vue)    │  ← 渲染 + 交互
├─────────────────────────────────────────────┤
│  Store 层 (request-store.ts)                │  ← 状态管理 + computed 派生
│  ├─ requests (扁平数组, 数据源)              │
│  ├─ filteredRequests (现有, list模式)       │
│  ├─ groupedTreeRequests (新增, 树构建)      │
│  ├─ flatTreeRows (新增, 展平+过滤)          │
│  └─ collapsedDomains (新增, 折叠状态)        │
├─────────────────────────────────────────────┤
│  Utils 层 (tree-builder.ts)                 │  ← 纯函数: 分组/展平/排序
├─────────────────────────────────────────────┤
│  Types 层 (types.ts)                        │  ← 类型定义
├─────────────────────────────────────────────┤
│  IPC 层 (ipc.ts) + Proxy 层 (mitm-server)  │  ← 数据捕获 (不改动)
└─────────────────────────────────────────────┘
```

---

## 2. 树状结构的节点模型定义

### 2.1 类型定义

以下类型定义新增至 `src/services/types.ts`：

```typescript
/**
 * 域名排序模式
 */
export type DomainSortMode = 'latest' | 'count' | 'alphabetical'

/**
 * 树节点类型标识（用于展平后的统一行）
 */
export type TreeNodeType = 'domain' | 'request'

/**
 * 域名节点（树的非叶子节点）
 * 对应一个 host 值，包含该域名下的所有请求
 */
export interface DomainNode {
  /** 节点类型标识 */
  type: 'domain'
  /** 域名（即 CaptureRequest.host），作为唯一键 */
  host: string
  /** 该域名下的所有请求（按 capturedAt 降序，最新在前） */
  children: CaptureRequest[]
  /** 请求总数 */
  count: number
  /** 是否有错误请求（statusCode >= 400），用于标红 */
  hasError: boolean
  /** 等待响应的请求数（statusCode === null），用于显示"加载中"指示 */
  pendingCount: number
  /** 最新请求的捕获时间（ISO），用于排序 */
  latestCapturedAt: string
  /** 该域名下是否有被选中的请求（用于高亮域名节点） */
  hasSelected: boolean
  /** 该域名下是否有被勾选的请求（用于高亮域名节点） */
  hasChecked: boolean
}

/**
 * 展平后的虚拟滚动行（统一格式，喂给 RecycleScroller）
 * RecycleScroller 要求 items 数组元素有统一结构
 */
export interface FlatTreeNode {
  /** 节点类型：域名头 or 请求行 */
  type: TreeNodeType
  /** 唯一键（RecycleScroller 的 key-field） */
  key: string
  /** 缩进层级（0 = 域名节点，1 = 请求子节点） */
  depth: number

  // ---- domain 类型字段 ----
  /** 域名（type === 'domain' 时有值） */
  host?: string
  /** 带协议前缀的域名（用于显示，如 https://api.example.com） */
  displayHost?: string
  /** 请求计数（type === 'domain' 时有值） */
  count?: number
  /** 搜索时：总数（用于显示 "匹配数/总数"） */
  totalCount?: number
  /** 是否有错误（type === 'domain' 时有值） */
  hasError?: boolean
  /** 等待响应数（type === 'domain' 时有值） */
  pendingCount?: number
  /** 是否展开（type === 'domain' 时有值） */
  expanded?: boolean
  /** 是否含选中/勾选请求（type === 'domain' 时有值） */
  hasSelected?: boolean
  hasChecked?: boolean

  // ---- request 类型字段 ----
  /** 请求对象（type === 'request' 时有值） */
  request?: CaptureRequest
}
```

### 2.2 节点关系图

```
┌─────────────────────────────────────────────────────────┐
│                    flatTreeRows: FlatTreeNode[]          │
│                  (展平后的线性数组，喂给虚拟滚动)          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [0] { type:'domain', key:'domain:api.shop.com',        │
│        host:'api.shop.com', count:3, expanded:true }    │
│                                                         │
│  [1]   { type:'request', key:'req_170..._1',            │
│          request:CaptureRequest, depth:1 }              │
│                                                         │
│  [2]   { type:'request', key:'req_170..._2',            │
│          request:CaptureRequest, depth:1 }              │
│                                                         │
│  [3]   { type:'request', key:'req_170..._3',            │
│          request:CaptureRequest, depth:1 }              │
│                                                         │
│  [4] { type:'domain', key:'domain:cdn.example.com',     │
│        host:'cdn.example.com', count:2, expanded:false} │
│        ← 折叠态：children 不出现在数组中                  │
│                                                         │
│  [5] { type:'domain', key:'domain:pay.gateway.com',     │
│        host:'pay.gateway.com', count:1, expanded:true } │
│                                                         │
│  [6]   { type:'request', key:'req_170..._5',            │
│          request:CaptureRequest, depth:1 }              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.3 节点状态字段说明

| 字段 | 所属节点 | 类型 | 说明 | 来源 |
|------|---------|------|------|------|
| `host` | DomainNode | `string` | 域名，作为节点唯一键 | `CaptureRequest.host` |
| `count` | DomainNode | `number` | 子请求数 | 遍历 children |
| `hasError` | DomainNode | `boolean` | 是否含错误请求(≥400) | 遍历 children |
| `pendingCount` | DomainNode | `number` | statusCode=null 的数量 | 遍历 children |
| `latestCapturedAt` | DomainNode | `string` | 最新请求时间 | `max(children.capturedAt)` |
| `hasSelected` | DomainNode | `boolean` | 含 selected=true 请求 | 遍历 children |
| `hasChecked` | DomainNode | `boolean` | 含 checked=true 请求 | 遍历 children |
| `expanded` | DomainNode | `boolean` | 展开/折叠状态 | `collapsedDomains` Set（取反） |
| `depth` | FlatTreeNode | `number` | 缩进层级(0/1) | 构建时确定 |
| `type` | FlatTreeNode | `TreeNodeType` | 行类型 | 构建时确定 |

### 2.4 展开状态的数据结构

在 `request-store.ts` 中新增：

```typescript
/** 折叠的域名集合（存储已折叠的，默认展开，节省 localStorage 空间） */
const collapsedDomains = ref<Set<string>>(new Set())

/** 域名排序模式 */
const domainSortMode = ref<DomainSortMode>('latest')
```

**设计理由**：存储"已折叠"而非"已展开"集合，因为默认全展开，用户通常只会折叠少数不关注的域名。集合大小更小，localStorage 序列化更轻量。

---

## 3. UI 线框图 / ASCII 示意图

### 3.1 整体布局（MainView 上半区）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [系统代理提示条]                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  [域名过滤器: api.shop.com ×    *.cdn.com ×    输入域名...]                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  [● 录制中]  已捕获 156 条 · 过滤后 89 条 · 已选 1/2  [AI对比] [导出] [清空] [分组]│
├──────────────────────────────┬──────────────────────────────────────────────┤
│                              │                                              │
│   左侧栏 (RequestList)        │   右侧详情 (RequestDetail)                    │
│   ┌──────────────────────┐   │   ┌──────────────────────────────────────┐   │
│   │ 🔍 搜索路径、状态码… │   │   │  GET /order/detail                    │   │
│   ├──────────────────────┤   │   │  Host: api.shop.com                   │   │
│   │                      │   │   │  Status: 200  Duration: 156ms         │   │
│   │  (树状列表区域)       │   │   │  ──────────────────────────────       │   │
│   │  见下方详细线框图     │   │   │  Request Headers | Response Headers   │   │
│   │                      │   │   │  Request Body   | Response Body       │   │
│   │                      │   │   │                                      │   │
│   └──────────────────────┘   │   └──────────────────────────────────────┘   │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│                          (可拖拽分割线)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                       AI 对比结果区域 (CompareResult)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 分组模式（group）— 展开态

```
┌──────────────────────────────────────────────────┐
│ 🔍 搜索路径、状态码…                              │
├──────────────────────────────────────────────────┤
│                                                  │
│  ▼ 🌐 api.shop.com                    12 条  ⚠  │ ← 域名节点(展开态)，⚠表示有错误
│    ☐ GET  /order/detail    14:32:01  200  156ms │ ← 请求子节点(缩进1级)
│    ☑ POST /order/create    14:31:58  201   89ms │ ← 已勾选(蓝底)
│    ☐ GET  /order/list      14:31:55  200  234ms │
│    ☐ GET  /order/detail    14:31:50  ---  ----  │ ← statusCode=null(等待响应)
│    ☐ GET  /user/profile    14:31:45  200   45ms │
│    ☐ GET  /user/profile    14:31:40  200   38ms │
│    ☐ POST /cart/add        14:31:35  200   67ms │
│    ☐ GET  /order/list      14:31:30  500  890ms │ ← 500错误(红色状态码)
│    ☐ GET  /order/detail    14:31:25  200  123ms │
│    ☐ GET  /product/info    14:31:20  200   56ms │
│    ☐ POST /order/create    14:31:15  201   92ms │
│    ☐ GET  /order/detail    14:31:10  200  145ms │
│                                                  │
│  ▼ 🌐 cdn.example.com                  3 条     │ ← 域名节点(展开态)
│    ☐ GET  /static/app.js   14:32:05  200   12ms │
│    ☐ GET  /static/style.css 14:32:04 200    8ms │
│    ☐ GET  /images/logo.png 14:32:03 200   23ms  │
│                                                  │
│  ▶ 🌐 pay.gateway.com                 1 条     │ ← 域名节点(折叠态)，▶表示折叠
│                                                  │
│  ▼ 🌐 analytics.tracker.io            5 条  ⚠  │ ← 域名节点(展开态)
│    ☐ POST /track           14:31:59  204   15ms │
│    ☐ POST /track           14:31:54  204   18ms │
│    ☐ POST /track           14:31:49  204   12ms │
│    ☐ POST /track           14:31:44  204   14ms │
│    ☐ POST /track           14:31:39  503  ---   │ ← 503错误
│                                                  │
└──────────────────────────────────────────────────┘
```

### 3.3 分组模式（group）— 折叠态

```
┌──────────────────────────────────────────────────┐
│ 🔍 搜索路径、状态码…                              │
├──────────────────────────────────────────────────┤
│                                                  │
│  ▶ 🌐 api.shop.com                    12 条  ⚠  │ ← 折叠：子请求全部隐藏
│  ▶ 🌐 cdn.example.com                  3 条     │
│  ▶ 🌐 pay.gateway.com                 1 条     │
│  ▶ 🌐 analytics.tracker.io            5 条  ⚠  │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 3.4 域名节点行结构详解

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▼  🌐  api.shop.com                              12 条       ⚠  ●     │
│ ↑  ↑   ↑                                         ↑          ↑  ↑     │
│ │  │   │                                         │          │  │     │
│ │  │   └─ 域名文本 (font-medium, text-sm)         │          │  │     │
│ │  │                                              │          │  │     │
│ │  └─ 域名图标 (🌐 或文件夹图标)                    │          │  │     │
│ │                                                 │          │  │     │
│ └─ 展开/折叠箭头 (▼ 展开 / ▶ 折叠)                  │          │  │     │
│                                                   │          │  │     │
│                                         请求计数(灰色)     │  │     │
│                                                   错误标记   │  │     │
│                                                  (≥400时显示)│  │     │
│                                                              │  │     │
│                                              有选中请求时显示 ●  │     │
│                                              (实心圆, 蓝色)      │     │
└────────────────────────────────────────────────────────────────────────┘
 整行高度: 48px (与请求行一致，保持 RecycleScroller 统一 item-size)
```

### 3.5 请求子节点行结构详解

```
    ┌────────────────────────────────────────────────────────────────────┐
    │ ☐  GET  /order/detail              14:32:01  200  156ms  iPhone15 │
    │ ↑  ↑   ↑                           ↑       ↑    ↑     ↑       ↑   │
    │ │  │   │                           │       │    │     │       │   │
    │ │  │   └─ 路径 (truncate)           │       │    │     │       │   │
    │ │  └─ 方法徽章 (颜色区分)            │       │    │     │       │   │
    │ │                                  │       │    │     │       │   │
    │ └─ 勾选框 (AI对比用)                │       │    │     │       │   │
    │                                    │       │    │     │       │   │
    │                           捕获时间(HH:mm:ss) │    │     │       │   │
    │                                           状态码 │     │       │   │
    │                                          (颜色区分)│     │       │   │
    │                                                  耗时    │       │   │
    │                                                        设备名  │   │
    └────────────────────────────────────────────────────────────────────┘
    ← 缩进: 20px (depth=1)
    整行高度: 48px
    注: 与现有 list 模式的请求行布局一致，仅增加缩进 + 隐藏 host (已在域名节点显示)
```

### 3.6 搜索过滤时的树形态

```
┌──────────────────────────────────────────────────┐
│ 🔍 order                                          │ ← 搜索 "order"
├──────────────────────────────────────────────────┤
│                                                  │
│  ▼ 🌐 api.shop.com                     5 条  ⚠  │ ← 命中5条含"order"的请求
│    ☐ GET  /order/detail    14:32:01  200  156ms │ ← 只显示匹配的子节点
│    ☑ POST /order/create    14:31:58  201   89ms │   (非匹配的不显示)
│    ☐ GET  /order/list      14:31:55  200  234ms │
│    ☐ GET  /order/detail    14:31:50  ---  ----  │
│    ☐ GET  /order/list      14:31:30  500  890ms │
│                                                  │
│  ▼ 🌐 pay.gateway.com                 1 条      │ ← 命中1条(路径含"order")
│    ☐ POST /order/pay      14:31:48  200  312ms  │   自动展开(即使之前折叠)
│                                                  │
│  ✗ cdn.example.com      (隐藏)                   │ ← 无匹配子节点，整组隐藏
│  ✗ analytics.tracker.io (隐藏)                   │ ← 无匹配子节点，整组隐藏
│                                                  │
└──────────────────────────────────────────────────┘

搜索行为规则:
  1. 搜索词匹配 path / method / statusCode / host
  2. 只显示有匹配子节点的域名节点（空域名隐藏）
  3. 命中的域名节点强制展开（忽略折叠状态）
  4. 域名节点的 count 显示"匹配数/总数"，如 "5/12 条"
  5. 清除搜索后恢复各域名节点原始展开/折叠状态
```

### 3.7 列表模式（list）— 不变

```
┌──────────────────────────────────────────────────┐
│ 🔍 搜索路径、状态码…                              │
├──────────────────────────────────────────────────┤
│                                                  │
│  ☐ GET  /order/detail    14:32:01  200  156ms   │ ← 无缩进，无域名头
│  ☑ POST /order/create    14:31:58  201   89ms   │   (与现有行为完全一致)
│  ☐ GET  /static/app.js   14:32:05  200   12ms   │
│  ☐ GET  /order/list      14:31:55  200  234ms   │
│  ...                                              │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## 4. 与现有请求捕获流程的对接方案

### 4.1 两阶段推送对接概述

现有的两阶段推送机制**完全不需要修改**。树状结构作为 computed 派生视图，自动响应 `requests` 数组的变化。

```
阶段1: 请求到达 (onRequestEnd)
  mitm-server.ts → pushRequestArrived()
  → IPC: PROXY_NEW_REQUEST
  → ipc.proxy.onNewRequest(cb)
  → store.addRequest(partialRequest)    // statusCode=null
  → pendingRequests.push(req)
  → flushPending() [50~500ms后]
  → requests.value.push(...batch)       // 触发响应式
  → groupedTreeRequests computed 重算   // 新请求自动归入对应域名节点
  → flatTreeRows computed 重算          // 新行出现在展开的域名节点下

阶段2: 响应到达 (onResponseEnd)
  mitm-server.ts → pushResponseArrived()
  → IPC: PROXY_REQUEST_UPDATED
  → ipc.proxy.onRequestUpdated(cb)
  → store.updateRequest(update)         // 按id查找，原地更新
  → requests.value[idx].statusCode = 200  // 触发响应式
  → groupedTreeRequests computed 重算   // DomainNode.hasError/pendingCount 更新
  → flatTreeRows computed 重算          // 请求行状态码从 --- 变为 200
```

### 4.2 addRequest 对接（零改动）

现有 `addRequest(request: CaptureRequest)` 的去重逻辑：

```
1. requestIndexMap.get(id) → 找到 → 原地更新响应字段（statusCode等）
2. pendingRequests.findIndex(id) → 找到 → 就地更新缓冲
3. 都没找到 → 新请求 → pendingRequests.push(request)
```

**树状模式无需修改此逻辑**。原因：

- `addRequest` 操作的是扁平 `requests` 数组（通过 `pendingRequests` 缓冲后 flush）。
- 树状结构是 `groupedTreeRequests` computed，依赖 `filteredRequests`，而 `filteredRequests` 依赖 `requests.value`。
- 当 `requests.value` 因 flush 而变化时，computed 自动重算，新请求自动出现在对应域名节点下。

### 4.3 updateRequest 对接（零改动）

现有 `updateRequest(update: RequestUpdate)` 的更新逻辑：

```
1. requestIndexMap.get(id) → 找到 → 原地更新 statusCode/duration/headers/body
2. pendingRequests.findIndex(id) → 找到 → 就地更新缓冲
3. 都没找到 → console.warn
```

**树状模式无需修改此逻辑**。当 `requests.value[idx]` 的 `statusCode` 从 `null` 变为 `200` 时：

- Vue 响应式检测到属性变化 → `filteredRequests` computed 重算 → `groupedTreeRequests` 重算
- `DomainNode.pendingCount` 减少（因为 statusCode 不再是 null）
- `DomainNode.hasError` 可能更新（如果 statusCode >= 400）
- `FlatTreeNode` 中对应请求行的状态码从 `---` 变为实际值

### 4.4 批量缓冲（flushPending）对接（零改动）

现有 `flushPending()` 机制：

```
- pendingRequests 缓冲新请求（非响应式）
- 定时器间隔: 50ms(<1000条) / 200ms(<3000条) / 500ms(≥3000条)
- flush 时: requests.value.push(...batch) → 一次性触发响应式更新
- appendToIndexMap() 增量更新索引
```

**树状模式无需修改**。flush 触发 `requests.value` 变化后，`groupedTreeRequests` 和 `flatTreeRows` computed 各重算一次。由于 computed 有缓存，一次 flush 只触发一次重算，不会因 batch 内多条请求而多次计算。

### 4.5 淘汰机制对接（零改动）

现有淘汰逻辑（`MAX_MEMORY_REQUESTS = 5000`）：

```
1. 收集最老的未选中(selected/checked)请求的 id
2. requests.value = requests.value.filter(r => !toRemoveIds.has(r.id))
3. rebuildIndexMap()
4. 清理 selectedRequest / checkedRequests
```

**树状模式自动适配**：

- 被淘汰的请求从 `requests.value` 移除 → `filteredRequests` 重算 → `groupedTreeRequests` 重算
- 被淘汰请求从对应 `DomainNode.children` 中消失
- 若某域名下所有请求都被淘汰 → 该 `DomainNode` 自动消失（分组时无 children）
- `collapsedDomains` 中对应的 host 可保留（即使该域名暂时无请求，下次新请求到来时仍保持折叠状态）

**注意**：淘汰后的 `rebuildIndexMap()` 是对 `requestIndexMap` 的操作，与树无关，不受影响。

### 4.6 域名过滤器（domainFilters）对接（零改动）

现有 `filteredRequests` computed 已集成 `domainFilters`（OR 匹配，支持 `*` 通配符）：

```typescript
const filteredRequests = computed(() => {
  const source = requests.value
  if (domainFilters.value.length === 0) return source.slice().reverse()
  const filtered = source.filter(req => /* glob 匹配 host */)
  return filtered.reverse()
})
```

`groupedTreeRequests` 依赖 `filteredRequests`，因此域名过滤器的效果自动传递：

- 设置 `domainFilters: ['api.shop.com']` → `filteredRequests` 只含该域名的请求 → 树中只有该域名的 `DomainNode`

**无需在树层面再做一次域名过滤**，避免重复逻辑。

### 4.7 数据流时序图

```
时间轴 ──────────────────────────────────────────────────────────────────▶

T0: 用户发起 HTTP 请求
    │
    ▼
T1: proxy.onRequest → ctx 存储 method/url/host/path/clientIp
    │
    ▼
T2: proxy.onRequestEnd → pushRequestArrived()
    │  构造 partial: { id, method, url, path, host, statusCode:null, ... }
    │
    ├─▶ IPC send: PROXY_NEW_REQUEST
    │   │
    │   ▼
    │  T3: store.addRequest(partial)
    │      ├─ requestIndexMap 无此 id
    │      ├─ pendingRequests 无此 id
    │      └─ pendingRequests.push(partial)     ← 进入缓冲
    │
    │  (等待 flush...)
    │
    │  T4: flushPending() [50~500ms后]
    │      ├─ requests.value.push(...batch)      ← 触发响应式
    │      ├─ appendToIndexMap()
    │      └─ 检查淘汰
    │          │
    │          ▼
    │      T5: filteredRequests computed 重算
    │          │
    │          ▼
    │      T6: groupedTreeRequests computed 重算
    │          ├─ 按 host 分组 filteredRequests
    │          ├─ 构建 DomainNode[]（含 count/hasError/pendingCount）
    │          └─ 按 domainSortMode 排序
    │          │
    │          ▼
    │      T7: flatTreeRows computed 重算
    │          ├─ 遍历 DomainNode[]
    │          ├─ 展开态: push domain行 + 所有children的request行
    │          ├─ 折叠态: 只 push domain行
    │          ├─ 应用 searchQuery 过滤
    │          └─ 返回 FlatTreeNode[]
    │          │
    │          ▼
    │      T8: RequestList.vue 重新渲染
    │          └─ RecycleScroller items 更新 → 新请求行出现在视口中
    │
T9: proxy.onResponseEnd → pushResponseArrived()
    │  构造 update: { id, statusCode, duration, headers, body }
    │
    ├─▶ IPC send: PROXY_REQUEST_UPDATED
    │   │
    │   ▼
    │  T10: store.updateRequest(update)
    │      ├─ requestIndexMap.get(id) → 找到 idx
    │      └─ requests.value[idx].statusCode = 200  ← 原地更新,触发响应式
    │          │
    │          ▼
    │      T11~T13: 同 T5~T8 (computed 链式重算)
    │          └─ 请求行状态码从 --- 变为 200
    │             DomainNode.pendingCount 减少
    │             DomainNode.hasError 可能更新
```

---

## 5. 关键交互细节

### 5.1 域名节点点击行为

| 操作 | 目标 | 行为 |
|------|------|------|
| **单击域名节点** | Domain header | 切换展开/折叠状态（toggle `collapsedDomains`） |
| **单击请求子节点** | Request row | emit `select` → `store.selectRequest(request)` → 右侧详情更新（与 list 模式一致） |
| **双击域名节点** | Domain header | 无特殊行为（同单击） |
| **勾选框点击** | Request row 的 checkbox | emit `toggle-check` → `store.toggleCheck(request)`（与 list 模式一致，最多2个） |
| **域名节点勾选框** | 无 | 域名节点**不设勾选框**（勾选只针对单个请求，用于 AI 对比配对） |

**展开/折叠状态切换伪代码**（`request-store.ts` 新增 action）：

```typescript
/** 切换域名展开/折叠 */
function toggleDomainExpand(host: string): void {
  const next = new Set(collapsedDomains.value)
  if (next.has(host)) {
    next.delete(host)    // 从折叠恢复展开
  } else {
    next.add(host)       // 展开变折叠
  }
  collapsedDomains.value = next
  // 持久化到 localStorage
  saveCollapsedDomains()
}

/** 判断域名是否展开 */
function isDomainExpanded(host: string): boolean {
  return !collapsedDomains.value.has(host)  // 默认展开
}
```

### 5.2 搜索过滤如何影响树结构

搜索逻辑在 store 的 `flatTreeRows` computed 中实现。`searchQuery` 已迁移到 `request-store.ts`（从 `RequestList.vue` 的本地 state 迁移），供树形 computed 和键盘导航共用。

**搜索时的树行为规则**：

```
当 searchQuery 非空时:
  ┌─────────────────────────────────────────────────────┐
  │ 1. 对每个 DomainNode 的 children 执行搜索过滤        │
  │    匹配条件: path/method/statusCode/host 包含搜索词  │
  │                                                      │
  │ 2. 过滤后 children.length === 0 的域名节点 → 隐藏    │
  │    (不出现在 flatTreeRows 中)                        │
  │                                                      │
  │ 3. 有匹配子节点的域名节点 → 强制展开                  │
  │    (即使 collapsedDomains 中有该 host，也临时展开)    │
  │                                                      │
  │ 4. 域名节点的 count 显示 "匹配数/总数"               │
  │    例: "5/12 条"                                     │
  │                                                      │
  │ 5. 清除搜索词后 → 恢复 collapsedDomains 原始状态     │
  │    (被搜索强制展开的节点恢复折叠)                     │
  └─────────────────────────────────────────────────────┘
```

**伪代码**（`tree-builder.ts` 中的 `flattenTree` 函数）：

```typescript
function flattenTree(
  domains: DomainNode[],
  collapsedDomains: Set<string>,
  searchQuery: string
): FlatTreeNode[] {
  const rows: FlatTreeNode[] = []
  const isSearching = searchQuery.trim().length > 0

  for (const domain of domains) {
    // 1. 搜索过滤子节点
    let visibleChildren = domain.children
    if (isSearching) {
      visibleChildren = domain.children.filter(req =>
        matchSearch(req, searchQuery)
      )
    }

    // 2. 无匹配子节点 → 隐藏整个域名节点
    if (isSearching && visibleChildren.length === 0) continue

    // 3. 判断展开状态：搜索时强制展开
    const expanded = isSearching
      ? true
      : !collapsedDomains.has(domain.host)

    // 4. 推入域名行
    rows.push({
      type: 'domain',
      key: `domain:${domain.host}`,
      depth: 0,
      host: domain.host,
      count: isSearching ? visibleChildren.length : domain.count,
      hasError: domain.hasError,
      pendingCount: domain.pendingCount,
      expanded,
      hasSelected: domain.hasSelected,
      hasChecked: domain.hasChecked,
    })

    // 5. 展开时推入子请求行
    if (expanded) {
      for (const req of visibleChildren) {
        rows.push({
          type: 'request',
          key: req.id,
          depth: 1,
          request: req,
        })
      }
    }
  }

  return rows
}
```

### 5.3 实时新增请求动态插入

由于树是 computed 派生，新请求的"插入"是自动的。但需要关注以下用户体验细节：

#### 5.3.1 新请求归属逻辑（自动）

```
新请求到达 (host: 'api.new.com')
  │
  ▼
groupedTreeRequests computed 重算
  ├─ 按 host 分组 → 'api.new.com' 是新 host
  ├─ 创建新 DomainNode { host: 'api.new.com', children: [newReq], ... }
  └─ 按 domainSortMode 排序插入到正确位置
      │
      ▼
flatTreeRows computed 重算
  └─ 新 DomainNode 出现在列表中
      ├─ 默认展开（collapsedDomains 中无此 host）
      └─ 子请求行出现在域名行下方
```

#### 5.3.2 新域名节点的默认行为

| 场景 | 行为 | 理由 |
|------|------|------|
| 新 host 首次出现 | **默认展开** | 用户能立即看到新域名的请求，无需手动展开 |
| 之前折叠过的 host 再次出现新请求 | **保持折叠** | 尊重用户之前的操作（`collapsedDomains` 中保留） |
| 搜索状态下新请求到达 | 遵循搜索规则（匹配则显示，强制展开） | 搜索优先级高于折叠状态 |

#### 5.3.3 滚动定位策略

| 场景 | 策略 | 实现方式 |
|------|------|---------|
| 录制中，用户未手动滚动 | **自动滚动到顶部**（最新请求） | RecycleScroller 的 `scrollToItem(0)` |
| 录制中，用户已手动向下滚动 | **不自动滚动**（保持当前位置） | 检测 scrollTop > 0 时不自动滚动 |
| 用户点击域名节点展开 | 不滚动 | — |
| 用户搜索后 | 滚动到第一个匹配项 | `scrollToItem(firstMatchIndex)` |

**自动滚动伪代码**（`RequestList.vue`）：

```typescript
const scrollerRef = ref<InstanceType<typeof RecycleScroller> | null>(null)
const userScrolled = ref(false)

function onScroll() {
  // 用户主动滚动后标记
  if (scrollerRef.value) {
    const scrollTop = (scrollerRef.value.$el as HTMLElement).scrollTop
    userScrolled.value = scrollTop > 10
  }
}

// watch flatTreeRows 变化
watch(flatTreeRows, () => {
  if (isRecording.value && !userScrolled.value && !searchQuery.value) {
    nextTick(() => scrollerRef.value?.scrollToItem(0))
  }
})
```

### 5.4 展开/折叠状态持久化

**持久化方案**：`localStorage`

```typescript
const STORAGE_KEY = 'powercatch-collapsed-domains'

/** 从 localStorage 恢复折叠状态 */
function loadCollapsedDomains(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return new Set(JSON.parse(raw))
    }
  } catch { /* ignore */ }
  return new Set()
}

/** 持久化折叠状态 */
function saveCollapsedDomains(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(collapsedDomains.value))
    )
  } catch { /* ignore */ }
}
```

**设计考量**：

- 存储"已折叠"集合而非"已展开"：默认全展开，用户通常只折叠少数域名，集合更小。
- 不存储在 better-sqlite3 中：展开/折叠是 UI 偏好，非业务数据，localStorage 足够。
- 容量限制：即使 200 个域名全折叠，JSON 数组约 5KB，localStorage 完全可承载。
- 清空请求时不清空折叠状态：用户可能再次录制同域名请求，保持上次的折叠偏好。

### 5.5 域名排序策略

提供三种排序模式，默认按最新活动时间排序：

| 排序模式 | DomainSortMode | 排序规则 | 适用场景 |
|---------|----------------|---------|---------|
| **最新活动** | `'latest'` | 按 `latestCapturedAt` 降序（最新有请求的域名在最上方） | **默认**，录制时最活跃的域名在最上方 |
| **请求量** | `'count'` | 按 `count` 降序（请求最多的域名在最上方） | 分析高频域名 |
| **字母序** | `'alphabetical'` | 按 `host` 字母升序 (A-Z) | 快速定位特定域名 |

**排序切换 UI**：在搜索框右侧添加一个排序下拉菜单（仅 group 模式显示）。

**伪代码**（`tree-builder.ts` 中的 `sortDomains` 函数）：

```typescript
function sortDomains(
  domains: DomainNode[],
  mode: DomainSortMode
): DomainNode[] {
  const sorted = [...domains]
  switch (mode) {
    case 'latest':
      // latestCapturedAt 降序（新的在前）
      return sorted.sort((a, b) =>
        b.latestCapturedAt.localeCompare(a.latestCapturedAt)
      )
    case 'count':
      // count 降序（多的在前），count 相同时按 latest 降序
      return sorted.sort((a, b) =>
        b.count - a.count ||
        b.latestCapturedAt.localeCompare(a.latestCapturedAt)
      )
    case 'alphabetical':
      // host 升序 (A-Z)
      return sorted.sort((a, b) => a.host.localeCompare(b.host))
  }
}
```

**子节点排序**：域名内的请求子节点始终按 `capturedAt` **降序**（最新在前），与 list 模式的 `filteredRequests` 排序一致。

### 5.6 键盘导航

#### 5.6.1 导航逻辑差异

| 模式 | 导航数据源 | 行为 |
|------|-----------|------|
| **list 模式** | `filteredRequests`（扁平数组） | ↑/↓ 在请求间移动（现有逻辑） |
| **group 模式** | `flatTreeRows`（展平行数组） | ↑/↓ 在所有可见行间移动（含域名头） |

#### 5.6.2 group 模式键盘导航规则

```
当前选中行 = flatTreeRows 中 selectedRequest 对应的 request 行
（若无选中，默认从第一行开始）

按键行为:

┌────────────┬──────────────────────────────────────────────────────┐
│ 按键       │ 行为                                                  │
├────────────┼──────────────────────────────────────────────────────┤
│ ↑ ArrowUp  │ 移动到上一个可见行                                     │
│            │ (可能是上一个请求行，也可能是域名头)                     │
│            │ 若移到域名头：不触发 selectRequest                     │
│            │ 若移到请求行：触发 selectRequest(row.request)          │
├────────────┼──────────────────────────────────────────────────────┤
│ ↓ ArrowDown│ 移动到下一个可见行                                     │
│            │ (同上)                                                 │
├────────────┼──────────────────────────────────────────────────────┤
│ ← ArrowLeft│ 在域名头上：折叠该域名                                 │
│            │ 在请求行上：跳转到父域名头                             │
├────────────┼──────────────────────────────────────────────────────┤
│ → ArrowRight│ 在域名头上：展开该域名                                │
│            │ 在请求行上：无操作                                     │
├────────────┼──────────────────────────────────────────────────────┤
│ Space      │ 在域名头上：切换展开/折叠                              │
│            │ 在请求行上：toggleCheck（现有行为）                    │
├────────────┼──────────────────────────────────────────────────────┤
│ Enter      │ 在域名头上：切换展开/折叠                              │
│            │ 在请求行上：selectRequest（现有行为）                  │
├────────────┼──────────────────────────────────────────────────────┤
│ Escape     │ 取消选中（现有行为）                                   │
└────────────┴──────────────────────────────────────────────────────┘
```

#### 5.6.3 导航实现伪代码（`MainView.vue` 修改）

```typescript
// 新增：当前导航焦点索引（group 模式专用）
const navigationIndex = ref<number>(-1)

function handleNavigateUp(): void {
  if (requestStore.viewMode === 'list') {
    // 现有 list 模式逻辑（不变）
    const list = requestStore.filteredRequests
    // ... 现有代码
    return
  }

  // group 模式
  const rows = requestStore.flatTreeRows
  if (rows.length === 0) return

  const newIndex = navigationIndex.value <= 0
    ? rows.length - 1
    : navigationIndex.value - 1

  navigationIndex.value = newIndex
  const row = rows[newIndex]

  if (row.type === 'request' && row.request) {
    requestStore.selectRequest(row.request)
  }
  // domain 行不触发 select，仅移动焦点
}

function handleNavigateDown(): void {
  if (requestStore.viewMode === 'list') {
    // 现有 list 模式逻辑（不变）
    return
  }

  const rows = requestStore.flatTreeRows
  if (rows.length === 0) return

  const newIndex = navigationIndex.value < 0 || navigationIndex.value >= rows.length - 1
    ? 0
    : navigationIndex.value + 1

  navigationIndex.value = newIndex
  const row = rows[newIndex]

  if (row.type === 'request' && row.request) {
    requestStore.selectRequest(row.request)
  }
}
```

#### 5.6.4 导航越过折叠域名头

当用户按 ↓ 到达一个**折叠的域名头**时：

- 焦点停在域名头行（高亮）
- 继续按 ↓ → 跳到下一个域名头（因为折叠的域名没有可见子行）
- 按 → 或 Enter → 展开该域名，子行出现
- 继续按 ↓ → 进入第一个子请求行

### 5.7 虚拟滚动策略

#### 5.7.1 核心挑战

`RecycleScroller` 要求 **统一的 `item-size`**，而树状结构有两种行类型（域名头 48px / 请求行 48px）。由于两者高度相同，可以统一使用 `item-size="48"`。

#### 5.7.2 方案：展平为统一行数组

将树展平为 `FlatTreeNode[]` 数组，所有行高度统一 48px，直接喂给 `RecycleScroller`：

```vue
<RecycleScroller
  :items="currentDisplayRows"
  :item-size="48"
  key-field="key"
  v-slot="{ item }"
>
  <!-- 域名行 -->
  <div v-if="item.type === 'domain'" class="tree-domain-row" @click="toggleDomainExpand(item.host)">
    <span class="expand-icon">{{ item.expanded ? '▼' : '▶' }}</span>
    <span class="domain-icon">🌐</span>
    <span class="domain-name">{{ item.host }}</span>
    <span class="domain-count">{{ item.count }} 条</span>
    <span v-if="item.hasError" class="error-badge">⚠</span>
  </div>

  <!-- 请求行 -->
  <div v-else class="tree-request-row" :class="{ selected: ..., checked: ... }" @click="$emit('select', item.request)">
    <input type="checkbox" :checked="item.request.checked" @click.stop="$emit('toggle-check', item.request)" />
    <span :class="methodClass(item.request.method)">{{ item.request.method }}</span>
    <span class="path">{{ item.request.path }}</span>
    <!-- ... 时间/状态码/耗时/设备名 (复用现有行设计) -->
  </div>
</RecycleScroller>
```

#### 5.7.3 数据源切换

```typescript
// RequestList.vue 中的 computed
const currentDisplayRows = computed(() => {
  if (props.viewMode === 'list') {
    // list 模式：使用现有的 displayRequests 逻辑
    return applySearchFilter(props.requests, searchQuery.value)
  } else {
    // group 模式：使用展平的树行
    return requestStore.flatTreeRows
  }
})
```

#### 5.7.4 性能分析

| 场景 | 数据量 | 操作 | 复杂度 | 评估 |
|------|--------|------|--------|------|
| 5000 请求, 100 域名 | 100 域名 + 5000 请求 = 5100 行 | 分组(groupBy host) | O(n) = O(5000) | < 1ms |
| 同上 | 构建 DomainNode[] | O(n) | < 1ms | |
| 同上，全部展开 | 展平 5100 行 | O(n) | < 1ms | |
| 同上，全部折叠 | 展平 100 行 | O(n_domains) | < 0.1ms | |
| 搜索过滤 | 遍历 5000 请求匹配 | O(n) | < 1ms | |
| RecycleScroller 渲染 | 只渲染可见行 (~20-30 行) | O(viewport) | ~0ms | |

**结论**：5000 请求 + 100 域名的场景下，computed 链总耗时 < 5ms，完全可接受。瓶颈不在计算而在 Vue 响应式触发频率，而 flush 机制已将触发频率限制在 50~500ms 一次。

#### 5.7.5 RecycleScroller key-field 适配

- list 模式：`key-field="id"`（CaptureRequest.id）
- group 模式：`key-field="key"`（FlatTreeNode.key，格式 `domain:host` 或 `req_xxx`）

统一使用 `key-field="key"`，list 模式的行也包装为 `{ key: req.id, type: 'request', request: req, depth: 0 }`，保持接口一致。

### 5.8 视图模式切换的平滑过渡

当用户点击「列表 / 分组」按钮切换 `viewMode` 时：

```
list → group:
  1. viewMode 变为 'group'
  2. currentDisplayRows computed 切换数据源
  3. RecycleScroller 重新渲染（items 从扁平请求变为树行）
  4. 选中状态保持：selectedRequest 不变，自动定位到对应树行
  5. 勾选状态保持：checkedRequests 不变

group → list:
  1. viewMode 变为 'list'
  2. currentDisplayRows 切换回 filteredRequests + searchQuery
  3. RecycleScroller 重新渲染
  4. 选中/勾选状态保持
```

**滚动位置**：切换模式时重置到顶部（`scrollToItem(0)`），因为两种模式的行索引体系不同，无法精确映射滚动位置。

### 5.9 域名节点的聚合状态展示

域名节点行展示以下聚合信息（从 `DomainNode` 字段映射）：

| 信息 | 来源字段 | 展示样式 |
|------|---------|---------|
| 域名 | `host` | `font-medium text-sm`，truncate |
| 请求计数 | `count` | `text-xs text-gray-500`，搜索时显示 `匹配数/总数` |
| 错误标记 | `hasError` | `⚠` 图标，红色（`text-red-500`），仅 hasError=true 时显示 |
| 等待响应数 | `pendingCount` | `text-xs text-yellow-500`，仅 pendingCount>0 时显示 `⏳ N` |
| 选中指示 | `hasSelected` | `●` 实心圆，蓝色，仅 hasSelected=true 时显示 |
| 勾选指示 | `hasChecked` | 域名行左侧蓝色竖条，仅 hasChecked=true 时显示 |
| 展开/折叠 | `expanded` | `▼`（展开）/ `▶`（折叠）箭头图标 |

### 5.10 边界情况处理

| 场景 | 处理方案 |
|------|---------|
| **host 为空字符串** | 归入特殊域名节点 `"(unknown)"`，排到最底部 |
| **同域名 5000+ 请求** | 域名节点正常显示，子请求受虚拟滚动限制只渲染可见行；折叠后只占 1 行 |
| **域名节点下所有请求被淘汰** | 该 DomainNode 自动消失（computed 中 children 为空时不生成节点） |
| **搜索无结果** | 显示空状态提示 "未找到匹配的请求" |
| **切换到 group 模式时无请求** | 显示现有空状态 "等待请求中..." |
| **domainFilters 过滤后只有一个域名** | 正常显示该域名的树，无其他域名节点 |
| **新请求的 host 在 collapsedDomains 中** | 保持折叠，请求静默加入（计数+1但不展开） |
| **响应更新导致状态码从 null→500** | DomainNode.hasError 从 false→true，域名行出现 ⚠ 标记 |

### 5.11 完整的 Store 新增 API 汇总

在 `request-store.ts` 中新增的状态、computed 和 action：

```typescript
// ===== 新增 State =====
/** 折叠的域名集合（默认展开，存储已折叠的） */
const collapsedDomains = ref<Set<string>>(loadCollapsedDomains())

/** 域名排序模式 */
const domainSortMode = ref<DomainSortMode>('latest')

// ===== 新增 Computed =====
/** 按域名分组的树结构（DomainNode[]） */
const groupedTreeRequests = computed<DomainNode[]>(() => {
  return buildDomainTree(filteredRequests.value, domainSortMode.value)
})

/** 展平后的树行数组（含搜索过滤 + 展开/折叠状态） */
const flatTreeRows = computed<FlatTreeNode[]>(() => {
  const domains = groupedTreeRequests.value
  const collapsed = collapsedDomains.value
  const query = searchQuery.value  // 或从组件传入
  return flattenTree(domains, collapsed, query)
})

// ===== 新增 Actions =====
/** 切换域名展开/折叠 */
function toggleDomainExpand(host: string): void { /* ... */ }

/** 设置域名排序模式 */
function setDomainSortMode(mode: DomainSortMode): void {
  domainSortMode.value = mode
}

/** 判断域名是否展开 */
function isDomainExpanded(host: string): boolean {
  return !collapsedDomains.value.has(host)
}

/** 全部展开 */
function expandAllDomains(): void {
  collapsedDomains.value = new Set()
  saveCollapsedDomains()
}

/** 全部折叠 */
function collapseAllDomains(): void {
  const all = new Set<string>()
  for (const node of groupedTreeRequests.value) {
    all.add(node.host)
  }
  collapsedDomains.value = all
  saveCollapsedDomains()
}
```

### 5.12 tree-builder.ts 工具函数汇总

新增 `src/utils/tree-builder.ts`，包含以下纯函数：

```typescript
/**
 * 按 host 分组构建域名树
 * @param requests 已过滤+反转的请求列表 (filteredRequests)
 * @param sortMode 域名排序模式
 * @returns 排序后的 DomainNode[]
 */
export function buildDomainTree(
  requests: CaptureRequest[],
  sortMode: DomainSortMode
): DomainNode[]

/**
 * 将域名树展平为虚拟滚动行数组
 * @param domains 域名节点数组
 * @param collapsedDomains 折叠的域名集合
 * @param searchQuery 搜索词（空则不过滤）
 * @returns 展平后的 FlatTreeNode[]
 */
export function flattenTree(
  domains: DomainNode[],
  collapsedDomains: Set<string>,
  searchQuery: string
): FlatTreeNode[]

/**
 * 域名排序
 * @param domains 域名节点数组
 * @param mode 排序模式
 * @returns 排序后的新数组
 */
export function sortDomains(
  domains: DomainNode[],
  mode: DomainSortMode
): DomainNode[]

/**
 * 搜索匹配（与 RequestList.vue 现有逻辑一致）
 * @param req 请求对象
 * @param query 搜索词（小写）
 * @returns 是否匹配
 */
export function matchSearch(
  req: CaptureRequest,
  query: string
): boolean
```

---

## 附录 A：与现有代码的兼容性矩阵

| 现有功能 | 是否受影响 | 说明 |
|---------|-----------|------|
| `addRequest()` / `updateRequest()` | ❌ 不受影响 | 核心数据操作不变 |
| `flushPending()` 批量缓冲 | ❌ 不受影响 | flush 机制不变 |
| `MAX_MEMORY_REQUESTS` 淘汰 | ❌ 不受影响 | 淘汰逻辑不变，树自动适配 |
| `domainFilters` 域名过滤 | ❌ 不受影响 | 在 filteredRequests 层面过滤，树自动适配 |
| `filteredRequests` computed | ❌ 不受影响 | 保留，作为树的数据源 |
| `groupedRequests` (matchKey 分组) | ❌ 不受影响 | 保留，用于 AI 对比配对（与域名分组无关） |
| `selectRequest()` / `toggleCheck()` | ❌ 不受影响 | 选中/勾选逻辑不变 |
| list 模式渲染 | ❌ 不受影响 | viewMode='list' 时行为完全不变 |
| 键盘导航 (list 模式) | ❌ 不受影响 | viewMode='list' 时导航逻辑不变 |
| `RequestDetail.vue` | ❌ 不受影响 | 详情面板不关心列表模式 |
| `CompareResult.vue` | ❌ 不受影响 | AI 对比面板不受影响 |
| `RecordControl.vue` | ⚠️ 微调 | viewMode 切换按钮已存在，可优化文案 |
| `MainView.vue` 键盘导航 | ⚠️ 修改 | 需适配 group 模式的树形导航 |
| `RequestList.vue` | ⚠️ 修改 | 核心改造点：支持双模式渲染 |

## 附录 B：RecordControl 视图切换按钮文案建议

当前按钮文案：`viewMode === 'list' ? '列表' : '分组'`

建议改为更清晰的图标 + 文字：

```
list 模式:  [☰ 列表]  [▷ 分组]    ← 列表高亮
group 模式: [☰ 列表]  [▷ 分组]    ← 分组高亮
```

或者使用 segmented control 风格：

```
┌─────────┬─────────┐
│ ☰ 列表  │ 🌳 分组  │
└─────────┴─────────┘
```

## 附录 C：未来扩展考虑（不在本次范围）

1. **多级域名分组**：如 `api.shop.com` → `shop.com` → `api`，支持按域名层级折叠
2. **域名着色**：不同域名分配不同颜色标识，便于视觉区分
3. **拖拽排序域名**：用户自定义域名顺序
4. **域名右键菜单**：复制域名、添加到过滤器、展开/折叠所有
5. **请求子节点按路径二次分组**：同域名下按 path 再分组一层
