# #3 会话保存与恢复 - 详细实施计划

> **状态**: Plan v1.0  
> **工作量**: 小（1-2 天）  
> **依赖**: 无

---

## 1. 现有架构分析

### 当前数据流
```
录制中 → 内存 Map (requests ref)
       ↓ (批量 flush)
      SQLite (requests 表)
```

### 关键发现
- **requests 表已存在**：所有请求数据已持久化到 SQLite
- **内存优先策略**：录制中仅存内存，不实时写 DB
- **批量 flush**：定时将内存请求批量写入 DB

### 逻辑问题（原方案）
原方案提议在 sessions 表中存储 `requests[]`，这会导致：
- ❌ 数据重复存储（requests 表已有数据）
- ❌ 存储空间浪费
- ❌ 数据一致性问题

---

## 2. 修正方案

### 核心思路
**Session = 元数据 + 时间范围引用**（不复制请求数据）

```
┌─────────────────────────────────────────────────────────┐
│                    sessions 表                           │
├─────────────────────────────────────────────────────────┤
│  id            INTEGER PRIMARY KEY                       │
│  name          TEXT NOT NULL                             │
│  start_time    DATETIME NOT NULL                         │
│  end_time      DATETIME NOT NULL                         │
│  request_count INTEGER NOT NULL                          │
│  filters_json  TEXT (保存过滤状态)                        │
│  view_mode     TEXT (保存视图模式)                        │
│  domain_filters_json TEXT (保存域名过滤)                  │
│  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    requests 表 (已有)                     │
├─────────────────────────────────────────────────────────┤
│  id, method, url, path, host, status_code, duration,    │
│  request_headers, request_body, response_headers,        │
│  response_body, client_ip, device_name, captured_at,    │
│  is_recorded                                            │
└─────────────────────────────────────────────────────────┘

关系：session.start_time <= request.captured_at <= session.end_time
```

### 数据流
```
保存会话 → 记录当前时间范围 + 请求计数 + UI 状态
         ↓
加载会话 → 根据时间范围查询 requests 表
         ↓
恢复 UI 状态（过滤、视图模式等）
```

---

## 3. 实施步骤

### Step 1: 数据模型（types.ts）

```typescript
/** 会话元数据 */
export interface CaptureSession {
  id: number
  name: string
  startTime: string      // ISO 8601
  endTime: string        // ISO 8601
  requestCount: number
  filtersJson?: string   // FilterState JSON
  viewMode: 'list' | 'group'
  domainFiltersJson?: string  // string[] JSON
  createdAt: string
}
```

### Step 2: 数据库扩展（sqlite.ts）

```typescript
// 创建 sessions 表
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    start_time      DATETIME NOT NULL,
    end_time        DATETIME NOT NULL,
    request_count   INTEGER NOT NULL,
    filters_json    TEXT,
    view_mode       TEXT DEFAULT 'group',
    domain_filters_json TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

// 保存会话
export function saveSession(session: Omit<CaptureSession, 'id' | 'createdAt'>): number

// 加载会话列表
export function listSessions(): CaptureSession[]

// 加载单个会话的请求
export function loadSessionRequests(sessionId: number): CaptureRequest[]

// 删除会话
export function deleteSession(sessionId: number): void

// 重命名会话
export function renameSession(sessionId: number, newName: string): void
```

### Step 3: Store 扩展（request-store.ts）

```typescript
// 新增 state
const sessions = ref<CaptureSession[]>([])
const currentSessionId = ref<number | null>(null)

// 新增 actions
async function saveCurrentSession(name: string): Promise<void>
async function loadSession(sessionId: number): Promise<void>
async function loadSessions(): Promise<void>
async function deleteSession(sessionId: number): Promise<void>
async function renameSession(sessionId: number, newName: string): Promise<void>
```

### Step 4: UI 组件（SessionManager.vue）

```
┌─────────────────────────────────────────────────────────┐
│  会话管理                                    [+ 保存当前] │
├─────────────────────────────────────────────────────────┤
│  🔍 搜索会话...                                         │
├─────────────────────────────────────────────────────────┤
│  📁 登录流程调试                          2026-06-27     │
│     128 个请求 · 14:30 - 15:45                          │
│     [加载] [重命名] [导出] [删除]                         │
├─────────────────────────────────────────────────────────┤
│  📁 API 性能测试                          2026-06-26     │
│     256 个请求 · 10:15 - 12:30                          │
│     [加载] [重命名] [导出] [删除]                         │
└─────────────────────────────────────────────────────────┘
```

### Step 5: 入口集成

- 在工具栏添加"会话"按钮（下拉菜单）
- 或在工具下拉菜单中添加"会话管理"选项

---

## 4. 预期目标

1. ✅ 用户可手动保存当前会话（带命名）
2. ✅ 用户可从列表中加载历史会话
3. ✅ 加载后恢复所有请求数据和 UI 状态
4. ✅ 支持删除和重命名
5. ✅ 不重复存储请求数据

---

## 5. 完成标准

- [ ] sessions 表创建成功
- [ ] 保存功能正常（记录时间范围 + UI 状态）
- [ ] 加载功能正常（根据时间范围查询请求）
- [ ] 会话列表 UI 正常显示
- [ ] 删除/重命名功能正常
- [ ] UI 状态恢复正确（过滤、视图模式）

---

## 6. 待确认问题

1. **会话导出**：是否需要支持导出为文件（JSON/HAR）？
2. **自动保存**：是否需要定时自动保存会话？
3. **会话上限**：最多保存多少个会话？
4. **清理策略**：是否需要自动清理过期会话？
