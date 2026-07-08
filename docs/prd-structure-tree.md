# PowerCatch — Structure 模式树状化改版（简单 PRD）

> 角色：产品经理（许清楚）｜阶段：需求分析 + UI 设计稿（暂不编码）｜语言：中文

## 0. 项目信息

| 项 | 内容 |
|---|---|
| 项目名称 | `structure_path_tree` |
| 技术栈 | Electron + Vue 3 + TypeScript + Tailwind CSS（虚拟滚动沿用 `vue-virtual-scroller`） |
| 视图模式现状 | `viewMode: 'list' \| 'group'`；本次改造对象为 `group`（用户口中的 Structure 模式） |
| 原始需求复述 | 将左侧抓包栏的 Structure 模式由「按域名 host 分组 + 同域名下扁平请求列表」改为「按 URL 路径段递归展开的树状结构」，每一层路径作为上一层的子节点，类似 Charles 的逐级下钻展示；先出实现方案与 UI 效果图供确认，暂不直接编码。 |
| 示例 URL | `https://retailceshi002.preview.myshopline.com/sl/apps/pos/app/close-account/detail` |

---

## 1. 产品目标

将当前**仅按域名分组、同域名下为扁平长列表**的 Structure 模式，升级为**按 URL 路径段递归展开的树状结构**，使路径层级深的接口能像 Charles 一样逐级下钻、快速定位，避免在大批量请求的长列表中滚动寻找。

---

## 2. 用户故事

1. **作为抓包用户**，我希望按 URL 路径层级折叠/展开，以便快速定位某个深层接口（如 `close-account/detail`），而不必在同域名的长列表中滚动。
2. **作为抓包用户**，我希望同前缀的多个接口在树中自动归并到共享父节点下，以便一眼看清某模块（如 `/sl/apps/pos/*`）下的全部请求与分支。
3. **作为抓包用户**，我希望树模式完整保留错误/选中/勾选等状态展示，以便在切换视图时不改变现有抓包工作流。
4. **作为抓包用户**，我希望点击域名根或任意中间路径节点即可整体展开/折叠其子树，以便在海量请求时快速收起无关分支。
5. **作为对比分析用户**，我希望在树中直接勾选任意叶子请求加入对比（≤2），以便沿用既有的 AI/结构化对比流程。

---

## 3. 需求池（P0 / P1 / P2）

### P0 — 必须有（核心）
- **P0-1 路径递归树**：请求按 `host` 分组后，依据 `path` 以 `/` 切分为段，逐层递归构建树：域名根 → 路径段节点 → … → 叶子请求。
- **P0-2 每层可折叠/展开**：每个非叶子节点（域名根、中间路径段）具备展开/折叠态；点击切换其直接子节点的显隐。
- **P0-3 叶子即具体请求**：树末端叶子节点对应一条 `CaptureRequest`，展示 method / status / duration / 末段路径。
- **P0-4 缩进与连接线**：遵循统一缩进量（建议 **20px/层**）+ 连接线（`├─` `└─` `│`）渲染层级关系，视觉对齐 Charles。
- **P0-5 状态正确呈现**：错误请求（4xx/5xx 红色）、选中（蓝色背景）、已勾选（对比勾选）在树中正确表现；`pending`（statusCode=null）保持 ⏳ 标识。
- **P0-6 交互保留**：点击叶子 → `selectRequest` 展示详情；行首 checkbox → `toggleCheck`（≤2）保留；右键上下文菜单（重发/编辑重发等）保留。
- **P0-7 虚拟滚动兼容**：N 层深度的展平行（`FlatTreeNode`，`depth` 可变）仍需适配 `RecycleScroller`，**不退化**为整树 DOM 渲染。

### P1 — 应该有（增强）
- **P1-1 展开/折叠全部**：工具条提供「展开全部 / 折叠全部」（复用现有 `expandAllDomains`/`collapseAllDomains` 思路，改为 path-aware）。
- **P1-2 默认展开层级策略**：新请求到达时默认展开到某层（建议默认「域名根 + 第一层」，或全折叠），策略可配置。
- **P1-3 计数/错误徽标**：中间路径节点显示其下「后代请求总数」「含错误数」徽标，辅助评估分支热度。
- **P1-4 搜索过滤适配**：树模式下搜索命中 `path/method/statusCode/host` 时，自动展开命中节点的**祖先链**并高亮匹配段。
- **P1-5 排序下拉语义收敛**：保留排序下拉并收窄为「域名根排序」；路径中间层默认字母序、叶子按时间倒序（可后续开放配置）。

### P2 — 可选（加分）
- **P2-1** 拖拽调整节点顺序。
- **P2-2** 记住每节点展开状态跨会话（localStorage，key 由「host + 路径组合」取代仅 `host`）。
- **P2-3** 将 **query 参数 / HTTP method** 作为树的额外维度节点（如 method 作子分组、query key 作末层）。
- **P2-4** 动态段折叠：将 `/order/12345` 这类数字 ID 段识别并折叠为 `{id}` 通配节点，合并同结构接口。
- **P2-5** GraphQL operation name / WebSocket 连接作为特殊子树节点。

---

## 4. UI 设计稿（重点）

### 4.1 单 URL 效果（对齐用户示例，真实为嵌套树）
> 注：用户示例把所有段画在同一视觉缩进（均 `└──`），属简写；真实树应**逐层嵌套**。下面为正确的嵌套呈现：

```
retailceshi002.preview.myshopline.com  🌐 1 条          ← 域名根（可折叠整棵树）
└── sl
    └── apps
        └── pos
            └── app
                └── close-account
                    └── detail   GET 200 45ms          ← 叶子请求（末段路径）
```

### 4.2 多 URL 分支效果（展示分支与连接线）—— 重点图

假设同一域名下捕获 4 个请求：
- `…/sl/apps/pos/app/close-account/detail`  (GET 200)
- `…/sl/apps/pos/app/close-account/list`    (POST 200)
- `…/sl/apps/pos/app/order/detail`          (GET 404)
- `…/sl/apps/checkout/cart`                 (GET 200)

```
retailceshi002.preview.myshopline.com  🌐 4 条 ⚠          ← 域名根：可折叠整棵子树
└── sl
    └── apps
        ├── pos
        │   └── app
        │       ├── close-account
        │       │   ├── detail   GET  200  45ms           ← 叶子请求
        │       │   └── list     POST 200 120ms           ← 叶子请求
        │       └── order
        │           └── detail  GET  404  30ms  (红)      ← 错误叶子
        └── checkout
            └── cart             GET  200  80ms           ← 叶子请求
```

**连接线图例**：
- `├── ` 该节点下方**还有兄弟节点**；
- `└── ` 该节点是**最后一个兄弟**；
- `│   ` 上方节点还有未展开的兄弟，作垂直连线；
- 每个非叶子节点行首有 `▶`/`▼` 展开箭头。

### 4.3 缩进与连接线
- **缩进量**：每层左侧 `padding-left = 8px + depth × 20px`（与现有 `depth*20+8` 对齐，减少回归风险），另含约 16px 的连接线槽位（gutter）用于绘制 `│/├/└`。
- **连接线风格**：采用 1px 浅灰引导线（`border-l` 或字符 `│`）+ 节点前的 `├─`/`└─` 字符；hover 时整行高亮（`hover:bg-gray-50`）。
- **箭头**：非叶子节点行首 `▶`（折叠）/ `▼`（展开），点击切换子树。

### 4.4 三类节点的视觉与交互

| 节点类型 | 点击箭头 | 点击标签/行 | 行首 checkbox | 徽标 |
|---|---|---|---|---|
| 域名根 `domain` | 展开/折叠整棵域名子树 | 同箭头 | 无（聚合态，P2 可选聚合勾选） | 后代总数「N 条」、⚠（含错）、⏳（pending） |
| 中间路径段 | 展开/折叠其子节点 | 同箭头 | 无（聚合态） | 后代请求总数、含错数（P1-3） |
| 叶子请求 `request` | 无（已是叶子） | 选中 → 右侧详情 | 有 → `toggleCheck`（≤2） | method/status/duration |

### 4.5 叶子节点展示信息
每行叶子按优先级展示（与现有请求行对齐，避免新增字段）：
1. **checkbox**（对比勾选，保留现有 `@toggle-check`）
2. **method 彩色徽章**（GET 绿 / POST 蓝 / PUT 橙 / DELETE 红 / PATCH 紫）
3. **末段路径**（如 `detail` / `list` / `cart`）—— 加粗、`text-primary`；完整 path 通过 tooltip / 右侧详情 breadcrumb 提供
4. **status code**（2xx 绿、3xx 黄、4xx/5xx 红；`null` 显 `-`）
5. **duration**（如 `45ms`）
6. **次信息**（小字灰）：捕获时间 `HH:mm:ss`、设备名/IP（沿用现有）
7. **特殊标签**：GraphQL operation（query/mutation/subscription）、WebSocket 🔌 保留

### 4.6 状态视觉表现

| 状态 | 视觉表现 |
|---|---|
| 错误请求（4xx/5xx） | 状态码红色 + 整行文字偏红 + 左侧 2px 红条；可选 `⚠` |
| 选中 `selected` | 浅蓝背景（`bg-blue-50` / `dark:bg-blue-900`）+ 左侧 2px 蓝色 accent |
| 已勾选 `checked` | 行首 checkbox 勾选 + 蓝紫 tint（与 selected 区分色阶，避免混淆） |
| 进行中 `pending`（statusCode=null） | 黄色 `⏳` + 灰显文字 |
| GraphQL / WebSocket | 对应彩色标签（query/mutation/subscription / WS） |

### 4.7 排序下拉在树模式下的处理（建议）
- **现状**：`domainSortMode`（`latest`/`count`/`alphabetical`/`firstSeen`）仅作用于 `DomainNode` 根节点排序；域下为扁平列表。
- **建议**：**保留下拉**，但**作用域收窄为「域名根排序」**；路径中间层默认按**字母序**（Charles 风格，稳定可预测），叶子在其父段内按**时间倒序**（最新在前，沿用现有语义）。
- **不做**：不在本次直接移除下拉（避免功能回退）；若团队倾向极简，备选方案为「默认按 firstSeen 稳定排序、隐藏下拉」，留作待确认问题。

---

## 5. 待确认问题（需用户 / 主理人拍板）

1. **替换还是新增模式？** 直接替换现有 Structure（group）模式为树状，还是**新增一种「树状」模式**、保留「域名分组」作为可切换选项（viewMode 扩展为 `list | group | tree`）？
2. **默认展开层级？** 默认全折叠（只显示域名根），还是默认展开到域名根 + 第一层路径，或默认全展开？
3. **query / method 是否入树？** 是否将 `?` 后的 query 参数、HTTP method 作为树的额外维度节点（影响 P2-3 与树深度语义）？
4. **现有排序如何体现？** 排序下拉在树模式下保留（仅作用于根）还是移除？中间层/叶子的默认排序规则是否认可「字母序 + 时间倒序」？
5. **同 path 不同 method 如何区分？** 如 `GET` 与 `POST` 同一 URL，是在同一末段节点下并列两条叶子（用 method 徽章区分），还是拆成 method 子节点？
6. **动态段（ID）是否通配折叠？** 如 `/order/12345/detail`，是否识别数字 ID 段并折叠为 `{id}` 通配节点（P2-4），还是原样展示为独立分支？
7. **搜索在树模式下的行为？** 是否自动展开命中节点的祖先链并高亮匹配段（P1-4）？搜索匹配字段是否仍含完整 path / method / statusCode / host？

---

## 附：影响的现有模块（供架构师评估，非实现）
- **`src/services/types.ts`**：新增递归 `PathNode` 类型（`segment: string; children: PathNode[] | CaptureRequest[]; depth; descendantCount; hasErrorDescendant; ...`）；`FlatTreeNode` 增加可选 `segmentLabel`、`descendantCount`、`isLeaf` 等字段。
- **`src/utils/tree-builder.ts`**：新增 `buildPathTree()` 递归构建 + 对应 N 层 `flattenTree()`；保留 `matchSearch()`。
- **`src/stores/request-store.ts`**：`collapsedDomains` 的 key 由 `host` 改为「host + 路径组合」；新增 `pathTree` 计算属性；`toggleDomainExpand` / `expandAllDomains` / `collapseAllDomains` 适配为 path-aware。
- **`src/components/RequestList.vue`**：渲染支持 **N 层深度** 的 domain / intermediate / leaf 三种行；排序下拉语义收窄；搜索高亮祖先链。

---

## 6. 决策确认（用户拍板，2026-07-08）

基于第 5 节待确认问题，用户明确拍板如下：

| # | 决策点 | 用户决定 |
|---|---|---|
| 1 | 替换 vs 新增模式 | **新增「树状」模式**（viewMode 扩展为 `list \| group \| tree`），**默认 `tree`**；保留 `group`（域名分组）作为可切换选项 |
| 2 | 默认展开层级 | **全折叠**（仅显示域名根）；新请求到达不自动展开 |
| 3 | query / method 是否入树 | **不入树**（query 参数、HTTP method 不作为树的维度节点；method 仅作为叶子行的展示徽章） |
| 4 | 排序下拉 + 树内部排序 | 排序下拉**仅作用于域名根排序**；树内部节点（中间路径段 + 叶子）按**首次出现顺序（时间先后，稳定不跳动）**排序 |
| 5 | 同 path 不同 method | **不拆**：同一末段路径下并列多条叶子（用 method 彩色徽章区分），不拆成 method 子节点 |
| 6 | 动态 ID 段 | **按 Charles 原样分段**：`/order/12345/detail` 显示为 `order → 12345 → detail`，不折叠为 `{id}`（查实 Charles Structure 视图即纯 path 分段，无通配折叠能力） |
| 7 | 搜索行为 | 树模式下搜索命中 → **自动展开命中节点的祖先链并高亮匹配段**；匹配字段含完整 path / method / statusCode / host |
