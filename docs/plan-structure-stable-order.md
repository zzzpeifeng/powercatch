# Structure 模式根域名稳定排序优化方案

> 需求：左侧栏（Structure / group 模式）在持续抓包、不断有新增请求时，根域名不应改变相对顺序。

## 1. 问题根因

- 左侧栏 group 模式的排序由 `domainSortMode` 控制，当前默认值为 `'latest'`（`src/stores/request-store.ts:104`）。
- `latest` 模式在 `sortDomains`（`src/utils/tree-builder.ts:84-108`）中按 `latestCapturedAt` **降序**排列。
- `latestCapturedAt` = 该域名下**最新**一条请求的 `capturedAt`（`tree-builder.ts:69`）。
- 任意域名收到新请求 → 其 `latestCapturedAt` 变新 → 在降序序列中立即跳到顶部 → 用户视觉上"顺序被打乱"。

当前三种排序：`latest`（最新活动，默认）、`count`（请求量）、`alphabetical`（字母序）。
- 只有 `alphabetical` 是"新增不改序"的，但它按字母排，不符合"先来的在前"的直觉。
- `latest` 和 `count` 都会在新增/计数变化时重排。

## 2. 目标行为

新增一种**稳定排序模式「首次出现顺序（firstSeen）」**：

- 域名按"该域名下**最早**一条请求的 `capturedAt`"**升序**排列（最早出现的域名排最前）。
- 已有域名收到新请求 → 其"最早出现时间"**不变** → 位置固定，**不重排**。
- 新域名 → 追加到列表**底部**（首次出现时间最新）。
- 完全满足"有新增也不改变顺序"。

## 3. 改动清单（最小变更，4 个文件）

### 3.1 `src/services/types.ts`
- `DomainSortMode`：`'latest' | 'count' | 'alphabetical'` → 增加 `'firstSeen'`。
- `DomainNode` 接口：新增字段 `firstSeenCapturedAt: string`（该域名下最早请求的 capturedAt）。

### 3.2 `src/utils/tree-builder.ts`
- `buildDomainTree`：在 children 统计遍历中同时记录 `firstSeenCapturedAt`。
  - children 已按 `capturedAt` 降序（`tree-builder.ts:46`），故取 `children[children.length - 1].capturedAt`；或在循环里维护 `min`。
- `sortDomains`：新增 `case 'firstSeen'` → 按 `firstSeenCapturedAt` 升序。
  - `(unknown)` 仍保持置底逻辑不变。

### 3.3 `src/components/RequestList.vue`
- 排序下拉 `<select>`（仅 group 模式显示）新增一项：
  ```html
  <option value="firstSeen">首次出现</option>
  ```
  置于「最新活动」之后。

### 3.4 `src/stores/request-store.ts`（取决于默认决策）
- 若采用方案 A：将默认 `domainSortMode` 改为 `'firstSeen'`（开箱即稳定）。

## 4. 边界与注意

- **内存淘汰（>5000 条删最老）**：若某域名"最早一条"被淘汰，`firstSeenCapturedAt` 会顺延到次早一条。属极端场景（需累积 5000 条且最老请求正属于该域名），顺序仍稳定，可接受。
- **搜索态** `flattenTree` 不受影响（排序在 flatten 之前完成，搜索只是过滤+强制展开）。
- **会话恢复**不持久化 `domainSortMode`，每次启动取默认值，符合预期。
- **折叠状态** `collapsedDomains` 按 host 记录，排序模式切换不影响折叠记忆。

## 5. 验证（QA）

- `tree-builder` 单测：
  - `latest` vs `firstSeen` 行为对比。
  - 向已有域名追加新请求 → 断言该域名在 `firstSeen` 序列中的位置索引不变。
  - 新域名 → 断言追加到 `firstSeen` 序列底部。
  - `(unknown)` 始终置底。
- 手动验证：开始录制，连续产生多个域名请求，确认域名列稳定不跳动；切换三种原有排序 + 新增排序均正常。

## 6. 待确认（关键决策）

默认排序是否切换到 `firstSeen`？见对话中的提问选项。
