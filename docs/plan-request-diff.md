# #12 请求 Diff 视图 - 技术实现方案

> **功能编号**: #12  
> **功能名称**: 请求 Diff 视图（Request Diff View）  
> **创建日期**: 2026-06-26  
> **作者**: PowerCatch Team  
> **状态**: Plan v1.1  
> **工作量评估**: 中（约 3-5 人天）  
> **依赖**: 无（可独立实现）  
> **兼容性**: 已与当前软件架构验证，无冲突

---

## 目录

1. [功能概述](#1-功能概述)
2. [用户场景](#2-用户场景)
3. [技术方案](#3-技术方案)
4. [UI 设计](#4-ui-设计)
5. [数据模型](#5-数据模型)
6. [实现任务分解](#6-实现任务分解)
7. [测试计划](#7-测试计划)
8. [风险评估](#8-风险评估)

---

## 1. 功能概述

### 1.1 核心能力

**请求 Diff 视图** 允许用户在 PowerCatch 中选择两个 HTTP 请求，进行**结构化对比分析**，快速识别差异：

- ✅ **Header Diff**: 对比请求头/响应头的增减和值变化
- ✅ **Body Diff**: 对比请求体/响应体（支持 JSON 结构化 diff）
- ✅ **Status/Time Diff**: 对比状态码、响应时间等元数据
- ✅ **可视化高亮**: 新增（绿色）、删除（红色）、修改（黄色）三色标记
- ✅ **交互式视图**: 支持切换查看不同维度（Headers/Body/全量）

### 1.2 与竞品对比

| 能力 | Charles | Fiddler | Postman | **PowerCatch** |
|------|---------|---------|---------|----------------|
| 请求对比 | ✅ | ✅ | ✅ | ✅ (计划) |
| JSON 结构化 Diff | ❌ | ❌ | ✅ | ✅ |
| 三色标记 | ✅ | ✅ | ✅ | ✅ |
| 拖拽选择对比 | ❌ | ❌ | ❌ | ✅ (创新) |

---

## 2. 用户场景

### 场景 1: API 调试 - 对比成功/失败请求

**用户**: API 开发者  
**需求**: 同一个接口，为啥一次返回 200，一次返回 500？

**操作流程**:
1. 在请求列表中选中第一个请求（状态码 200）
2. 右键 → "对比选中请求"
3. 再选中第二个请求（状态码 500）
4. 自动打开 Diff 视图，高亮显示差异：
   - 请求头 `Authorization` 值不同
   - 请求体 `userId` 字段缺失

**预期效果**: 30 秒内定位问题根因

---

### 场景 2: 性能分析 - 对比快慢请求

**用户**: 后端开发者  
**需求**: 同一个接口，为啥一次 50ms，一次 5s？

**操作流程**:
1. 选中慢请求 → 右键 → "对比相似请求"
2. 系统自动推荐相同 URL 的其他请求
3. 选择快请求进行对比
4. Diff 视图显示：
   - 响应头 `Content-Length` 差异（5MB vs 5KB）
   - 请求头 `Cache-Control` 差异（无缓存 vs 有缓存）

**预期效果**: 快速识别性能瓶颈

---

### 场景 3: 安全审计 - 对比正常/异常请求

**用户**: 安全测试人员  
**需求**: 对比正常用户和攻击者的请求差异

**操作流程**:
1. 使用高级过滤筛选出可疑请求
2. 选中两个请求 → 右键 → "Diff 对比"
3. 查看 Header/Body 差异，识别：
   - SQL 注入 payload
   - XSS 攻击向量
   - 越权访问参数

**预期效果**: 辅助安全审计

---

## 3. 技术方案

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      MainView.vue                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ RequestList  │  │ RequestDetail│  │  DiffView (新增) │  │
│  │  (请求列表)   │  │  (请求详情)  │  │  (对比视图)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**交互流程**:
1. 用户在 RequestList 勾选两个请求（复用现有 `checkedRequests` 机制）
2. 右键菜单 → "对比选中请求"
3. 路由跳转到 `/diff?id1=xxx&id2=yyy`
4. DiffView 组件加载两个请求数据并渲染对比结果

---

### 3.2 核心算法

#### 3.2.1 JSON 结构化 Diff

**挑战**: 普通文本 diff 对 JSON 不友好（格式变化会误报）

**方案**: 使用 `jsondiffpatch` 库

```typescript
import { diff } from 'jsondiffpatch'

const delta = diff(obj1, obj2)
// delta 格式:
// {
//   "key": ["old value", "new value"],  // 修改
//   "key": ["old value"],              // 删除
//   "key": [, "new value"],            // 新增
// }
```

**优势**:
- ✅ 结构化对比，忽略格式差异
- ✅ 支持嵌套对象/数组
- ✅ 输出delta格式，易于渲染

---

#### 3.2.2 Header Diff

**算法**: 键值对对比

```typescript
function diffHeaders(headers1: HttpHeaders, headers2: HttpHeaders) {
  const allKeys = new Set([
    ...Object.keys(headers1),
    ...Object.keys(headers2),
  ])
  
  const added: HttpHeaders = {}
  const removed: HttpHeaders = {}
  const modified: Array<{ key: string; old: string; new: string }> = []
  
  for (const key of allKeys) {
    const in1 = key in headers1
    const in2 = key in headers2
    
    if (in1 && !in2) {
      removed[key] = headers1[key]
    } else if (!in1 && in2) {
      added[key] = headers2[key]
    } else if (headers1[key] !== headers2[key]) {
      modified.push({
        key,
        old: headers1[key],
        new: headers2[key],
      })
    }
  }
  
  return { added, removed, modified }
}
```

---

#### 3.2.3 文本 Diff（降级方案）

当 Body 不是 JSON 时，使用 `diff` 库进行文本对比：

```typescript
import * as Diff from 'diff'

const changes = Diff.diffLines(text1, text2)
// changes 格式:
// [
//   { value: "line1\n", added: false, removed: false },  // 相同
//   { value: "line2\n", removed: true },                 // 删除
//   { value: "line2\n", added: true },                   // 新增
// ]
```

---

### 3.3 状态管理

**新增 Store**: `diff-store.ts`

```typescript
export const useDiffStore = defineStore('diff', () => {
  // State
  const request1 = ref<CaptureRequest | null>(null)
  const request2 = ref<CaptureRequest | null>(null)
  const diffResult = ref<DiffResult | null>(null)
  const activeTab = ref<'overview' | 'requestHeaders' | 'requestBody' | 'responseHeaders' | 'responseBody'>('overview')
  const scrollPositions = ref<Record<string, number>>({})
  
  // Actions
  function setRequests(req1: CaptureRequest, req2: CaptureRequest) { ... }
  function swapRequests() { ... }
  function clear() { ... }
  function saveScrollPosition(containerId: string, position: number) { ... }
  function getScrollPosition(containerId: string): number { ... }
  
  return { /* ... */ }
})
```

#### 3.3.1 状态持久化策略

**问题**: 用户从 Diff 页面返回主页，再重新进入时，希望看到之前的对比结果

**方案**: 多层状态管理

```
┌─────────────────────────────────────────────────────────────┐
│                    状态持久化层级                              │
├─────────────────────────────────────────────────────────────┤
│  1. Pinia Store (内存)                                       │
│     - 当前会话有效                                             │
│     - 页面刷新后丢失                                           │
│     - 存储: request1, request2, diffResult, activeTab         │
│                                                              │
│  2. sessionStorage (标签页)                                   │
│     - 标签页关闭后丢失                                         │
│     - 页面刷新后保留                                           │
│     - 存储: 完整的 diff 结果（避免重新计算）                    │
│     - Key: powercatch:diff-state（避免与其他功能冲突）         │
│                                                              │
│  3. URL Query (地址栏)                                        │
│     - 可分享、可收藏                                           │
│     - 存储: id1, id2（请求 ID）                                │
│                                                              │
│  4. Pinia 订阅 + 自动保存                                      │
│     - Store 变化时自动同步到 sessionStorage                     │
│     - 页面加载时自动从 sessionStorage 恢复                      │
└─────────────────────────────────────────────────────────────┘
```

**实现**:

```typescript
// src/stores/diff-store.ts

const SESSION_KEY = 'powercatch:diff-state'

export const useDiffStore = defineStore('diff', () => {
  // ... state ...

  // 从 sessionStorage 恢复
  function restoreFromSession() {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) {
      const data = JSON.parse(saved)
      request1.value = data.request1
      request2.value = data.request2
      diffResult.value = data.diffResult
      activeTab.value = data.activeTab || 'overview'
      scrollPositions.value = data.scrollPositions || {}
    }
  }

  // 保存到 sessionStorage
  function saveToSession() {
    const data = {
      request1: request1.value,
      request2: request2.value,
      diffResult: diffResult.value,
      activeTab: activeTab.value,
      scrollPositions: scrollPositions.value,
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data))
  }

  // 监听变化自动保存
  watch(
    [request1, request2, diffResult, activeTab, scrollPositions],
    () => saveToSession(),
    { deep: true }
  )

  return { /* ... */ }
})
```

---

#### 3.3.2 页面缓存策略

**问题**: 从 Diff 页面返回主页，再重新进入时，希望页面状态完全保留

**方案**: Vue `<keep-alive>` + 路由 meta

**注意**: 只缓存 DiffView，不缓存 MainView（避免内存占用过高，MainView 有自己的状态管理）

```typescript
// src/router/index.ts

const routes: RouteRecordRaw[] = [
  // 主页（不缓存，使用自己的状态管理）
  {
    path: '/',
    name: 'Main',
    component: () => import('../views/MainView.vue'),
  },
  
  // Diff 页面（缓存状态）
  {
    path: '/diff',
    name: 'DiffView',
    component: () => import('../views/DiffView.vue'),
    meta: { keepAlive: true }
  },
]

// App.vue
<template>
  <div id="app-root" class="h-screen flex flex-col overflow-hidden">
    <!-- 标题栏 -->
    <TitleBar />
    <!-- 路由视图（带 keep-alive） -->
    <router-view v-slot="{ Component }">
      <keep-alive :include="['DiffView']">
        <component :is="Component" class="flex-1 overflow-y-auto" />
      </keep-alive>
    </router-view>
    <!-- 全局 Toast -->
    <ToastContainer />
    <!-- 断点编辑弹窗 -->
    <BreakpointDialog />
  </div>
</template>
```

**效果**:
- ✅ 从 Diff 返回主页：Diff 页面状态保留（不销毁）
- ✅ 从主页重新进入 Diff：Diff 页面状态恢复（不重新创建）
- ✅ 滚动位置、选中状态、Tab 位置完全保留
- ✅ MainView 不受影响，继续使用自己的状态管理

---

#### 3.3.3 滚动位置恢复

**问题**: 用户在 Diff 页面滚动到某个位置，返回主页再回来，希望滚动位置不变

**方案**: 记录 + 恢复滚动位置

```typescript
// src/views/DiffView.vue

onMounted(() => {
  // 恢复滚动位置
  const savedPosition = diffStore.getScrollPosition('main')
  if (savedPosition) {
    nextTick(() => {
      document.querySelector('.diff-content')?.scrollTo(0, savedPosition)
    })
  }
})

onBeforeUnmount(() => {
  // 保存滚动位置
  const position = document.querySelector('.diff-content')?.scrollTop || 0
  diffStore.saveScrollPosition('main', position)
})
```

---

#### 3.3.4 浏览器历史记录管理

**问题**: 用户点击浏览器"后退"按钮，希望返回主页，而不是丢失所有状态

**方案**: Vue Router 历史管理

```typescript
// src/views/DiffView.vue

// 返回主页
function goBack() {
  // 方式 1: router.back() - 返回浏览器历史上一页
  // 方式 2: router.push('/') - 强制返回主页
  
  // 推荐：使用 router.push，并清除 Diff 状态
  diffStore.clear()
  sessionStorage.removeItem('powercatch:diff-state')
  router.push('/')
}

// 支持浏览器后退按钮
onMounted(() => {
  window.addEventListener('popstate', handlePopState)
})

onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState)
})

function handlePopState() {
  // 用户点击浏览器后退按钮
  // 自动返回主页，状态已通过 <keep-alive> 保留
}
```

**URL 设计**:

```
进入 Diff 页面:
  /diff?id1=req-1&id2=req-2
  
  - 支持直接访问（从 URL 读取 id1, id2，加载请求数据）
  - 支持分享链接（其他人打开链接，自动加载对比结果）

返回主页:
  /
  
  - Diff 状态保留在 sessionStorage (powercatch:diff-state)
  - 再次访问 /diff，自动恢复状态
```

---

#### 3.3.5 完整导航流程

```
┌─────────────────────────────────────────────────────────────┐
│                    完整导航流程                                │
├─────────────────────────────────────────────────────────────┤
│  1. 用户在主页勾选 2 个请求                                    │
│     → 复用 requestStore.checkedRequests                      │
│     → 右键菜单 → "对比选中请求"                                │
│     → router.push('/diff?id1=xxx&id2=yyy')                  │
│     → Diff 页面创建，计算 diff 结果                           │
│     → 保存到 Pinia Store + sessionStorage (powercatch:diff-state) │
│                                                              │
│  2. 用户在 Diff 页面查看对比结果                               │
│     → 切换 Tab、滚动页面、查看详情                             │
│     → 所有操作实时保存到 sessionStorage                        │
│                                                              │
│  3. 用户点击"返回"按钮                                         │
│     → router.push('/')                                      │
│     → Diff 页面被 <keep-alive> 缓存（不销毁）                   │
│     → 主页显示（状态保留）                                     │
│                                                              │
│  4. 用户再次点击"对比请求"                                     │
│     → router.push('/diff')                                  │
│     → Diff 页面从 <keep-alive> 恢复（不重新创建）               │
│     → 从 sessionStorage 恢复状态                              │
│     → 滚动位置、Tab 位置完全保留                               │
│                                                              │
│  5. 用户刷新页面（F5）                                        │
│     → Diff 页面重新创建                                       │
│     → mounted() 时从 sessionStorage 恢复状态                   │
│     → 如果 sessionStorage 有数据，直接显示                     │
│     → 如果 sessionStorage 无数据，从 URL 读取 id1, id2 重新加载 │
│                                                              │
│  6. 用户关闭标签页                                            │
│     → sessionStorage 清除                                     │
│     → 下次打开需要重新选择请求对比                              │
└─────────────────────────────────────────────────────────────┘
```

---

#### 3.3.6 状态清除时机

**问题**: 什么时候清除 Diff 状态？

**策略**:

| 时机 | 操作 |
|------|------|
| 用户主动点击"清空" | 清除 Store + sessionStorage |
| 用户选择新请求对比 | 覆盖旧状态 |
| 用户关闭标签页 | 自动清除（sessionStorage 特性） |
| 用户清除浏览器数据 | 自动清除 |
| Diff 页面空闲 > 30 分钟 | 自动清除（可选） |

---

### 3.4 路由设计

**新增路由**: `/diff`

```typescript
{
  path: '/diff',
  name: 'DiffView',
  component: () => import('@/views/DiffView.vue'),
}
```

**传参方式**: URL Query

```
/diff?id1=req-1&id2=req-2
```

---

## 4. UI 设计

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│  Diff 视图                          [清空] [交换] [导出]     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │  请求 1          │    │  请求 2          │              │
│  │  GET /api/users  │    │  POST /api/users │              │
│  │  200 OK (50ms)   │    │  201 Created     │              │
│  └──────────────────┘    └──────────────────┘              │
├─────────────────────────────────────────────────────────────┤
│  [概览] [请求头] [请求体] [响应头] [响应体]                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Diff 内容区域（三色标记）                                    │
│  + 绿色: 新增                                                 │
│  - 红色: 删除                                                 │
│  ~ 黄色: 修改                                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.2 概览 Tab（Overview）

**设计目标**: 快速展示关键差异

**布局**:

```
┌─────────────────────────────────────────────────────────────┐
│  关键差异概览                                                │
├─────────────────────────────────────────────────────────────┤
│  ✅ 相同:                                                    │
│     - URL: /api/users                                       │
│     - Method: POST                                          │
│     - Host: api.example.com                                 │
│                                                              │
│  ⚠️ 不同:                                                   │
│     - Status Code: 200 vs 201                               │
│     - Duration: 50ms vs 120ms                               │
│     - Request Headers: 3 处差异                             │
│     - Response Body: 结构不同                                │
│                                                              │
│  📊 统计:                                                    │
│     - 请求头: +2 / -1 / ~3                                 │
│     - 请求体: JSON 结构不同 (5 处修改)                        │
│     - 响应头: 无差异                                         │
│     - 响应体: +10 / -5 / ~8                                │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.3 请求头/响应头 Tab（Headers）

**设计目标**: 并排对比 Headers

**布局**:

```
┌─────────────────────────────────────────────────────────────┐
│  请求头对比                                                  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │  请求 1          │    │  请求 2          │              │
│  ├──────────────────┤    ├──────────────────┤              │
│  │ + Authorization  │    │ - Authorization  │              │
│  │   Bearer xyz     │    │   Bearer abc     │              │
│  │                  │    │                  │              │
│  │ + Content-Type   │    │ + Content-Type   │              │
│  │   application/json│   │   application/json│              │
│  │                  │    │                  │              │
│  │ - X-Custom-Header│    │                  │              │
│  │   value1         │    │                  │              │
│  └──────────────────┘    └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

**交互**:
- 点击某一行 → 高亮对应行（方便对照）
- 鼠标悬停 → 显示完整值（防止截断）

---

### 4.4 请求体/响应体 Tab（Body）

**JSON 模式**:

```
┌─────────────────────────────────────────────────────────────┐
│  请求体对比 (JSON)                                           │
├─────────────────────────────────────────────────────────────┤
│  {                                                          │
│    "user": {                                                │
│      "id": 123,           ← 相同                            │
│      "name": "Alice",     ← 相同                            │
│ -    "role": "admin",     │ 删除                            │
│ +    "role": "user",      │ 新增                            │
│      "email": "a@b.com"   ← 相同                            │
│    },                                                       │
│ +  "timestamp": 1234567890  │ 新增                          │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

**纯文本模式**:

```
┌─────────────────────────────────────────────────────────────┐
│  响应体对比 (Text)                                           │
├─────────────────────────────────────────────────────────────┤
│  1: <html>                    │ 1: <html>                   │
│  2: <head>                    │ 2: <head>                   │
│ -3: <title>Old</title>       │                             │
│ +3: <title>New</title>       │ 3: <title>New</title>       │
│  4: </head>                   │ 4: </head>                  │
│  ...                         │ ...                         │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.5 交互设计

#### 4.5.1 选择对比请求

**方式 1: 工具下拉菜单（推荐）**

```
工具下拉菜单:
┌─────────────────────────┐
│ 🔴 断点                 │
│ 🗺️ Map Local            │
│ 🔗 Map Remote           │
│ ─────────────────────── │
│ 🆕 Diff 视图            │  ← 新功能（放在工具下）
└─────────────────────────┘

点击后：
- 如果已勾选 2 个请求 → 直接跳转 /diff
- 如果未勾选 2 个请求 → 提示"请先勾选 2 个请求"
```

**方式 2: 右键菜单（辅助）**

```
请求列表右键菜单:
┌─────────────────────────┐
│ 复制 cURL               │
│ 重发请求                │
│ ─────────────────────── │
│ 🆕 对比选中请求          │  ← 新功能
└─────────────────────────┘
```

**方式 3: 快捷键（高级）**

```
Ctrl/Cmd + D → 打开 Diff 视图
```

---

#### 4.5.2 导出 Diff 结果

**支持的格式**:
- HTML 报告（美观，可分享）
- Markdown 表格（可粘贴到文档）
- JSON delta（机器可读）

**交互**: 点击 [导出] 按钮 → 选择格式 → 保存文件

---

## 5. 数据模型

### 5.1 DiffResult

```typescript
interface DiffResult {
  /** 概览统计 */
  overview: {
    same: string[]          // 相同的字段
    different: string[]     // 不同的字段
    stats: {
      requestHeaders: { added: number; removed: number; modified: number }
      requestBody: { changes: number }
      responseHeaders: { added: number; removed: number; modified: number }
      responseBody: { changes: number }
    }
  }
  
  /** 请求头 Diff */
  requestHeaders: {
    added: HttpHeaders
    removed: HttpHeaders
    modified: Array<{ key: string; old: string; new: string }>
  }
  
  /** 请求体 Diff (JSON delta 或文本 diff) */
  requestBody: {
    type: 'json' | 'text' | 'binary'
    delta?: any           // JSON delta
    changes?: DiffChange[] // 文本 diff
  }
  
  /** 响应头 Diff */
  responseHeaders: {
    added: HttpHeaders
    removed: HttpHeaders
    modified: Array<{ key: string; old: string; new: string }>
  }
  
  /** 响应体 Diff */
  responseBody: {
    type: 'json' | 'text' | 'binary'
    delta?: any
    changes?: DiffChange[]
  }
}
```

---

## 6. 实现任务分解

### T1: 数据模型 + Diff 算法（1.5 天）

**文件**:
- `src/services/types.ts` (新增 `DiffResult` 接口)
- `src/services/diff-engine.ts` (新增，Diff 算法核心)
- `src/stores/diff-store.ts` (新增，状态管理)

**验收标准**:
- ✅ `diffHeaders()` 正确识别新增/删除/修改
- ✅ `diffJsonBody()` 使用 `jsondiffpatch` 生成 delta
- ✅ `diffTextBody()` 使用 `diff` 库生成文本 diff
- ✅ Unit tests 覆盖率 > 80%

---

### T2: Diff 视图 UI - 概览 Tab（1 天）

**文件**:
- `src/views/DiffView.vue` (新增)
- `src/components/DiffOverview.vue` (新增)

**验收标准**:
- ✅ 并排显示两个请求的关键信息
- ✅ 概览 Tab 展示差异统计
- ✅ 点击 Tab 切换不同维度

---

### T3: Diff 视图 UI - Headers/Body Tabs（1.5 天）

**文件**:
- `src/components/DiffHeaders.vue` (新增)
- `src/components/DiffBody.vue` (新增)
- `src/components/DiffJsonViewer.vue` (新增，JSON delta 渲染)

**验收标准**:
- ✅ Headers 并排对比，三色标记
- ✅ JSON Body 结构化 diff，可折叠/展开
- ✅ 文本 Body 行级 diff，横向滚动同步

---

### T4: 入口集成 + 路由（0.5 天）

**文件**:
- `src/App.vue` (修改，添加 `<keep-alive :include="['DiffView']">`)
- `src/router/index.ts` (修改，添加 `/diff` 路由)
- `src/components/RecordControl.vue` (修改，添加"Diff 视图"菜单项到工具下拉菜单)
- `src/components/RequestList.vue` (修改，添加右键菜单项)
- `src/views/MainView.vue` (修改，添加 Diff 入口逻辑)

**验收标准**:
- ✅ 工具下拉菜单显示"Diff 视图"选项
- ✅ 右键菜单显示"对比选中请求"
- ✅ 勾选两个请求后可跳转 `/diff`
- ✅ 未勾选 2 个请求时显示提示
- ✅ Diff 视图可返回主界面
- ✅ 复用 `requestStore.checkedRequests` 机制

---

### T5: 导出功能 + polish（0.5 天）

**文件**:
- `src/services/diff-export.ts` (新增，导出 HTML/Markdown/JSON)
- `src/components/DiffView.vue` (修改，添加导出按钮)

**验收标准**:
- ✅ 导出 HTML 报告（美观，可分享）
- ✅ 导出 Markdown 表格
- ✅ 导出 JSON delta

---

## 7. 测试计划

### 7.1 单元测试

**文件**: `src/__tests__/diff/diff-engine.test.ts`

**测试用例**:
- ✅ `diffHeaders()` 测试：新增/删除/修改/相同
- ✅ `diffJsonBody()` 测试：嵌套对象/数组/值修改
- ✅ `diffTextBody()` 测试：多行文本/空文本/特殊字符

---

### 7.2 集成测试

**场景**:
1. 选择两个请求 → 打开 Diff 视图 → 验证概览统计正确
2. 切换 Tab → 验证 Headers/Body 渲染正确
3. 点击"交换"按钮 → 验证请求顺序交换
4. 点击"导出" → 验证生成的文件格式正确

---

### 7.3 边界情况

- ❓ 两个请求完全相同 → 显示"无差异"
- ❓ 一个请求无 Body → 显示"仅存在于请求 1/2"
- ❓ Body 是二进制（如图片）→ 显示"无法对比二进制内容"
- ❓ JSON 格式错误 → 降级到文本 diff

---

## 8. 风险评估

### 8.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `jsondiffpatch` 库体积大（~200KB） | 打包体积增加 | 动态导入（lazy load） |
| 大 JSON（>1MB）diff 性能差 | UI 卡顿 | 限制 diff 大小（>500KB 提示"过大"） |
| 文本 diff 内存占用高 | 崩溃 | 分块 diff（只显示前 1000 行） |

---

### 8.2 体验风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 并排对比在空间小的屏幕上体验差 | 不可用 | 添加"上下布局"切换按钮 |
| Diff 结果复杂，用户看不懂 | 困惑 | 添加"概览"Tab，先显示统计 |

---

## 9. 后续优化

### 9.1 v1.1 (后续版本)

- 🆕 **智能推荐**: 自动推荐"可能想对比"的请求（相同 URL/相似时间）
- 🆕 **批量对比**: 选中多个请求，生成差异矩阵
- 🆕 **历史对比**: 对比当前请求与历史记录（需 #3 会话保存）

---

## 10. 附录

### 10.1 参考实现

- **GitHub PR Diff**: 三色标记 + 行级对比
- **VS Code Diff**: 并排 + 内联模式切换
- **Postman Diff**: JSON 结构化对比

---

### 10.2 依赖库

| 库 | 用途 | 体积 | 替代方案 |
|----|------|------|----------|
| `jsondiffpatch` | JSON diff | ~200KB | `diff` (文本 diff) |
| `diff` | 文本 diff | ~50KB | 手写 LCS 算法 |
| `highlight.js` | 代码高亮 | ~300KB | `prism.js` (更小) |

---

**Plan 版本**: v1.0  
**最后更新**: 2026-06-26  
**下一步**: UI 设计稿 → 架构评审 → 开始实现
