# 高级过滤系统 — 详细实现方案

> 功能编号: #1 | 层级: 基础设施 | 工作量: 小
>
> 创建日期: 2026-06-19 | 修订: 2026-06-19（修复 10 处逻辑问题）

---

## 一、现状分析

### 当前过滤能力

| 维度 | 当前实现 | 位置 |
|------|---------|------|
| 域名过滤 | glob 通配符匹配 host | `request-store.ts` → `domainFilters` + `filteredRequests` |
| 文本搜索 | path / method / statusCode / host 模糊匹配 | `tree-builder.ts` → `matchSearch()` |
| 域名排序 | 最新活动 / 请求量 / 字母序 | `request-store.ts` → `domainSortMode` |

### 缺失的过滤维度

- HTTP 方法筛选（只看 GET / POST）
- 状态码范围筛选（只看 4xx/5xx 错误）
- Content-Type 筛选（只看 JSON / 图片）
- 响应时间筛选（只看慢请求 >1s）
- 请求体大小筛选（只看大请求）
- 设备/IP 筛选

---

## 二、设计目标

1. **不破坏现有流程**：搜索框和域名排序保持不变，过滤面板是增量添加
2. **折叠式设计**：默认收起不占空间，需要时点击展开
3. **即时反馈**：点击过滤条件后列表立即更新，无需"应用"按钮
4. **可视化激活状态**：折叠态也能看到已激活的过滤条件（标签 + 徽标数字）
5. **性能不退化**：过滤逻辑在 computed 内完成，不引入额外渲染开销
6. **null 安全**：请求未收到响应时（statusCode/duration 为 null），过滤逻辑不会崩溃

---

## 三、数据结构设计

### 3.1 新增类型定义（`src/services/types.ts`）

```typescript
/** 过滤条件状态 */
export interface FilterState {
  /** HTTP 方法（空数组 = 不过滤） */
  methods: HttpMethod[]
  /** 状态码分组（空数组 = 不过滤） */
  statusGroups: StatusCodeGroup[]
  /** Content-Type 分组（空数组 = 不过滤） */
  contentTypes: ContentTypeGroup[]
  /** 响应时间范围（空数组 = 不过滤） */
  durationRanges: DurationRange[]
  /** 请求体大小范围（空数组 = 不过滤） */
  sizeRanges: SizeRange[]
  /** 设备 IP 列表（空数组 = 不过滤） */
  clientIps: string[]
}

/** 状态码分组（含 pending：请求已发出但响应未到达） */
export type StatusCodeGroup = '2xx' | '3xx' | '4xx' | '5xx' | 'pending'

/** Content-Type 分组 */
export type ContentTypeGroup = 'json' | 'html' | 'image' | 'javascript' | 'css' | 'other'

/** 响应时间范围（含 pending：响应未到达，duration 为 null） */
export type DurationRange = 'fast' | 'normal' | 'slow' | 'very_slow' | 'pending'
// fast: <100ms, normal: 100-500ms, slow: 500ms-1s, very_slow: >1s, pending: duration=null

/** 请求体大小范围 */
export type SizeRange = 'tiny' | 'small' | 'medium' | 'large' | 'empty'
// empty: 0 字节, tiny: <1KB, small: 1-10KB, medium: 10-100KB, large: >100KB
```

> **修复说明**：
> - `DurationRange` 新增 `'pending'` 成员，处理 `duration = null` 的请求（响应未到达）
> - `SizeRange` 新增 `'empty'` 成员，处理 `requestBody` 为空字符串的情况
> - 语义明确为"请求体大小"而非笼统的"请求大小"，避免与响应体混淆

### 3.2 Store 扩展（`src/stores/request-store.ts`）

```typescript
import { matchFilters } from '../utils/filter-engine'
import type { FilterState, StatusCodeGroup, ContentTypeGroup, DurationRange, SizeRange } from '../services/types'

// ===== 新增 State =====

/** 高级过滤条件（不持久化，刷新后清空） */
const filterState = ref<FilterState>({
  methods: [],
  statusGroups: [],
  contentTypes: [],
  durationRanges: [],
  sizeRanges: [],
  clientIps: [],
})

/** 过滤面板展开状态（不持久化） */
const isFilterPanelOpen = ref<boolean>(false)

// ===== 新增 Computed =====

/** 是否有激活的过滤条件 */
const hasActiveFilters = computed(() => {
  const f = filterState.value
  return f.methods.length > 0 ||
         f.statusGroups.length > 0 ||
         f.contentTypes.length > 0 ||
         f.durationRanges.length > 0 ||
         f.sizeRanges.length > 0 ||
         f.clientIps.length > 0
})

/** 激活条件数（按维度计数，非按 chip 计数） */
const activeFilterCount = computed(() => {
  const f = filterState.value
  let count = 0
  if (f.methods.length > 0) count++
  if (f.statusGroups.length > 0) count++
  if (f.contentTypes.length > 0) count++
  if (f.durationRanges.length > 0) count++
  if (f.sizeRanges.length > 0) count++
  if (f.clientIps.length > 0) count++
  return count
})

/** 动态提取当前请求列表中所有设备 IP（供 FilterPanel 渲染 chip） */
const availableClientIps = computed<string[]>(() => {
  const ips = new Set<string>()
  for (const req of requests.value) {
    if (req.clientIp) ips.add(req.clientIp)
  }
  return [...ips].sort()
})

/**
 * 域名过滤后的请求数（高级过滤前）
 * 用于过滤面板底部 "匹配 X/Y 条" 的分母
 */
const preAdvancedFilterCount = computed(() => {
  // 这就是 filteredRequests 在接入高级过滤前的数量
  // 复用 filteredRequests 的域名过滤逻辑，但不应用高级过滤
  const source = requests.value
  if (domainFilters.value.length === 0) return source.length
  return source.filter((req) => {
    return domainFilters.value.some((filter) => {
      if (filter.includes('*')) {
        const pattern = filter
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
        return new RegExp(`^${pattern}$`, 'i').test(req.host)
      }
      return req.host === filter
    })
  }).length
})

/**
 * 高级过滤后的请求数（用于面板底部 "匹配 X/Y 条" 的分子）
 */
const advancedFilteredCount = computed(() => advancedFilteredRequests.value.length)
```

> **修复说明**：
> - 新增 `availableClientIps` computed — FilterPanel 需要动态 IP 列表渲染 chip，原 plan 缺失
> - 新增 `preAdvancedFilterCount` computed — 面板底部 "匹配 X/Y 条" 的分母来源
> - 新增 `advancedFilteredCount` computed — 分子来源
> - **持久化差异说明**：`filterState` 和 `isFilterPanelOpen` 不持久化（临时调试状态，刷新清空）；而 `collapsedDomains` 持久化到 localStorage（长期 UI 偏好）。这是有意设计

### 3.3 `filteredRequests` 改造（完整代码）

> **修复说明**：原 plan 只说"接入 matchFilters"但没给完整代码。当前 `filteredRequests` 有快速路径 `if (domainFilters.length === 0) return source.slice().reverse()`，加高级过滤后必须改这个分支。

```typescript
/**
 * 域名过滤 + 高级过滤后的请求列表（反转顺序：最新在前）
 *
 * 数据流：requests → 域名过滤 → 高级过滤 → 反转
 *
 * 注意：高级过滤在 filteredRequests 层面执行。
 * - list 模式：直接使用 filteredRequests，无计数问题
 * - group 模式：buildDomainTree 看到的是过滤后的列表，
 *   域名 count 显示的是过滤后的数量（不再显示 "X/Y" 格式）。
 *   这是有意设计：高级过滤是主动筛选行为，用户不需要看到原始总数。
 *   搜索功能不同——搜索是查找行为，需要 "3/12" 提示有多少被隐藏。
 */
const filteredRequests = computed<CaptureRequest[]>(() => {
  const source = requests.value

  // Step 1: 域名过滤
  let domainFiltered: CaptureRequest[]
  if (domainFilters.value.length === 0) {
    domainFiltered = source
  } else {
    domainFiltered = source.filter((req) => {
      return domainFilters.value.some((filter) => {
        if (filter.includes('*')) {
          const pattern = filter
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
          return new RegExp(`^${pattern}$`, 'i').test(req.host)
        }
        return req.host === filter
      })
    })
  }

  // Step 2: 高级过滤（有激活条件时才执行）
  let result: CaptureRequest[]
  if (hasActiveFilters.value) {
    result = domainFiltered.filter(req => matchFilters(req, filterState.value))
  } else {
    result = domainFiltered
  }

  // Step 3: 反转（最新在前）
  return result.slice().reverse()
})

/**
 * 高级过滤后的请求列表（不反转，供 preAdvancedFilterCount 使用）
 * 仅在 hasActiveFilters 时与 filteredRequests 不同
 */
const advancedFilteredRequests = computed<CaptureRequest[]>(() => {
  const source = requests.value
  if (domainFilters.value.length === 0) {
    return hasActiveFilters.value
      ? source.filter(req => matchFilters(req, filterState.value))
      : source
  }
  const domainFiltered = source.filter((req) => {
    return domainFilters.value.some((filter) => {
      if (filter.includes('*')) {
        const pattern = filter
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
        return new RegExp(`^${pattern}$`, 'i').test(req.host)
      }
      return req.host === filter
    })
  })
  return hasActiveFilters.value
    ? domainFiltered.filter(req => matchFilters(req, filterState.value))
    : domainFiltered
})
```

> **简化方案**：如果觉得 `advancedFilteredRequests` 重复逻辑过多，可以直接让 `preAdvancedFilterCount` 复用一个独立的域名过滤 computed，避免逻辑重复。实际实现时工程师可以酌情简化，核心是 `filteredRequests` 的三步管道必须正确。

### 3.4 新增 Actions

```typescript
/**
 * 切换某个过滤维度的某个值
 * @param category 过滤维度（FilterState 的 key）
 * @param value 要切换的值
 */
function toggleFilter<K extends keyof FilterState>(
  category: K,
  value: FilterState[K][number]
): void {
  const arr = filterState.value[category] as any[]
  const idx = arr.indexOf(value)
  if (idx >= 0) {
    arr.splice(idx, 1)
  } else {
    arr.push(value)
  }
  // 触发响应式（数组原地修改需要重新赋值）
  filterState.value = { ...filterState.value }
}

/** 切换过滤面板展开/折叠 */
function toggleFilterPanel(): void {
  isFilterPanelOpen.value = !isFilterPanelOpen.value
}

/** 清除所有过滤条件 */
function clearAllFilters(): void {
  filterState.value = {
    methods: [],
    statusGroups: [],
    contentTypes: [],
    durationRanges: [],
    sizeRanges: [],
    clientIps: [],
  }
}

/**
 * 移除某个维度的整组过滤条件
 * @param category 要清除的维度
 */
function removeFilterGroup<K extends keyof FilterState>(category: K): void {
  filterState.value = {
    ...filterState.value,
    [category]: [],
  }
}
```

### 3.5 Store return 导出（必须补充）

> **修复说明**：原 plan 只展示了定义没展示 return，工程师容易遗漏导出。

```typescript
return {
  // ===== 既有 State =====
  requests, selectedRequest, checkedRequests, domainFilters,
  isRecording, proxyStatus, proxyPort, localIp,
  compareResult, streamingText, loadingStates, deviceAliases,
  viewMode, searchQuery, collapsedDomains, domainSortMode,
  // ===== 新增 State =====
  filterState, isFilterPanelOpen,
  // ===== 既有 Computed =====
  filteredRequests, totalCount, filteredCount, checkedCount,
  canCompare, groupedRequests, groupedTreeRequests, flatTreeRows,
  displayRows, getDeviceName,
  // ===== 新增 Computed =====
  hasActiveFilters, activeFilterCount, availableClientIps,
  preAdvancedFilterCount, advancedFilteredCount,
  // ===== 既有 Actions =====
  addRequest, clearRequests, selectRequest, toggleCheck,
  startRecording, stopRecording, toggleRecording, doCompare,
  appendStreamChunk, setCompareResult, doExport, loadProxyStatus,
  loadDeviceAliases, subscribeToNewRequests, subscribeToStreamEvents,
  toggleViewMode, setViewMode, setSearchQuery,
  toggleDomainExpand, isDomainExpanded, setDomainSortMode,
  expandAllDomains, collapseAllDomains, flushPending,
  destroy: stopFlushTimer,
  // ===== 新增 Actions =====
  toggleFilter, toggleFilterPanel, clearAllFilters, removeFilterGroup,
}
```

### 3.6 过滤逻辑（`src/utils/filter-engine.ts` 新文件）

> **修复说明**：补充了所有辅助函数的完整实现，处理了 null、`string | string[] | undefined` 等边界情况。

```typescript
import type {
  CaptureRequest, FilterState,
  StatusCodeGroup, ContentTypeGroup, DurationRange, SizeRange,
} from '../services/types'

// ===== 辅助函数 =====

/** 将状态码映射到分组（null → 'pending'） */
function getStatusCodeGroup(code: number | null): StatusCodeGroup {
  if (code === null) return 'pending'
  if (code >= 200 && code < 300) return '2xx'
  if (code >= 300 && code < 400) return '3xx'
  if (code >= 400 && code < 500) return '4xx'
  if (code >= 500) return '5xx'
  return 'pending' // 1xx 或其他异常归入 pending
}

/**
 * 将 Content-Type 头映射到分组
 * 处理 string | string[] | undefined 三种情况
 */
function getContentTypeGroup(ct: string | string[] | undefined): ContentTypeGroup {
  // 统一转为小写字符串
  let ctStr: string
  if (ct === undefined) return 'other'
  if (Array.isArray(ct)) ctStr = ct[0]?.toLowerCase() ?? ''
  else ctStr = ct.toLowerCase()

  if (ctStr.includes('json')) return 'json'
  if (ctStr.includes('html')) return 'html'
  if (ctStr.includes('image')) return 'image'
  if (ctStr.includes('javascript') || ctStr.includes('ecmascript')) return 'javascript'
  if (ctStr.includes('css')) return 'css'
  return 'other'
}

/** 将响应时间映射到范围（null → 'pending'） */
function getDurationRange(duration: number | null): DurationRange {
  if (duration === null) return 'pending'
  if (duration < 100) return 'fast'
  if (duration < 500) return 'normal'
  if (duration < 1000) return 'slow'
  return 'very_slow'
}

/**
 * 将请求体大小映射到范围
 * 使用 TextEncoder 计算字节数（而非字符串长度，避免中文/二进制精度问题）
 */
function getSizeRange(requestBody: string): SizeRange {
  if (!requestBody || requestBody.length === 0) return 'empty'
  // TextEncoder 计算 UTF-8 字节数，比 .length 更准确
  const bytes = new TextEncoder().encode(requestBody).length
  if (bytes < 1024) return 'tiny'
  if (bytes < 10240) return 'small'
  if (bytes < 102400) return 'medium'
  return 'large'
}

// ===== 核心过滤函数 =====

/**
 * 判断请求是否匹配所有激活的过滤条件
 * 各维度之间是 AND 关系，维度内多选是 OR 关系
 */
export function matchFilters(req: CaptureRequest, filter: FilterState): boolean {
  // 方法过滤
  if (filter.methods.length > 0 && !filter.methods.includes(req.method)) {
    return false
  }

  // 状态码过滤
  if (filter.statusGroups.length > 0) {
    const group = getStatusCodeGroup(req.statusCode)
    if (!filter.statusGroups.includes(group)) return false
  }

  // Content-Type 过滤（注意：responseHeaders 不是 optional，不需要 ?.）
  if (filter.contentTypes.length > 0) {
    const ct = getContentTypeGroup(req.responseHeaders['content-type'])
    if (!filter.contentTypes.includes(ct)) return false
  }

  // 响应时间过滤
  if (filter.durationRanges.length > 0) {
    const range = getDurationRange(req.duration)
    if (!filter.durationRanges.includes(range)) return false
  }

  // 请求体大小过滤
  if (filter.sizeRanges.length > 0) {
    const size = getSizeRange(req.requestBody)
    if (!filter.sizeRanges.includes(size)) return false
  }

  // 设备 IP 过滤
  if (filter.clientIps.length > 0 && !filter.clientIps.includes(req.clientIp)) {
    return false
  }

  return true
}
```

---

## 四、UI 交互设计

### 4.1 三种状态

| 状态 | 触发 | 布局 |
|------|------|------|
| **折叠态（无过滤）** | 默认 | 搜索框 + [▽ 过滤] 按钮 + 排序下拉 |
| **展开态** | 点击「过滤」按钮 | 搜索框 + [△ 过滤 N] 按钮 + 排序下拉 + 过滤面板 |
| **折叠态（有过滤）** | 点击收起 / 选中条件后收起 | 搜索框 + [▽ 过滤 N] + 排序下拉 + 激活条件标签行 |

### 4.2 过滤面板布局

```
┌──────────────────────────────────────────────────────┐
│ HTTP 方法                                             │
│ [GET] [POST]  PUT  DELETE  PATCH  HEAD  OPTIONS      │
├──────────────────────────────────────────────────────┤
│ 状态码                                                │
│  2xx成功   3xx重定向  [4xx错误] [5xx错误]  待响应      │
├──────────────────────────────────────────────────────┤
│ Content-Type                                          │
│  application/json  text/html  image/*  ...            │
├──────────────────────────────────────────────────────┤
│ 响应时间                                              │
│  <100ms  100-500ms  [500ms-1s]  [>1s]  待响应         │
├──────────────────────────────────────────────────────┤
│ 请求体大小                                            │
│  空  <1KB  1-10KB  10-100KB  >100KB                  │
├──────────────────────────────────────────────────────┤
│ 设备 IP                                               │
│  192.168.1.100  192.168.1.101  ...                   │
├──────────────────────────────────────────────────────┤
│ 已激活 3 个过滤条件 · 匹配 47/312 条  [清除全部]      │
└──────────────────────────────────────────────────────┘
```

> **修复说明**：
> - 响应时间增加"待响应"chip（对应 `DurationRange = 'pending'`）
> - 请求体大小增加"空"chip（对应 `SizeRange = 'empty'`）
> - 设备 IP 行从动态提取的 `availableClientIps` 渲染 chip
> - 底部 "匹配 47/312 条"：47 = `advancedFilteredCount`，312 = `preAdvancedFilterCount`

### 4.3 交互细节

1. **chip 点击切换**：点击未选中 chip → 选中（高亮）；点击已选中 chip → 取消选中
2. **即时过滤**：每次点击 chip 后列表立即更新（computed 响应式）
3. **折叠保留状态**：折叠面板时过滤条件不丢失，再次展开恢复选中状态
4. **激活标签**：折叠态下方显示已激活条件的可移除标签，点击 x 移除整组
5. **清除全部**：一键清除所有过滤条件
6. **与搜索叠加**：搜索关键词和高级过滤是 AND 关系（同时满足才显示）
7. **与域名过滤叠加**：高级过滤在域名过滤（domainFilters）之后执行
8. **设备/IP 过滤**：从 `availableClientIps` computed 动态提取，不在面板中硬编码
9. **group 模式计数行为**：高级过滤后，域名行显示的是过滤后的 count（如 "3 条"），不显示 "X/Y" 格式。这是有意设计——高级过滤是主动筛选，用户不需要看到原始总数

### 4.4 暗色模式

所有 chip 和面板使用 Tailwind `dark:` 变体，与现有 UI 一致。

---

## 五、文件改动清单

| 文件 | 操作 | 改动内容 |
|------|------|---------|
| `src/services/types.ts` | 修改 | 新增 `FilterState`、`StatusCodeGroup`、`ContentTypeGroup`、`DurationRange`（含 `'pending'`）、`SizeRange`（含 `'empty'`）类型 |
| `src/utils/filter-engine.ts` | **新增** | `matchFilters()` + 辅助函数（`getStatusCodeGroup`、`getContentTypeGroup`、`getDurationRange`、`getSizeRange`），完整处理 null/undefined/string[] 边界 |
| `src/stores/request-store.ts` | 修改 | 新增 `filterState`、`isFilterPanelOpen` state；新增 `hasActiveFilters`、`activeFilterCount`、`availableClientIps`、`preAdvancedFilterCount`、`advancedFilteredCount` computed；改造 `filteredRequests` 为三步管道（域名过滤 → 高级过滤 → 反转）；新增 `toggleFilter`、`toggleFilterPanel`、`clearAllFilters`、`removeFilterGroup` actions；**补充 return 导出** |
| `src/components/RequestList.vue` | 修改 | 搜索栏新增「过滤」按钮；新增过滤面板组件；新增激活条件标签行 |
| `src/components/FilterPanel.vue` | **新增** | 过滤面板 UI（6 个维度 chip 组 + 底部统计 + 清除按钮） |
| `src/components/ActiveFilterTags.vue` | **新增** | 折叠态下显示的激活条件标签行 |

---

## 六、实现任务分解

### 任务 1: 类型定义 + 过滤引擎（无 UI 依赖）

- [ ] 在 `types.ts` 新增类型定义（注意 `DurationRange` 含 `'pending'`，`SizeRange` 含 `'empty'`）
- [ ] 创建 `filter-engine.ts`，实现 `matchFilters()` 和 4 个辅助函数
- [ ] 辅助函数必须处理：`statusCode = null`、`duration = null`、`responseHeaders['content-type']` 为 `string | string[] | undefined`、`requestBody` 为空字符串
- [ ] 单元测试：构造各种请求验证过滤判定（含 null 状态码、pending duration、空 body）

### 任务 2: Store 集成

- [ ] 新增 `filterState`、`isFilterPanelOpen` state（不持久化）
- [ ] 新增 `hasActiveFilters`、`activeFilterCount`、`availableClientIps`、`preAdvancedFilterCount`、`advancedFilteredCount` computed
- [ ] 改造 `filteredRequests` computed 为三步管道：域名过滤 → 高级过滤（`hasActiveFilters` 时）→ 反转
- [ ] 新增 actions：`toggleFilter<K>(category, value)`、`toggleFilterPanel`、`clearAllFilters`、`removeFilterGroup<K>(category)`
- [ ] **在 store return 对象中导出所有新增 state/computed/actions**
- [ ] 验证：store 启动后过滤面板不影响现有流程（无过滤条件时 `filteredRequests` 行为不变）

### 任务 3: FilterPanel 组件

- [ ] 创建 `FilterPanel.vue`，实现 6 个维度的 chip 组
- [ ] 响应时间维度包含"待响应"chip，请求体大小维度包含"空"chip
- [ ] 设备 IP 维度从 `store.availableClientIps` 动态渲染 chip
- [ ] chip 点击调用 `store.toggleFilter(category, value)`
- [ ] 底部显示：`已激活 ${store.activeFilterCount} 个 · 匹配 ${store.advancedFilteredCount}/${store.preAdvancedFilterCount} 条 · [清除全部]`
- [ ] 暗色模式适配

### 任务 4: RequestList 集成

- [ ] 搜索栏右侧新增「过滤」按钮（含徽标，显示 `activeFilterCount`）
- [ ] 按钮点击切换 `store.isFilterPanelOpen`
- [ ] 面板展开时渲染 `FilterPanel` 组件
- [ ] 折叠态且有激活条件时，渲染 `ActiveFilterTags` 组件
- [ ] 验证：三种状态切换正常，过滤即时生效

### 任务 5: 激活条件标签行

- [ ] 创建 `ActiveFilterTags.vue`
- [ ] 每个激活维度显示为一个标签，点击 x 调用 `store.removeFilterGroup(category)` 移除整组
- [ ] 标签颜色按维度区分（方法蓝/状态码红/时间黄/大小紫/IP 绿/CT 橙）

### 任务 6: 验收测试

- [ ] `npx tsc --noEmit` 零错误
- [ ] `npm run build` 通过
- [ ] 手动验证场景 1：录制 → 展开过滤面板 → 选 GET + 4xx → 列表只显示 GET 4xx → 折叠面板 → 标签显示 → 点 x 移除 → 列表恢复
- [ ] 手动验证场景 2：录制中，请求响应未到达（statusCode=null）→ 选"待响应" → 能正确过滤出 pending 请求
- [ ] 手动验证场景 3：请求体为空 → 选"空" → 能正确过滤出无 body 的请求
- [ ] 手动验证场景 4：group 模式下应用高级过滤 → 域名 count 显示过滤后数量（非 X/Y 格式）

---

## 七、性能考量

### 7.1 过滤计算复杂度

当前 `filteredRequests` 是 `computed`，每次 `requests`、`domainFilters` 或 `filterState` 变化时重新计算。

接入高级过滤后，每个请求多 6 次判断（方法/状态码/CT/时间/大小/IP）。每次判断涉及函数调用、字符串解析、数组 `includes`，实际开销比纯数值比较大。

**5000 条请求的过滤开销估算**：6 × 5000 = 30000 次判断，含函数调用和字符串操作，实际约 **3-5ms**（非 <1ms，但仍在可接受范围内，computed 会自动缓存）。

### 7.2 虚拟滚动兼容

过滤结果通过 `displayRows` computed 流入 `RecycleScroller`，不改变虚拟滚动机制。

### 7.3 避免重复计算

`matchFilters` 是纯函数，Vue computed 会自动缓存。只要 `filterState` 不变，不会重复执行。

### 7.4 `TextEncoder` 性能注意

`getSizeRange` 使用 `new TextEncoder().encode(requestBody).length` 计算字节数。对于大请求体（>100KB），每次过滤都执行编码有开销。优化方案：可以在 `CaptureRequest` 入 store 时预计算 `requestBodySize` 字段缓存，避免重复编码。**初版不做此优化**，如果性能测试有问题再加。

---

## 八、与现有功能的兼容性

| 现有功能 | 兼容性 | 说明 |
|---------|--------|------|
| 搜索框 | AND 叠加 | 搜索关键词和高级过滤同时满足才显示 |
| 域名过滤 (domainFilters) | AND 叠加 | 先执行域名过滤，再执行高级过滤（三步管道 Step 1 → Step 2） |
| Structure/Sequence 切换 | 完全兼容 | 过滤作用于 `filteredRequests`，两种模式都使用它 |
| 域名折叠/展开 | 完全兼容 | 过滤后的请求才进入树构建 |
| 域名排序 | 完全兼容 | 排序在过滤之后执行 |
| 勾选对比 | 完全兼容 | 过滤不影响已勾选的请求（即使被过滤掉仍保留勾选状态） |
| **group 模式域名计数** | **行为变更** | 高级过滤后，域名行 count 显示过滤后数量（如 "3 条"），不显示 "X/Y" 格式。与搜索不同——搜索是查找行为需要 "X/Y" 提示，高级过滤是主动筛选不需要 |

---

## 九、已明确事项（原"待明确事项"已全部决策）

1. **设备/IP 过滤的 UI 位置** → 放过滤面板内最后一行，用 chip 形式从 `availableClientIps` 动态生成
2. **过滤状态是否持久化** → 不持久化，刷新后清空（`filterState` 和 `isFilterPanelOpen` 都不进 localStorage）。与 `collapsedDomains` 持久化不同，因为过滤是临时调试行为，域名折叠是长期 UI 偏好
3. **Content-Type 提取来源** → 从 `responseHeaders['content-type']` 提取，类型为 `string | string[] | undefined`。响应未到达时 `responseHeaders` 为空对象，`content-type` 为 `undefined` → 归入 `'other'` 分组
4. **请求体大小计算方式** → 使用 `new TextEncoder().encode(requestBody).length` 计算 UTF-8 字节数（而非 `requestBody.length` 字符数），避免中文/多字节字符精度问题。空字符串归入 `'empty'` 分组
5. **null 请求的处理** → `statusCode = null` → `'pending'` 分组；`duration = null` → `'pending'` 分组。两个维度都有对应的"待响应"chip 供用户选择

---

## 十、修订记录

| 日期 | 修订内容 |
|------|---------|
| 2026-06-19 | 初始版本 |
| 2026-06-19 | 修复 10 处逻辑问题：① `DurationRange` 加 `'pending'` ② `getContentTypeGroup` 处理 `string \| string[] \| undefined` ③ group 模式域名计数行为明确 ④ 补充 `availableClientIps` computed 和 `toggleFilter` action ⑤ 请求大小改为"请求体大小"+ `TextEncoder` 字节数 ⑥ 补充 `preAdvancedFilterCount` computed ⑦ 补充 `filteredRequests` 完整改造代码 ⑧ 性能估算修正为 3-5ms ⑨ 显式说明持久化差异 ⑩ 补充 store return 导出清单 |
