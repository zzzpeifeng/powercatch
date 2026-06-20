# 响应体智能预览 — 详细设计方案

> 功能路线图 #2 · 根据 Content-Type 自动选择预览模式

---

## 1. 现状分析

### 当前实现（`RequestDetail.vue` L126-141）

| 条件 | 渲染方式 | 问题 |
|------|---------|------|
| JSON + 大于 10KB | `vue-json-pretty` 树形（deep=3） | 无法搜索、无法复制路径 |
| JSON + 小于 10KB | 正则高亮 `v-html` | 正则高亮有 XSS 风险、嵌套结构显示差 |
| 非 JSON | `<pre>` 纯文本 | XML/HTML/CSS/JS 无语法高亮 |
| 二进制 | `[Binary Data: N bytes]` 纯文本 | 图片无法预览、Hex 无法查看 |

### 核心问题

1. **二进制数据丢失**：`mitm-server.ts` 的 `decodeResponseBody()` 检测到二进制后返回 `[Binary Data: ...]` 字符串，**原始字节被丢弃**，前端无法做图片预览或 Hex 查看
2. **无 Content-Type 路由**：所有响应体走同一条渲染路径，没有根据 Content-Type 选择最优预览方式
3. **JSON 体验不足**：无搜索、无路径复制、无折叠/展开全部
4. **语法高亮缺失**：XML、HTML、CSS、JS 响应体全部以纯文本显示

---

## 2. 功能设计

### 2.1 预览模式路由

根据 `Content-Type` 响应头自动选择预览模式，同时支持手动切换：

```
Content-Type 检测
├── application/json → JSON 模式（默认）
├── text/html → HTML 模式（渲染预览 + 源码切换）
├── text/xml / application/xml → XML 模式（语法高亮）
├── text/css → CSS 模式（语法高亮）
├── text/javascript / application/javascript → JS 模式（语法高亮）
├── image/* → 图片模式（直接渲染 + 元信息）
├── text/plain → 纯文本模式（自动检测是否为 JSON/XML）
├── 二进制（非图片） → Hex 模式
└── 兜底 → 纯文本模式
```

### 2.2 各模式功能详情

#### JSON 模式（增强）
- 复用现有 `vue-json-pretty`，增加：
  - **搜索框**：输入关键字高亮匹配的 key/value，显示匹配数
  - **路径复制**：点击任意节点复制 JSONPath（如 `$.data.items[0].name`）
  - **展开/折叠全部**按钮
  - **复制完整 JSON** 按钮
  - 大 JSON（>100KB）自动折叠到第 2 层

#### HTML 模式
- **Tab 切换**：渲染预览 ↔ 源码
- 渲染预览：`<iframe>` sandbox 隔离，srcdoc 注入（经 DOMPurify 清洗）
- 源码：Shiki 语法高亮
- 可选：禁用 iframe 内 JS 执行（安全考虑）

#### XML 模式
- Shiki 语法高亮（XML grammar）
- 可折叠标签（点击 `<tag>` 折叠/展开子节点）

#### 图片模式
- 直接 `<img :src="base64Url">` 渲染
- 元信息面板：尺寸（W×H）、文件大小、Content-Type、Base64 长度
- 支持 PNG / JPEG / GIF / WebP / SVG / ICO

#### Hex 模式
- 经典 Hex 视图：左 Hex + 右 ASCII
- 每行 16 字节，偏移量前缀
- 可选高亮：null 字节灰色、可打印 ASCII 绿色

#### 纯文本 / CSS / JS 模式
- Shiki 语法高亮（对应 grammar）
- 行号显示
- 大文本（>50KB）截断 + "加载完整内容" 按钮

### 2.3 二进制数据处理方案（关键架构变更）

**问题**：当前 `decodeResponseBody()` 检测到二进制后返回字符串，原始字节丢失。

**方案**：二进制数据以 Base64 编码存储，添加前缀标识：

```typescript
// mitm-server.ts decodeResponseBody() 改造
if (isLikelyBinary) {
  const contentType = headers['content-type'] || 'unknown'
  // 图片类：Base64 编码，前缀标识
  if (contentType.startsWith('image/')) {
    return `[Base64:${contentType}:${buffer.length}:${buffer.toString('base64')}]`
  }
  // 非图片二进制：Base64 编码（限制 5MB，超出只存元信息）
  if (buffer.length <= 5 * 1024 * 1024) {
    return `[Base64:${contentType}:${buffer.length}:${buffer.toString('base64')}]`
  }
  return `[Binary Data: ${buffer.length} bytes, Content-Type: ${contentType}]`
}
```

**前端解析**：

```typescript
// 新增 src/utils/body-preview-parser.ts（请求体/响应体共用）
interface ParsedBody {
  mode: 'json' | 'html' | 'xml' | 'css' | 'js' | 'image' | 'hex' | 'text' | 'binary-info'
  content: string          // 文本内容 / base64 数据
  meta?: {
    contentType?: string
    size?: number
    isBinary?: boolean
  }
}

function parseResponseBody(body: string, contentType: string): ParsedBody
```

---

## 3. 架构设计

### 3.1 组件结构

```
RequestDetail.vue（改造）
├── 上半区：请求（改造：请求体区域替换为 BodyPreviewRouter）
│   └── BodyPreviewRouter.vue（新增，路由到子组件）
├── 分割线（保持不变）
└── 下半区：响应（改造：响应体区域替换为 BodyPreviewRouter）
    ├── 响应区标题栏（改造：增加预览模式切换器）
    └── BodyPreviewRouter.vue（同上，复用同一组件）
        ├── JsonViewer.vue（新增，增强版 JSON 预览）
        ├── HtmlViewer.vue（新增，HTML 渲染 + 源码切换）
        ├── ImageViewer.vue（新增，图片预览 + 元信息）
        ├── HexViewer.vue（新增，Hex 视图）
        └── CodeViewer.vue（新增，通用语法高亮）
```

> **设计要点**：请求体和响应体共用 `BodyPreviewRouter` + 5 个子组件，通过 props 区分（`body` 数据 + `contentType` + `direction: 'request' | 'response'`），避免代码重复。

### 3.2 数据流

```
mitm-server.ts
  ├── decodeRequestBody() 改造 → 请求体二进制 Base64 编码
  └── decodeResponseBody() 改造 → 响应体二进制 Base64 编码
      └── IPC → request-store
          └── RequestDetail.vue
              ├── 请求体 → body-preview-parser.ts → ParsedBody → BodyPreviewRouter → 子组件路由
              └── 响应体 → body-preview-parser.ts → ParsedBody → BodyPreviewRouter → 子组件路由
```

### 3.3 Content-Type → 预览模式映射

| Content-Type 匹配规则 | 预览模式 | 自动检测 |
|----------------------|---------|---------|
| `application/json` / `+json` | JSON | 是 |
| `text/html` | HTML | — |
| `text/xml` / `application/xml` / `+xml` | XML | — |
| `text/css` | CSS | — |
| `text/javascript` / `application/javascript` | JS | — |
| `image/*` | Image | — |
| `text/plain` | Text | 尝试 JSON.parse → JSON；含 `<` 开头 → XML/HTML |
| `[Base64:...]` 前缀 | Image / Hex | 按 Content-Type 路由 |
| `[Binary Data:...]` 前缀 | Binary Info | — |
| 其他 | Text | — |

### 3.4 预览模式切换器 UI

响应区标题栏右侧增加下拉选择器：

```
┌─────────────────────────────────────────────────┐
│ 响应  200  45ms          [JSON ▾]  [展开全部] [📋]│
├─────────────────────────────────────────────────┤
│  {                                              │
│    "code": 200,                                 │
│    "data": {                                    │
│      ...                                        │
│    }                                            │
│  }                                              │
└─────────────────────────────────────────────────┘
```

- 自动检测的模式为默认选中，用户可手动切换到其他模式
- 切换器右侧根据模式显示不同操作按钮

---

## 4. 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/components/body-preview/BodyPreviewRouter.vue` | 请求/响应体预览路由器，根据 Content-Type 分发到子组件（请求体和响应体共用） |
| `src/components/body-preview/JsonViewer.vue` | 增强版 JSON 预览（搜索 + 路径复制 + 折叠控制） |
| `src/components/body-preview/HtmlViewer.vue` | HTML 渲染预览（iframe sandbox + 源码切换） |
| `src/components/body-preview/ImageViewer.vue` | 图片预览 + 元信息面板 |
| `src/components/body-preview/HexViewer.vue` | Hex 查看器 |
| `src/components/body-preview/CodeViewer.vue` | 通用语法高亮（Shiki Web Worker，支持 XML/CSS/JS/Text） |
| `src/utils/body-preview-parser.ts` | 通用 Body 解析器（Content-Type 路由 + Base64 解码，请求体/响应体共用） |

### 修改文件

| 文件路径 | 改动说明 |
|---------|---------|
| `src/components/RequestDetail.vue` | **请求体区域** + **响应体区域**均替换为 `BodyPreviewRouter` 组件；标题栏增加模式切换器 |
| `electron/proxy/mitm-server.ts` | `decodeResponseBody()` + 请求体二进制处理改造：二进制数据 Base64 编码（图片 + ≤5MB 二进制） |

### 不变文件

- `src/services/types.ts` — `CaptureRequest.responseBody` 和 `requestBody` 仍为 `string` 类型，Base64 数据以 `[Base64:...]` 前缀内嵌
- `src/utils/json-formatter.ts` — 现有工具函数保持不变
- `src/stores/request-store.ts` — 无需改动

---

## 5. 实现顺序（任务列表）

| 序号 | 任务 | 依赖 | 涉及文件 |
|------|------|------|---------|
| T1 | 二进制数据 Base64 编码改造（请求体 + 响应体） | 无 | `mitm-server.ts` |
| T2 | 通用 Body 解析器 `body-preview-parser.ts` | T1 | 新增 |
| T3 | `CodeViewer.vue` 通用语法高亮组件（Shiki Web Worker） | 无 | 新增 |
| T4 | `JsonViewer.vue` 增强版 JSON 预览 | 无 | 新增 |
| T5 | `HtmlViewer.vue` HTML 渲染预览 | T3 | 新增 |
| T6 | `ImageViewer.vue` 图片预览 | T2 | 新增 |
| T7 | `HexViewer.vue` Hex 查看器 | T2 | 新增 |
| T8 | `BodyPreviewRouter.vue` 路由器组件（请求体/响应体共用） | T2-T7 | 新增 |
| T9 | `RequestDetail.vue` 集成改造（请求体 + 响应体均接入） | T8 | 修改 |
| T10 | 全局一致性审查 + 构建 | T9 | — |

---

## 6. 依赖包

| 包 | 用途 | 已安装？ |
|----|------|---------|
| `shiki` | 语法高亮（XML/CSS/JS/HTML） | ✅ 已有 `^4.2.0` |
| `dompurify` | HTML 源码清洗 | ✅ 已有 `^3.4.10` |
| `vue-json-pretty` | JSON 树形预览 | ✅ 已有 `^2.6.0` |

**无需新增依赖。**

---

## 7. 共享知识（跨文件约定）

### 7.1 Base64 前缀格式

```
[Base64:<contentType>:<originalSize>:<base64Data>]
```

示例：
```
[Base64:image/png:10240:iVBORw0KGgoAAAANSUhEUgAA...]
```

### 7.2 预览模式枚举

```typescript
type PreviewMode = 'json' | 'html' | 'xml' | 'css' | 'js' | 'image' | 'hex' | 'text' | 'binary-info'
```

### 7.3 Shiki 高亮器（Web Worker）

`CodeViewer.vue` 在 Web Worker 中初始化 Shiki 高亮器，避免阻塞 UI 渲染。主线程通过 `postMessage` 发送代码片段，Worker 返回高亮 HTML。支持的语言：`json`、`html`、`xml`、`css`、`javascript`。

---

## 8. 性能考量

| 场景 | 策略 |
|------|------|
| 响应体 > 500KB | Shiki 高亮可能卡顿 → 先渲染纯文本，Web Worker 异步高亮 |
| Base64 图片/二进制 > 5MB | 不编码，回退到 `[Binary Data: ...]` 元信息模式 |
| JSON > 1MB | `vue-json-pretty` deep=2 + 提示"数据量较大，已折叠" |
| Hex 视图 > 100KB | 只渲染前 100KB，分页加载 |

---

## 9. 已确认决策

1. **HTML 渲染预览安全性** ✅ 确认
   - iframe 使用 `sandbox="allow-same-origin"`，允许 CSS/图片加载但**完全禁止 JS 执行**
   - 原因：抓包看的是页面结构和样式，不需要 JS 真正执行；禁用 JS 可防止恶意代码利用 Electron 能力访问本地文件系统

2. **Base64 存储上限** ✅ 确认 — **5MB**
   - 调研结论：Charles / Reqable / Fiddler 均**不设单条 body 上限**，全量存储
     - Charles：通过 Recording Size Limits 控制**总量**（非单条），数据存内存/临时文件
     - Reqable：全量存储，支持 JSON/XML/二进制/图片/MultiParts 预览，无单条限制
     - Fiddler：全量存储到内存流
   - PowerCatch 采用 SQLite + Electron IPC，Base64 膨胀 33% 会影响 IPC 传输性能
   - **决策：单条 body 上限 5MB**（Base64 后约 6.7MB），覆盖 99.9% 的图片和 API 响应
   - 超过上限的只存元信息 `[Body too large: N bytes, preview not available]`，不阻塞 IPC
   - 相比 Charles 的总量控制更精细，符合 SQLite 存储特性

3. **Shiki 初始化方式** ✅ 确认 — **使用 Web Worker**
   - Shiki 按需加载 language pack，首次加载有延迟
   - 在 Web Worker 中异步初始化，避免阻塞 UI 渲染
   - 主线程通过 postMessage 发送代码片段，Worker 返回高亮 HTML

4. **请求体智能预览** ✅ 确认 — **做**
   - 请求体和响应体共用同一套预览路由组件（`BodyPreviewRouter.vue`）
   - 请求体现有 JSON 预览替换为智能预览路由
   - 新增 `requestBody` 字段的二进制存储支持（与 `responseBody` 同方案）
