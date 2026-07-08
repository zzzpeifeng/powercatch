# QA 验证报告 — PowerCatch 「左侧抓包栏 tree 树状模式」独立回归

**验证人**：严过关（QA Engineer）
**项目**：/Users/SL/NodeProject/packet-capture-app
**Node**：v22.22.2（/Users/SL/.workbuddy/binaries/node/versions/22.22.2/bin/npx）
**工程阶段**：寇豆码（IS_PASS: YES）→ 独立核查

---

## ① 代码核查结果（逐条对照 7 决策 + 架构师 U1–U8）

核查文件：`src/services/types.ts`、`src/utils/tree-builder.ts`、`src/stores/request-store.ts`、`src/components/RequestList.vue`、`src/components/ViewModeSwitcher.vue`，及新增测试 `src/utils/__tests__/tree-builder-path.test.ts`。

### 7 个用户决策

| # | 决策 | 实现位置 | 结论 |
|---|------|----------|------|
| 1 | 新增 tree 模式，默认 tree；group 保留 | `types.ts: ViewMode='list'\|'group'\|'tree'`；`request-store.ts:95 viewMode=ref('tree')`；`ViewModeSwitcher.vue` 三态按钮；`displayRows` 三态分发 | ✅ 符合 |
| 2 | 默认全折叠，新请求不自动展开 | `expandedPathKeys=ref(new Set())`（默认空）；`addRequest/flushPending` 不触碰该集合；`flattenPathTree` 仅输出已展开节点 | ✅ 符合 |
| 3 | query/method 不入树（仅叶子徽章） | `tree-builder.ts` 仅 `req.path.split('/')` 切段；method 经 `request.method` 在 `RequestList.vue` 叶子行徽章展示 | ✅ 符合 |
| 4 | 排序下拉仅作用于域名根；树内部按 firstSeen 升序稳定 | `RequestList.vue` 下拉 `v-if="group||tree"` 设 `domainSortMode`；`sortPathRoots` 仅排域名根；`computeAggregates` 子节点按 `firstSeenCapturedAt` 升序 + segment 字母序兜底（稳定） | ✅ 符合 |
| 5 | 同 path 不同 method 不拆（末段并列 + method 徽章区分） | `buildPathTree` 叶子取末段 `segment`，两条同末段叶子并列入父 children；`flattenPathTree` 叶子行 key=req.id（唯一） | ✅ 符合（含测试） |
| 6 | 动态 ID 原样分段（不折叠 `{id}`） | `buildPathTree` 按 `/` 切段原样建 trie，`/order/12345/detail`→order→12345→detail | ✅ 符合（含测试） |
| 7 | 搜索命中自动展开祖先链 + 高亮 | `collectAncestorKeys` 收集命中叶子祖先；`flattenPathTree` 搜索态聚焦式仅输出命中叶子+祖先链，命中行 `highlighted=true`；`RequestList.vue` 用 `item.highlighted` 背景 + `isSegmentHighlighted` 段加粗 | ✅ 符合（含测试） |

### 架构师 U1–U8 默认

| # | 默认要求 | 实现位置 | 结论 |
|---|----------|----------|------|
| U1 | tree 默认，group 保留 | `viewMode='tree'` + 三态切换 | ✅ |
| U2 | 聚焦式搜索 | `flattenPathTree` 搜索态仅输出命中叶子+祖先链，非命中同级隐藏 | ✅ |
| U3 | 字符连接线 `├─└─│` | `RequestList.vue connectorText()`：`connectorVertical[i]`→`│  `/空格，`isLastChild`→`└─ `/`├─ ` | ✅ |
| U4 | 不持久化（v1） | `expandedPathKeys` 用 `new Set()` 初始化，未读/写 localStorage；与 group 的 `collapsedDomains`（持久化）区分 | ✅ |
| U5 | 中间节点 firstSeen = min | `computeAggregates` 非叶子节点取 `minTime`（子节点 firstSeen 最小） | ✅ |
| U6 | 切回保留展开位置 | `expandedPathKeys` 独立于 `viewMode`，`toggleViewMode/setViewMode` 不重置；`exitSession/clearRequests` 亦不重置 | ✅ |
| U7 | 展开/折叠含中间节点 | `collectAllPathKeys` 收集 domain+intermediate 全部 pathKey；`expandAllPaths/collapseAllPaths` 作用于全部 | ✅ |
| U8 | `/` → `(root)` | `buildPathTree`：`segments.length===0` 时叶 `segment='(root)'` | ✅（含测试） |

### list / group 模式回归核查
- `matchSearch`、`buildDomainTree`、`sortDomains`、`flattenTree` 逻辑未改动；`displayRows` 的 `group`/`list` 分支沿用原逻辑。
- `RequestList.vue` 的 `list/group` 共用请求行（`<div v-else>` 分支）保留原样，仅新增 domain/intermediate/leaf 三分支。
- **结论：list/group 渲染与逻辑未被破坏。**

### 代码核查发现（非阻塞观察）
- 路径为 `/` 的 `(root)` 叶子 `pathKey` 与域名根 `pathKey` 同为 `host`（因 `getPathKey(host, [])`===`host`）。该碰撞**不影响功能**：展平行 key 用 `req.id`（唯一），叶子不进 `expandedPathKeys`。属潜在歧义，非缺陷，不路由。

---

## ② 测试结果（各测试文件通过/失败数）

| 测试文件 | 运行命令 | 通过 | 失败 |
|----------|----------|------|------|
| `src/utils/__tests__/tree-builder-path.test.ts`（新增 16 用例） | `npx vitest run …tree-builder-path.test.ts` | **16** | 0 |
| `src/stores/__tests__/request-store.test.ts` + `request-store-tier2.test.ts` | `npx vitest run …request-store.test.ts …request-store-tier2.test.ts` | **62** | 0 |
| `src/utils/__tests__/tree-builder.test.ts`（group 模式无回归） | `npx vitest run …tree-builder.test.ts` | **4** | 0 |
| `src/components/__tests__/CompareResult.test.tsx` + `CompareResult-ignore-guard.test.tsx` | `npx vitest run …CompareResult.test.tsx …CompareResult-ignore-guard.test.tsx` | **21** | 0 |
| **合计** | | **103** | **0** |

- viewMode 改默认 `'tree'` 未破坏既有 store 断言（62 全绿）。
- 之前工作人员改的 `viewMode` 类型未波及组件测试（21 全绿）。

---

## ③ 类型检查结论

```
npx vue-tsc --noEmit  →  EXIT_CODE = 0
```

类型检查通过，无 TS 错误（含 `.vue` SFC 与新增 `TreePathKind`/`PathNode`/`FlatTreeNode` 可选字段）。

---

## ④ 最终判定

- **路由判定**：**NoOne（全部通过，无需修源/修测）**
- **源码 Bug**：无
- **测试代码自身 Bug**：无
- **已知问题数**：**0**

### 结论
tree 树状模式实现符合全部 7 个用户决策与架构师 U1–U8 默认；list/group 模式零回归；103 项测试全绿，类型检查 Exit 0。**独立回归验证通过（PASS）。**
