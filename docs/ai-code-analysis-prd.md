# AI 代码分析 — 产品需求文档（PRD）

## 项目信息

| 项 | 值 |
|---|---|
| **项目名称** | PowerCatch · AI 代码分析功能 |
| **技术栈** | Vue 3 Composition API + Pinia + Vue Router (hash) + Tailwind CSS + Electron IPC |
| **语言** | 中文 |
| **文档版本** | v1.0 |
| **原始需求复述** | 用户从抓包请求列表右键选择「AI代码分析」，打开独立视图页面，输入代码仓库链接和 Access Token，AI 读取仓库代码，通过路由注解识别对应接口，分析完整链路逻辑，最终输出多条覆盖不同测试场景的 curl 命令及配套 Python 断言代码 |

---

## 1. 产品目标

| # | 目标 | 说明 |
|---|---|---|
| G1 | **从抓包到测试用例的自动化闭环** | 打通「抓包请求 → 定位源码 → 生成测试用例」链路，将原本需要 30+ 分钟的手动分析压缩到 1 分钟内完成 |
| G2 | **基于真实代码的精准测试入参** | AI 通过读取仓库代码中的路由注解（`@GetMapping`/`@PostMapping` 等）和 DTO 定义，生成符合实际接口签名的测试入参，而非凭空猜测 |
| G3 | **开箱即用的 curl + 断言套件** | 每条 curl 配套一段精简的 Python 断言代码（只断言 JSON 字段，无需 setup/teardown），可直接复制执行，覆盖正常/边界/异常场景 |

---

## 2. 用户故事

| # | 角色 | 故事 |
|---|---|---|
| US1 | 测试工程师 | 作为一个测试工程师，我希望在抓包请求上右键即可发起 AI 代码分析，以便快速定位该接口在代码仓库中的实现并生成测试用例 |
| US2 | 测试工程师 | 作为一个测试工程师，我希望输入代码仓库链接和 Access Token 后系统能记住它们，以便我不用每次重复输入 |
| US3 | 测试工程师 | 作为一个测试工程师，我希望 AI 自动通过路由注解找到接口对应的 Controller 和 Service 代码，以便我看到完整的链路分析（入参、出参、业务逻辑） |
| US4 | 测试工程师 | 作为一个测试工程师，我希望分析结果包含多条覆盖不同场景的 curl 命令，以便我直接复制执行就能完成接口测试 |
| US5 | 测试工程师 | 作为一个测试工程师，我希望每条 curl 都附带 Python 断言代码，以便我快速构建自动化测试脚本 |

---

## 3. 需求池

### P0 — Must Have（核心闭环）

| ID | 需求项 | 描述 | 验收标准 |
|---|---|---|---|
| P0-1 | 右键菜单入口 | 在 `RequestContextMenu.vue` 新增「AI代码分析」菜单项 | 右键请求列表项时菜单中出现该项，点击后跳转分析页 |
| P0-2 | 独立分析视图 | 新增 `/ai-analysis` 路由和 `AiAnalysisView.vue` 视图 | 可通过 URL 直接访问，含 TitleBar 导航入口 |
| P0-3 | 接口信息展示 | 分析页顶部展示选中请求的 method + URL + path | 使用 `method-*` 标签 + URL 文本，信息从路由 query 传入 |
| P0-4 | 仓库配置表单 | 输入仓库链接（GitHub/GitLab）+ Access Token | Token 本地持久化（settings），支持私有仓库 |
| P0-5 | AI 分析执行 | 点击「分析」后，AI 读取仓库代码，识别路由注解，分析链路 | 流式输出分析过程，支持中断 |
| P0-6 | curl 命令生成 | 分析完成后输出多条 curl，覆盖正常/边界/异常场景 | 每条 curl 含真实可用的测试入参 |
| P0-7 | Python 断言生成 | 每条 curl 配套 Python 断言代码 | 只断言 JSON 字段，无 setup/teardown |
| P0-8 | 分析结果展示页 | Tab 切换展示「链路分析」「curl 测试用例」 | 复用 `.tab-bar` / `.tab-item` 样式 |
| P0-9 | 复制功能 | 每条 curl 和 Python 断言可单独复制 | 点击复制按钮，Toast 提示成功 |

### P1 — Should Have（体验增强）

| ID | 需求项 | 描述 | 验收标准 |
|---|---|---|---|
| P1-1 | Token 密码框遮罩 | Access Token 输入框默认遮罩，可切换显示 | 点击眼睛图标切换 `type` |
| P1-2 | 仓库类型自动识别 | 根据输入的 URL 自动识别 GitHub / GitLab | URL 含 `github.com` → GitHub；含 `gitlab.com` → GitLab |
| P1-3 | 分析进度流式展示 | 分析过程中流式展示 AI 输出文本 | 复用现有 `onStreamChunk` 机制 |
| P1-4 | 一键复制全部 | 支持一键复制所有 curl + Python 断言为完整脚本 | 复制后可直接粘贴为 `.py` 文件运行 |
| P1-5 | 历史记录 | 分析结果保存到本地，可查看历史分析 | 复用 SQLite 存储模式 |
| P1-6 | 仓库分支选择 | 支持指定分析哪个分支 | 默认 `main`，可手动输入 |

### P2 — Nice to Have（未来扩展）

| ID | 需求项 | 描述 |
|---|---|---|
| P2-1 | 多语言框架支持 | 支持 Spring Boot（Java）、FastAPI（Python）、Express（Node.js）等路由注解识别 |
| P2-2 | 代码片段展示 | 展示 AI 识别到的 Controller/Service 代码片段，可跳转查看 |
| P2-3 | curl 实际执行 | 在工具内直接执行 curl 并展示响应结果 |
| P2-4 | 导出 pytest 套件 | 将多条 curl + 断言导出为完整 pytest 测试文件 |
| P2-5 | 批量分析 | 选择多个请求批量生成测试用例 |

---

## 4. 功能流程

### 4.1 主流程

```
用户在抓包主页请求列表中右键某条请求
        │
        ▼
┌─────────────────────────┐
│  RequestContextMenu      │
│  点击「AI代码分析」        │
└──────────┬──────────────┘
           │ router.push({ path: '/ai-analysis', query: { method, url, path, requestBody, requestHeaders } })
           ▼
┌─────────────────────────────────────────────┐
│  AiAnalysisView.vue（独立视图）                │
│                                              │
│  ┌─ 接口信息栏 ─────────────────────────┐     │
│  │  [POST] /api/v1/order/create         │     │
│  └──────────────────────────────────────┘     │
│                                              │
│  ┌─ 仓库配置卡片 ───────────────────────┐     │
│  │  仓库链接: [____________________ ▼] │     │
│  │  分  支:  [main__________]          │     │
│  │  Token:   [••••••••] 👁              │     │
│  │              [开始分析]              │     │
│  └──────────────────────────────────────┘     │
│                                              │
│  点击「开始分析」                              │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  Electron 主进程                              │
│                                              │
│  1. 解析仓库 URL → 确定 GitHub/GitLab         │
│  2. 构建 clone URL（HTTP+Token 或 SSH）      │
│  3. git clone --depth 1（shallow clone）      │
│  4. 本地扫描路由文件（正则匹配路由注解）          │
│  5. 匹配接口路径（method + path）              │
│  6. 读取 Controller → Service → DTO 代码       │
│  7. 构建 Prompt，调用 AI 大模型（流式）         │
│  8. AI 输出：链路分析 + 多场景 curl + 断言      │
│                                              │
│  流式 chunk → IPC → 前端实时渲染               │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  分析结果区（Tab 切换）                        │
│                                              │
│  ┌─ Tab: 链路分析 ─┬─ Tab: curl 测试用例 ─┐   │
│  │                │                      │   │
│  │  AI 生成的      │  场景1: 正常入参      │   │
│  │  链路分析文本    │    curl命令           │   │
│  │  （Markdown）   │    Python断言         │   │
│  │                │  场景2: 边界值         │   │
│  │                │    curl命令           │   │
│  │                │    Python断言         │   │
│  │                │  场景3: 异常入参       │   │
│  │                │    ...               │   │
│  └────────────────┴──────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 4.2 详细步骤说明

1. **发起分析**：用户在请求列表右键 → 点击「AI代码分析」→ 路由跳转至 `/ai-analysis`，携带 `method`、`url`、`path`、`requestBody`、`requestHeaders` 作为 query 参数（不需要 `requestId`，AI 分析不依赖 SQLite 存储）
2. **配置仓库**：用户在分析页通过下拉选择或输入仓库链接（如 `https://github.com/org/repo`，输入后自动加入历史记录，下次直接从下拉选择），填写分支（默认 `main`）、Access Token（本地持久化，下次自动填充）、Clone 目录（默认 `~/.powercatch/repos/`）
3. **执行分析**：点击「开始分析」→ 按钮变为 loading 状态 → IPC 调用主进程 → 主进程 shallow clone 仓库 → 本地扫描路由文件 → 构建上下文 → 调用 AI 大模型（流式输出）
4. **结果展示**：AI 流式输出期间，前端实时渲染文本；输出完成后，解析结构化结果，分 Tab 展示「链路分析」和「curl 测试用例」
5. **复制使用**：用户点击 curl / Python 断言旁的复制按钮 → 写入剪贴板 → Toast 提示
6. **清理仓库**（可选）：分析完成后，用户可点击「清理临时仓库」按钮删除 clone 目录

---

## 5. UI 设计稿

### 5.1 右键菜单新增项（RequestContextMenu.vue）

**修改位置**：在「复制为 cURL」菜单项之后、分割线之前新增一项。

```
┌──────────────────────────────────┐
│  🎯  为此请求添加断点           ▶  │  ← 现有
│──────────────────────────────────│  ← 分割线
│  📋  复制 URL                     │  ← 现有
│  📋  复制为 cURL                   │  ← 现有
│  🤖  AI 代码分析                   │  ← ★ 新增
│──────────────────────────────────│  ← 分割线
│  🗑️  删除此请求                    │  ← 现有
└──────────────────────────────────┘
```

**组件结构**：
- 在 `<div class="menu-item" @click="handleCopyCurl">` 之后新增 `<div class="menu-item" @click="handleAiAnalysis">`
- 图标使用 `🤖`（与现有菜单项使用 emoji 图标的风格一致）
- 点击后调用 `router.push({ path: '/ai-analysis', query: { ... } })` 并 `handleClose()`

**交互细节**：
- hover 时背景变为 `var(--bg-secondary)` （复用现有 `.menu-item:hover` 样式）
- 点击后菜单关闭，同时跳转路由

**配色**：完全复用现有菜单样式，无需新增配色。

---

### 5.2 AI 代码分析配置页（AiAnalysisView.vue）

**页面整体结构**：顶部 TitleBar + 居中内容区（`max-w-4xl mx-auto`），参考 SettingsView 的居中布局模式但更宽。

```
┌─────────────────────────────────────────────────────────────┐
│  TitleBar:  PowerCatch        [主页]  [🤖 AI分析]  [⚙ 设置]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ 接口信息卡片 ─────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  [POST]  /api/v1/order/create                          │  │
│  │  完整URL: https://api.example.com/api/v1/order/create  │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ 仓库配置卡片 ─────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  代码仓库（下拉选择，历史记录自动填充）                   │  │
│  │  ┌──────────────────────────────────────┐  ┌────────┐  │  │
│  │  │ https://github.com/org/repo        ▼ │  │ GitHub │  │  │
│  │  └──────────────────────────────────────┘  └────────┘  │  │
│  │  ┌─ 下拉历史 ────────────────────────┐    │             │  │
│  │  │ 🔗 https://github.com/org/repo    │    │             │  │
│  │  │ 🔗 https://gitlab.com/team/api    │    │             │  │  │
│  │  │ 🔗 https://github.com/org/payment │    │             │  │
│  │  └───────────────────────────────────┘    │             │  │
│  │  (输入新URL或从历史选择，输入后自动加入历史，右侧显示类型) │  │
│  │                                                        │  │
│  │  分支                                                   │  │
│  │  ┌──────────────────────┐                              │  │
│  │  │ main                 │                              │  │
│  │  └──────────────────────┘                              │  │
│  │                                                        │  │
│  │  Access Token (私有仓库需要)                             │  │
│  │  ┌──────────────────────────────────────┐  ┌────────┐  │  │
│  │  │ ••••••••••••••••••••••••••••        │  │  👁    │  │  │
│  │  └──────────────────────────────────────┘  └────────┘  │  │
│  │  (密码遮罩，点击眼睛图标切换显示)                         │  │
│  │                                                        │  │
│  │                          ┌──────────────┐ ┌──────────┐ │  │
│  │                          │  开始分析     │ │  返回主页 │ │  │
│  │                          └──────────────┘ └──────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ 分析中状态（v-if analyzing）──────────────────────────┐  │
│  │  ⏳ AI 正在分析代码...                                   │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │  (流式输出文本实时渲染)                          │    │  │
│  │  │  正在读取 Controller 文件...                      │    │  │
│  │  │  找到匹配路由: @PostMapping("/order/create")      │    │  │
│  │  │  正在分析 Service 层逻辑...                       │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │                            ┌──────────┐                │  │
│  │                            │  中断分析  │                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**组件层级**：
```
AiAnalysisView.vue
├── TitleBar.vue（已有组件，需新增导航按钮）
├── 接口信息卡片（.card）
│   ├── HTTP 方法标签（.method-post 等）
│   └── URL 文本
├── 仓库配置卡片（.card）
│   ├── .label + 自定义下拉组件（仓库链接，支持历史记录）+ badge（仓库类型）
│   ├── .label + .input（分支）
│   ├── .label + .input type=password（Token）+ 切换按钮
│   └── .btn-primary（开始分析）+ .btn-secondary（返回主页）
└── 分析中状态区（.card，v-if="analyzing"）
    ├── spinner + 状态文字
    ├── 流式输出文本区（.md-content 或 pre）
    └── .btn-danger（中断分析）
```

**交互细节**：

| 元素 | 交互 | 效果 |
|---|---|---|
| 仓库链接下拉框 | 点击/聚焦时展开历史列表 | 显示已保存的仓库URL列表，点击选中填充；输入新URL时实时过滤；选中或输入后自动识别仓库类型 → 右侧 badge 显示「GitHub」/「GitLab」 |
| 仓库历史记录 | 输入新URL并发起分析后 | 自动将新URL加入历史列表（去重），持久化到本地 settings；最多保留 20 条 |
| Token 输入框 | 默认 `type="password"` | 点击 👁 图标切换为 `type="text"`，图标变为 👁‍🗨 |
| 「开始分析」按钮 | 点击 → `analyzing = true` | 按钮 disabled + spinner；下方显示分析中状态区 |
| 「中断分析」按钮 | 点击 → 取消 AI 请求 | `analyzing = false`，恢复配置卡片状态 |
| 「返回主页」按钮 | 点击 → `router.push('/')` | — |
| 流式输出 | `onStreamChunk` 回调 | 文本逐字追加到 `<pre>` 或 `.md-content` 区域，自动滚动到底部 |

**配色方案**（全部使用 CSS 变量）：

| 元素 | 属性 | 值 |
|---|---|---|
| 页面背景 | background | `var(--color-bg)` |
| 卡片背景 | background | `var(--color-surface)` |
| 卡片边框 | border | `1px solid var(--color-border)` |
| 卡片阴影 | box-shadow | `var(--shadow-sm)` |
| 主按钮 | background | `var(--color-primary)` |
| 主按钮 hover | background | `var(--color-primary-hover)` |
| 次按钮 | — | `.btn-secondary` |
| 输入框 | — | `.input` 全局类 |
| 标签文字 | color | `var(--color-text-secondary)` |
| 接口方法标签 | — | `.method-post` / `.method-get` 等全局类 |
| 仓库类型 badge | — | `.badge .badge-info` |
| 流式输出文本 | color | `var(--color-text)` |
| 分析中状态文字 | color | `var(--color-text-secondary)` |
| 中断按钮 | — | `.btn-danger` |
| spinner | — | `.spinner .spinner-dark` |

---

### 5.3 分析结果页（结果区，同一视图内 Tab 切换）

分析完成后，分析中状态区替换为结果展示区，使用 Tab 切换两个视图。

```
┌─────────────────────────────────────────────────────────────┐
│  TitleBar                                                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─ 接口信息卡片（同上，始终展示）─────────────────────────┐  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─ 结果展示卡片 ─────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  ┌─ Tab Bar ──────────────────────────────────────┐    │  │
│  │  │  [链路分析]   [curl 测试用例]                    │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │                                                        │  │
│  │  ═══ Tab 1: 链路分析 ═══                                │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │  ## 接口路由                                    │    │  │
│  │  │  @PostMapping("/api/v1/order/create")           │    │  │
│  │  │  Controller: OrderController.createOrder()      │    │  │
│  │  │                                                │    │  │
│  │  │  ## 入参分析                                    │    │  │
│  │  │  - userId (Long, 必填): 用户ID                  │    │  │
│  │  │  - productId (String, 必填): 商品ID             │    │  │
│  │  │  - quantity (Integer, 可选, 默认1): 数量        │    │  │
│  │  │                                                │    │  │
│  │  │  ## 出参分析                                    │    │  │
│  │  │  { orderId, status, createTime }               │    │  │
│  │  │                                                │    │  │
│  │  │  ## 业务逻辑链路                                │    │  │
│  │  │  1. 参数校验 → 2. 查询商品 →                    │    │  │
│  │  │  3. 创建订单 → 4. 返回结果                      │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │                                                        │  │
│  │  ═══ Tab 2: curl 测试用例 ═══                          │  │
│  │                                                        │  │
│  │  ┌─ 场景 1: 正常入参 ────────────────────────────┐     │  │
│  │  │  [正常]                                     📋复制 │     │  │
│  │  │  ┌─── curl ───────────────┬─── Python 断言 ──────┐ │     │  │
│  │  │  │ curl -X POST 'https://..│ # 断言正常场景      │ │     │  │
│  │  │  │   -H 'Content-Type: ...│ assert response...  │ │     │  │
│  │  │  │   -d '{"userId":1001..│ data = response...  │ │     │  │
│  │  │  │                        │ assert "orderId"... │ │     │  │
│  │  │  └────────────────────────┴─────────────────────┘ │     │  │
│  │  │                    📋复制curl    📋复制断言        │     │  │
│  │  └────────────────────────────────────────────────┘     │  │
│  │                                                        │  │
│  │  ┌─ 场景 2: 边界值（quantity=0）─────────────────┐     │  │
│  │  │  [边界值]                                   📋复制 │     │  │
│  │  │  ┌─── curl ───────────────┬─── Python 断言 ──────┐ │     │  │
│  │  │  │ ...                    │ ...                  │ │     │  │
│  │  │  └────────────────────────┴─────────────────────┘ │     │  │
│  │  └────────────────────────────────────────────────┘     │  │
│  │                                                        │  │
│  │  ┌─ 场景 3: 异常入参（缺少必填字段）──────────────┐     │  │
│  │  │  [异常]                                     📋复制 │     │  │
│  │  │  ┌─── curl ───────────────┬─── Python 断言 ──────┐ │     │  │
│  │  │  │ ...                    │ ...                  │ │     │  │
│  │  │  └────────────────────────┴─────────────────────┘ │     │  │
│  │  └────────────────────────────────────────────────┘     │  │
│  │                                                        │  │
│  │              ┌────────────────────┐ ┌────────────────┐ │  │
│  │              │ 📋 复制全部用例     │ │ 🔄 重新分析    │ │  │
│  │              └────────────────────┘ └────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**组件层级**：
```
结果展示卡片（.card）
├── Tab Bar（.tab-bar）
│   ├── .tab-item.active（链路分析）
│   └── .tab-item（curl 测试用例）
│
├── Tab 1: 链路分析面板（v-show="activeTab === 'analysis'"）
│   └── .md-content（Markdown 渲染，复用现有 Markdown 渲染样式）
│
└── Tab 2: curl 测试用例面板（v-show="activeTab === 'curls'"）
    ├── TestScenarioCard.vue（每个场景一个子组件，v-for 循环）
    │   ├── 场景标题 + badge（.badge-info / .badge-warning / .badge-error）+ 复制全部按钮
    │   ├── 左右布局容器（flex gap-3）
    │   │   ├── 左侧：curl 代码块（pre + code）+ 📋 复制 curl 按钮
    │   │   └── 右侧：Python 断言代码块（pre + code）+ 📋 复制断言按钮
    ├── 分割线
    └── 底部操作栏
        ├── .btn-secondary（复制全部用例）
        └── .btn-secondary（重新分析）
```

**新增子组件 TestScenarioCard.vue**（可独立提取，也可内联）：

```vue
<!-- 结构示意：左右布局，左 curl 右 Python 断言 -->
<div class="scenario-card card p-4 mb-3">
  <!-- 场景标题 -->
  <div class="flex items-center justify-between mb-3">
    <div class="flex items-center gap-2">
      <span class="badge badge-info">{{ scenario.type }}</span>
      <span class="text-sm font-medium">{{ scenario.title }}</span>
    </div>
    <button class="btn btn-sm btn-ghost" @click="copyAll">📋 复制全部</button>
  </div>
  <!-- 左右布局：curl | Python 断言 -->
  <div class="flex gap-3">
    <!-- 左侧：curl -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium" style="color: var(--color-text-secondary)">cURL</span>
        <button class="btn btn-sm btn-ghost" @click="copyCurl">📋 复制</button>
      </div>
      <pre class="code-block text-sm overflow-x-auto">
        <code>{{ scenario.curl }}</code>
      </pre>
    </div>
    <!-- 右侧：Python 断言 -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium" style="color: var(--color-text-secondary)">Python 断言</span>
        <button class="btn btn-sm btn-ghost" @click="copyPython">📋 复制</button>
      </div>
      <pre class="code-block text-sm overflow-x-auto">
        <code>{{ scenario.pythonAssertion }}</code>
      </pre>
    </div>
  </div>
</div>
```

**交互细节**：

| 元素 | 交互 | 效果 |
|---|---|---|
| Tab 切换 | 点击 Tab 标题 | `activeTab` 切换，`.tab-item.active` 样式高亮（`var(--color-primary)` 下边框） |
| 链路分析内容 | Markdown 渲染 | 复用 `.md-content` 样式体系 |
| curl 代码块 | 只读展示 | `<pre><code>` 深色背景，等宽字体 |
| 「📋 复制 curl」 | 点击 → `navigator.clipboard.writeText()` | Toast「curl 已复制」 |
| 「📋 复制断言」 | 点击 → `navigator.clipboard.writeText()` | Toast「断言代码已复制」 |
| 「复制全部用例」 | 点击 → 拼接所有 curl + 断言 | Toast「全部用例已复制」 |
| 「重新分析」 | 点击 → 清空结果 → 回到配置页 | `result = null`，`analyzing = false` |
| 场景 badge | 按场景类型着色 | 正常 → `.badge-success`；边界值 → `.badge-warning`；异常 → `.badge-error` |

**配色方案**：

| 元素 | 属性 | 值 |
|---|---|---|
| Tab 选中文字 | color | `var(--color-primary)` |
| Tab 选中下边框 | border-bottom | `2px solid var(--color-primary)` |
| Tab 未选中文字 | color | `var(--color-text-secondary)` |
| 代码块背景（亮色） | background | `bg-gray-50`（`#f9fafb`） |
| 代码块背景（暗色） | background | `bg-gray-800`（`var(--color-surface)` 加深） |
| 代码块文字 | color | `var(--color-text)` |
| 代码块字体 | font-family | `'SF Mono', 'Fira Code', Menlo, Consolas, monospace` |
| 场景卡片 | — | `.card` 全局类 |
| 正常场景 badge | — | `.badge .badge-success` |
| 边界值 badge | — | `.badge .badge-warning` |
| 异常场景 badge | — | `.badge .badge-error` |
| 复制按钮 | — | `.btn .btn-sm .btn-ghost` |
| 底部操作按钮 | — | `.btn .btn-secondary` |

---

### 5.4 TitleBar 导航新增

在 `TitleBar.vue` 的右侧导航区，在「主页」和「⚙ 设置」之间新增「🤖 AI分析」按钮：

```html
<button
  class="px-3 py-1 text-xs rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors leading-none"
  @click="router.push('/ai-analysis')"
  :class="{ 'text-primary-600 dark:text-primary-400 bg-blue-50 dark:bg-blue-900': route.path === '/ai-analysis' }"
>
  🤖 AI分析
</button>
```

---

## 6. 数据模型设计

### 6.1 新增类型定义（`src/services/types.ts`）

```typescript
/** 仓库类型 */
export type RepoType = 'github' | 'gitlab'

/** 仓库配置 */
export interface RepoConfig {
  /** 仓库链接，如 https://github.com/org/repo */
  repoUrl: string
  /** 仓库类型（自动识别） */
  repoType: RepoType
  /** 分支名，默认 main */
  branch: string
  /** Access Token（私有仓库需要） */
  accessToken: string
  /** 仓库 URL 历史记录（本地持久化，下拉选择用，最多20条） */
  repoUrlHistory: string[]
}

/** AI 代码分析请求参数 */
export interface CodeAnalysisRequest {
  /** 选中的抓包请求信息 */
  request: {
    method: HttpMethod
    url: string
    path: string
    /** 请求体（POST/PUT 等可能有） */
    requestBody?: string
  }
  /** 仓库配置 */
  repo: RepoConfig
  /** AI 配置（从 settings 获取） */
  aiConfig: {
    apiUrl: string
    apiKey: string
    modelName: string
  }
}

/** 单个测试场景 */
export interface TestScenario {
  /** 场景类型 */
  type: '正常' | '边界值' | '异常'
  /** 场景标题 */
  title: string
  /** 场景描述 */
  description: string
  /** curl 命令 */
  curl: string
  /** Python 断言代码（只断言 JSON 字段） */
  pythonAssertion: string
}

/** AI 代码分析结果 */
export interface CodeAnalysisResult {
  /** 接口路由信息（如 @PostMapping 路径） */
  routeInfo: string
  /** 链路分析（Markdown 格式） */
  analysis: string
  /** 测试场景列表 */
  scenarios: TestScenario[]
  /** 使用的模型名 */
  modelName: string
  /** 分析时间 */
  analyzedAt: string
}

/** AppSettings 扩展字段 */
// 在现有 AppSettings 中新增:
//   /** AI 代码分析 - 仓库配置（本地持久化） */
//   aiCodeAnalysisConfig?: {
//     repoUrl: string
//     branch: string
//     accessToken: string
//     repoUrlHistory: string[]
//   }
```

### 6.2 IPC 通道新增（`src/services/types.ts` 的 `IPC_CHANNELS`）

```typescript
// 在 IPC_CHANNELS 中新增:
// AI 代码分析
AI_CODE_ANALYZE: 'ai:code-analyze',          // 发起分析（流式）
AI_CODE_ANALYSIS_CHUNK: 'ai:code-analysis-chunk',  // 流式 chunk
AI_CODE_ANALYSIS_END: 'ai:code-analysis-end',      // 流式结束
AI_CODE_ANALYSIS_ABORT: 'ai:code-analysis-abort',  // 中断分析
AI_REPO_CLEANUP: 'ai:repo-cleanup',            // 清理临时仓库
```

### 6.3 IPC 层扩展（`src/services/ipc.ts`）

```typescript
// 在 ipc 对象中新增 aiCodeAnalysis 命名空间:
aiCodeAnalysis: {
  /** 发起代码分析（流式） */
  analyze: async (request: CodeAnalysisRequest): Promise<{ success: boolean; error?: string }> => {
    const api = getElectronAPI()
    if (!api) return { success: false, error: 'Not in Electron environment' }
    return api.aiCodeAnalysis.analyze(JSON.parse(JSON.stringify(request)))
  },

  /** 流式 chunk 监听 */
  onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
    const api = getElectronAPI()
    if (!api) return () => {}
    return api.aiCodeAnalysis.onStreamChunk(callback)
  },

  /** 流式结束监听 */
  onStreamEnd: (callback: (result: CodeAnalysisResult) => void): (() => void) => {
    const api = getElectronAPI()
    if (!api) return () => {}
    return api.aiCodeAnalysis.onStreamEnd(callback)
  },

  /** 中断分析 */
  abort: async (): Promise<{ success: boolean }> => {
    const api = getElectronAPI()
    if (!api) return { success: false }
    return api.aiCodeAnalysis.abort()
  },

  /** 清理临时仓库 */
  cleanupRepo: async (repoName: string): Promise<{ success: boolean; error?: string }> => {
    const api = getElectronAPI()
    if (!api) return { success: false, error: 'Not in Electron environment' }
    return api.aiCodeAnalysis.cleanupRepo(repoName)
  },
}
```

### 6.4 新增 Store（`src/stores/ai-analysis-store.ts`）

```typescript
export const useAiAnalysisStore = defineStore('aiAnalysis', () => {
  // ===== State =====
  const analyzing = ref(false)           // 是否正在分析
  const streamContent = ref('')          // 流式输出文本
  const result = ref<CodeAnalysisResult | null>(null)  // 分析结果
  const error = ref<string | null>(null) // 错误信息
  const repoConfig = ref<RepoConfig>({    // 仓库配置（持久化）
    repoUrl: '',
    repoType: 'github',
    branch: 'main',
    accessToken: '',
    repoUrlHistory: [],  // 仓库URL历史记录
  })

  // ===== Actions =====
  /** 加载持久化的仓库配置 */
  async function loadConfig() { ... }

  /** 保存仓库配置到 settings */
  async function saveConfig() { ... }

  /** 将当前 repoUrl 加入历史记录（去重，最多20条） */
  async function addRepoUrlToHistory() { ... }

  /** 发起分析 */
  async function startAnalysis(request: CodeAnalysisRequest) { ... }

  /** 中断分析 */
  async function abortAnalysis() { ... }

  /** 重置状态 */
  function reset() { ... }

  return { analyzing, streamContent, result, error, repoConfig,
           loadConfig, saveConfig, addRepoUrlToHistory, startAnalysis, abortAnalysis, reset }
})
```

---

## 7. 技术方案概要

### 7.1 前端文件规划

```
src/
├── router/index.ts                    # 新增 /ai-analysis 路由
├── views/AiAnalysisView.vue           # ★ 新增：AI 分析主视图
├── components/
│   ├── TitleBar.vue                   # 修改：新增导航按钮
│   ├── RequestContextMenu.vue         # 修改：新增菜单项
│   └── TestScenarioCard.vue           # ★ 新增：测试场景卡片组件
├── stores/ai-analysis-store.ts        # ★ 新增：分析状态管理
├── services/
│   ├── types.ts                       # 修改：新增类型 + IPC 通道
│   └── ipc.ts                         # 修改：新增 aiCodeAnalysis 命名空间
└── utils/
    └── curl-generator.ts              # 复用：参考现有 curl 生成逻辑
```

### 7.2 Electron 主进程新增能力

```
electron/
├── services/
│   ├── ai-service.ts                  # 修改：新增 executeCodeAnalysis() 函数
│   └── repo-service.ts                # ★ 新增：仓库代码获取服务
├── ipc.ts                             # 修改：注册新 IPC 通道
└── preload.ts                         # 修改：暴露 aiCodeAnalysis API
```

**`repo-service.ts` 核心职责**：
1. 根据 `repoUrl` 判断 GitHub / GitLab
2. 构建 clone URL（HTTP + Token 拼接：`https://<token>@github.com/...` 或 `https://oauth2:<token>@gitlab.com/...`）
3. 执行 `git clone --depth 1 --single-branch -b {branch} {cloneUrl} {localPath}`（shallow clone）
4. 本地扫描路由文件（正则匹配路由注解：`@GetMapping` / `@PostMapping` / `.GET()` / `.POST()` 等）
5. 匹配接口路径（method + path），定位 handler 函数
6. 解析 import 链，提取 Service / Model / DTO 文件路径
7. 读取相关文件内容，返回代码片段供 AI 分析
8. 提供 `cleanupRepo(repoName)` 函数删除临时 clone 目录

**`ai-service.ts` 新增函数**：
```typescript
export async function executeCodeAnalysis(
  request: CodeAnalysisRequest,
  onChunk?: (chunk: string) => void,
  onEnd?: (result: CodeAnalysisResult) => void
): Promise<CodeAnalysisResult>
```

### 7.3 AI Prompt 设计思路

**系统 Prompt**：
```
你是一个资深的后端代码分析专家和接口测试工程师。
你的任务是：根据给定的接口信息和仓库代码，分析接口的完整链路逻辑，
并生成多条覆盖不同测试场景的 curl 命令和 Python 断言代码。
```
**Prompt 构建器（`prompt-builder.ts`）**：

Prompt 采用「基础 + 动态扩展」策略，由 `prompt-builder.ts` 统一构建：

1. **基础 Prompt**：任务描述、输出格式（JSON）、测试场景要求（正常/边界/异常）、通用规则（追踪函数调用链、识别入参出参）
2. **Go 扩展**（检测到 `go.mod` 时拼接）：路由模式（gin/echo/fiber/chi/net/http）、import 路径解析、`internal/` 项目结构、DTO 识别（struct + json tag）
3. **Java 扩展**（检测到 `pom.xml`/`build.gradle` 时拼接）：路由模式（@GetMapping/@PostMapping/@RequestMapping）、包结构解析、DTO 识别（@JsonProperty/@Data）

Prompt 构建函数：
```typescript
buildAnalysisPrompt(
  method: HttpMethod,
  path: string,
  requestBody: string,
  requestHeaders: HttpHeaders,
  codeSnippets: { file: string; content: string }[]
): string
```


**用户 Prompt 结构**：
```
## 接口信息
- 方法: {method}
- 路径: {path}
- 完整URL: {url}
- 请求体（如有）: {requestBody}
- 请求头（如有）: {requestHeaders}

## 仓库代码上下文
{AI 从本地 clone 目录读取的 Controller / Service / DTO 代码片段}

## 输出要求
请按以下 JSON 格式输出（不要输出其他内容）：

{
  "routeInfo": "接口路由注解信息",
  "analysis": "链路分析（Markdown 格式，包含：路由定位、入参分析、出参分析、业务逻辑链路）",
  "scenarios": [
    {
      "type": "正常",
      "title": "场景标题",
      "description": "场景说明",
      "curl": "完整的 curl 命令（使用真实可用的测试入参，保留原始请求头）",
      "pythonAssertion": "Python 断言代码（只断言 JSON 字段，不含 setup/teardown，使用 requests 库）"
    },
    // ... 至少 3 个场景：正常、边界值、异常
  ]
}

注意：
1. curl 命令必须使用接口的实际 URL 和正确的请求方法，保留原始请求头（Cookie/Bearer Token 等）
2. 测试入参以抓包请求参数为基线，结合代码中的 DTO 定义生成，符合字段类型和约束
3. Python 断言只断言响应 JSON 的字段存在性和值，不需要完整的 pytest 套件
4. 至少生成 3 个场景：正常入参、边界值、异常入参（如缺少必填字段）
```

**流式处理**：
- AI 输出采用流式（复用现有 `onStreamChunk` 机制）
- 流式输出期间前端实时渲染文本
- 流式结束后，解析最终 JSON 结果为 `CodeAnalysisResult` 结构
- 若 AI 输出不是纯 JSON，使用正则提取 JSON 块进行解析

### 7.4 Clone 实现细节

**Clone URL 构建**：

```typescript
// GitHub: https://<token>@github.com/{owner}/{repo}.git
const cloneUrl = repoType === 'github' 
  ? `https://${accessToken}@${new URL(repoUrl).host}/${owner}/${repo}.git`
  : `https://oauth2:${accessToken}@${new URL(repoUrl).host}/${owner}/${repo}.git`
```

**Git 命令执行**（使用 `child_process.execFile`，无需新增 npm 依赖）：

```typescript
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

async function cloneRepo(
  repoUrl: string, 
  accessToken: string, 
  branch: string, 
  cloneDir: string
): Promise<{ success: boolean; error?: string }> {
  const repoName = extractRepoName(repoUrl)
  const timestamp = Date.now()
  const localPath = path.join(cloneDir || defaultCloneDir(), `${repoName}-${timestamp}`)
  const cloneUrl = buildCloneUrl(repoUrl, accessToken)  // 如上构建
  
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', '-b', branch, cloneUrl, localPath], {
      timeout: 120_000,  // 120 秒超时
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },  // 禁止 git 弹出凭证输入框
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.stderr || err.message }
  }
}
```

**本地路由扫描**（正则模式，详见架构文档附录 B）：

```typescript
// 1. 扫描所有 .go/.java 文件，匹配路由注册
const routeFiles = scanFiles(localPath, /\.(go|java)$/)
const matchedRoutes: { file: string; handler: string }[] = []
for (const file of routeFiles) {
  const content = fs.readFileSync(file, 'utf-8')
  // 匹配 Gin: r.POST("/path", handler)
  const matches = content.matchAll(/\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']/g)
  for (const m of matches) {
    const [_, method, routePath] = m
    // 重建完整路径（处理 Group 前缀）
    const fullPath = rebuildFullPath(file, routePath)
    if (matchRequestPath(fullPath, requestMethod, requestPath)) {
      matchedRoutes.push({ file, handler: extractHandlerName(content, m.index) })
    }
  }
}

// 2. 读取 handler 文件，提取入参 DTO
// 3. 解析 import，追踪 Service/Model 文件（限制 15 个文件）
// 4. 返回代码片段供 AI 分析
```

**SSH 方式**（可选，高级用户）：

```typescript
// SSH URL 不需要 Token，使用本机已配置的 SSH Key
const cloneUrl = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`
// 执行 git clone（不拼接 Token）
await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', '-b', branch, cloneUrl, localPath])
// 失败原因通常是 SSH Key 未配置或权限不足，错误信息直接来自 git stderr
```

### 7.5 错误处理策略

| 错误场景 | 处理方式 |
|---|---|
| 仓库 URL 无效 | 前端校验 + Toast 提示「请输入有效的仓库链接」 |
| Token 无效/权限不足 | 主进程捕获 `git clone` stderr（如 `Authentication failed`）→ 返回错误信息 → Toast 提示 |
| 仓库不存在 | `git clone` 返回 `repository not found` → Toast 提示「仓库不存在或无访问权限」 |
| 仓库中未找到匹配接口 | AI 分析后 routeInfo 为空 → 展示「未在仓库中找到匹配此接口的代码」 |
| AI 调用超时 | 120 秒超时（clone 可能耗时较长）→ Toast 提示「分析超时，请重试」 |
| AI 输出解析失败 | 尝试正则提取 JSON → 失败则展示原始文本 + 提示「结果解析失败」 |
| git 未安装 | 主进程检测 `git --version` → 失败则返回错误 → Toast 提示「本机未安装 git，请先安装」 |
| Clone 超时 | 120 秒超时 → Toast 提示「Clone 超时，请检查网络或减小仓库大小」 |

---

## 8. 待确认问题

| # | 问题 | 影响范围 | 建议 |
|---|---|---|---|
| Q1 | **仓库代码获取范围**：AI 需要读取多少代码？是只读 Controller 文件，还是需要递归读取 Service → Mapper → DTO 的完整链路？ | Prompt 设计、token 消耗、分析耗时 | 建议 P0 只读 Controller + 同目录 DTO，P1 支持递归读取 Service 层 |
| Q2 | **支持的框架范围**：当前需求提到 `@GetMapping`/`@PostMapping`，是否需要同时支持其他框架（如 FastAPI 的 `@app.get`、Express 的 `router.get`）？ | repo-service.ts 的代码搜索逻辑 | 建议 P0 聚焦 Spring Boot（Java/Kotlin），P2 扩展其他框架 |
| Q3 | **curl 的目标地址**：生成的 curl 是使用抓包请求的原始 URL（如 `https://api.example.com/...`），还是使用本地代理地址？ | curl 生成逻辑 | 建议使用抓包请求的原始 URL，用户可自行修改 |
| Q4 | **Token 安全性**：Access Token 存储在 Electron 的 settings（明文 JSON），是否需要加密存储？ | settings 存储方式 | P0 明文存储（与现有 apiKey 一致），P2 考虑 keychain 加密 |
| Q5 | **分析结果是否需要持久化**：分析完成后结果是否保存到本地数据库，支持查看历史分析记录？ | 数据库表设计、P1-5 历史记录功能 | P0 不持久化（仅当前会话有效），P1 新增 SQLite 表存储 |
| Q6 | **AI 输出格式保证**：如何保证 AI 输出的 JSON 格式正确可解析？是否需要做 fallback（展示原始文本）？ | 前端结果解析逻辑 | 建议流式展示原始文本，结束后尝试 JSON 解析，失败则保留文本展示 |
| Q7 | **大仓库性能**：如果仓库文件很多（如 1000+ 文件），文件树搜索是否需要限制范围或超时？ | repo-service.ts 性能 | 建议限制只搜索 `src/main/java/**/*Controller*.java` 路径，设置 30 秒超时 |
| Q8 | **请求体参数复用**：如果抓包请求本身有 requestBody，AI 分析时是否将原始请求体作为参考传入？ | CodeAnalysisRequest 设计 | 建议传入，帮助 AI 理解实际入参格式 |

---

## 附录 A：路由配置变更

```typescript
// src/router/index.ts 新增
{
  path: '/ai-analysis',
  name: 'AiAnalysis',
  component: () => import('../views/AiAnalysisView.vue'),
}
```

## 附录 B：preload.ts 暴露的 API 结构

```typescript
// electron/preload.ts 新增
aiCodeAnalysis: {
  analyze: (request: CodeAnalysisRequest) => ipcRenderer.invoke('ai:code-analyze', request),
  onStreamChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('ai:code-analysis-chunk', (_e, chunk) => callback(chunk))
    return () => ipcRenderer.removeAllListeners('ai:code-analysis-chunk')
  },
  onStreamEnd: (callback: (result: CodeAnalysisResult) => void) => {
    ipcRenderer.on('ai:code-analysis-end', (_e, result) => callback(result))
    return () => ipcRenderer.removeAllListeners('ai:code-analysis-end')
  },
  abort: () => ipcRenderer.invoke('ai:code-analysis-abort'),
}
```

## 附录 C：完整使用流程示例

```
1. 用户启动 PowerCatch，开始抓包
2. 捕获到 POST /api/v1/order/create 请求
3. 在请求列表中右键该请求 → 点击「🤖 AI代码分析」
4. 跳转到 /ai-analysis 页面，顶部显示 [POST] /api/v1/order/create
5. 填写仓库链接: https://github.com/myorg/order-service
   填写分支: main
   填写 Token: ghp_xxxxxxxxxxxx（自动持久化）
6. 点击「开始分析」
7. AI 流式输出：
   - 正在读取仓库文件树...
   - 找到 OrderController.java
   - 匹配路由: @PostMapping("/api/v1/order/create")
   - 正在分析入参 CreateOrderDTO...
   - 正在分析业务逻辑...
8. 分析完成，Tab 切换查看：
   - 「链路分析」Tab: 展示路由定位、入参/出参分析、业务逻辑链路
   - 「curl 测试用例」Tab: 展示 3 个场景
     · 场景1 [正常]: curl + Python 断言
     · 场景2 [边界值]: curl + Python 断言
     · 场景3 [异常]: curl + Python 断言
9. 点击「📋 复制 curl」复制单条，或「复制全部用例」复制完整脚本
10. 粘贴到终端执行 curl，或粘贴到 .py 文件运行断言
```
