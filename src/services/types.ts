/**
 * TypeScript 类型定义 - 抓包对比工具
 * 所有共享类型定义集中在此文件
 */

/** HTTP 请求方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

/** HTTP 请求头/响应头 */
export type HttpHeaders = Record<string, string | string[] | undefined>

/** 抓包请求数据（内存中） */
export interface CaptureRequest {
  /** 唯一标识（内存中使用时间戳+随机数） */
  id: string
  /** HTTP 方法 */
  method: HttpMethod
  /** 完整 URL */
  url: string
  /** 请求路径（如 /order/detail） */
  path: string
  /** 域名 */
  host: string
  /** HTTP 状态码 */
  statusCode: number | null
  /** 响应耗时（ms） */
  duration: number | null
  /** 请求头 JSON */
  requestHeaders: HttpHeaders
  /** 请求体 */
  requestBody: string
  /** 响应头 JSON */
  responseHeaders: HttpHeaders
  /** 响应体 */
  responseBody: string
  /** 客户端 IP */
  clientIp: string
  /** 设备别名（自动关联） */
  deviceName: string
  /** 捕获时间 */
  capturedAt: string
  /** 是否在录制状态下捕获 */
  isRecorded: boolean
  /** 是否被选中查看详情（前端状态） */
  selected: boolean
  /** 是否被勾选用于对比（前端状态，最多 2 个） */
  checked: boolean
  /** 断点状态 */
  breakpointStatus?: BreakpointStatus
  /** 命中的 Map Local 规则 ID */
  mapLocalRuleId?: string
  /** 命中的 Map Remote 规则 ID */
  mapRemoteRuleId?: string
}

/** 响应更新数据（通过独立 channel 推送，仅包含响应相关字段） */
export interface RequestUpdate {
  /** 请求 ID（与之前推送的请求对应） */
  id: string
  /** HTTP 状态码 */
  statusCode: number | null
  /** 响应耗时（ms） */
  duration: number
  /** 请求头（可能在上行时收集） */
  requestHeaders: HttpHeaders
  /** 请求体（可能在上行时收集） */
  requestBody: string
  /** 响应头 */
  responseHeaders: HttpHeaders
  /** 响应体 */
  responseBody: string
}

/** 数据库中的请求记录 */
export interface DbRequest {
  id: number
  method: string
  url: string
  path: string
  host: string
  status_code: number | null
  duration: number | null
  request_headers: string | null
  request_body: string | null
  response_headers: string | null
  response_body: string | null
  client_ip: string
  device_name: string | null
  captured_at: string
  is_recorded: number
}

/** 对比记录 */
export interface ComparisonRecord {
  id: number
  request_a_id: number
  request_b_id: number
  ai_result: string | null
  model_name: string | null
  created_at: string
}

/** 设置项 */
export interface AppSettings {
  apiUrl: string
  apiKey: string
  modelName: string
  proxyPort: number
  deviceAliases: Record<string, string>
  aiPromptTemplate: string
  domainFilters: string[]
  /** 本地 IP 地址 */
  localIp: string
  /** CA 证书状态 */
  caCertGenerated: boolean
  /** 主题设置 */
  theme?: 'light' | 'dark' | 'system'
  /** 断点规则 */
  breakpointRules?: BreakpointRule[]
  /** Map Local 规则 */
  mapLocalRules?: MapLocalRule[]
  /** Map Remote 规则 */
  mapRemoteRules?: MapRemoteRule[]
}

/** 设备信息 */
export interface DeviceInfo {
  ip: string
  alias: string
}

/** AI 对比请求参数 */
export interface CompareRequest {
  requestA: CaptureRequest
  requestB: CaptureRequest
  promptTemplate: string
  modelName: string
  apiUrl: string
  apiKey: string
}

/** AI 对比结果 */
export interface CompareResult {
  /** AI 返回的分析文本 */
  analysis: string
  /** 使用的模型名 */
  modelName: string
  /** 请求路径 */
  path: string
  /** 设备 A 信息 */
  deviceA: { name: string; ip: string }
  /** 设备 B 信息 */
  deviceB: { name: string; ip: string }
  /** 是否正在流式输出 */
  isStreaming: boolean
}

/** 导出格式 */
export type ExportFormat = 'json' | 'html' | 'txt'

/** 导出请求参数 */
export interface ExportRequest {
  format: ExportFormat
  compareResult: CompareResult
  requestA: CaptureRequest
  requestB: CaptureRequest
}

/** Toast 类型 */
export type ToastType = 'success' | 'error' | 'warning' | 'info'

/** Toast 消息 */
export interface Toast {
  id: number
  type: ToastType
  message: string
  duration: number
}

/** Loading 状态 */
export interface LoadingStates {
  comparing: boolean
  exporting: boolean
  testingConnection: boolean
  startingProxy: boolean
}

/** 代理状态 */
export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'stopping'

/** 断点规则 */
export interface BreakpointRule {
  /** 规则 ID */
  id: string
  /** 是否启用 */
  enabled: boolean
  /** 规则名称（用户自定义） */
  name: string
  /** 匹配模式 */
  match: {
    /** URL 通配符，如 *api.shopline.com/login* */
    urlPattern: string
    /** HTTP 方法过滤（空 = 所有方法） */
    methods: HttpMethod[]
  }
  /** 拦截阶段 */
  stage: 'request' | 'response' | 'both'
  /** 创建时间 */
  createdAt: string
}

/** Map Local 映射规则 */
export interface MapLocalRule {
  /** 规则 ID */
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

/** Map Remote 映射规则 */
export interface MapRemoteRule {
  /** 规则 ID */
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
  /** 目标地址 */
  target: {
    /** 目标协议（http/https） */
    protocol: 'http' | 'https'
    /** 目标主机名 */
    host: string
    /** 目标端口（空 = 默认端口） */
    port?: number
    /** 路径替换（可选，空 = 保留原路径） */
    pathReplacement?: string
  }
  /** 创建时间 */
  createdAt: string
}

/** 拦截会话 */
export interface InterceptSession {
  /** 会话 ID */
  id: string
  /** 触发的规则 ID */
  ruleId: string
  /** 拦截阶段 */
  stage: 'request' | 'response'
  /** 用户可编辑的副本 */
  editable: {
    method: HttpMethod
    url: string
    requestHeaders: HttpHeaders
    requestBody: string
    /** 仅 response 阶段可编辑 */
    statusCode?: number
    responseHeaders?: HttpHeaders
    responseBody?: string
  }
  /** 原始数据快照（用于"恢复原始"按钮） */
  original: {
    method: HttpMethod
    url: string
    requestHeaders: HttpHeaders
    requestBody: string
    statusCode?: number
    responseHeaders?: HttpHeaders
    responseBody?: string
  }
  /** 状态 */
  status: 'waiting' | 'resumed' | 'aborted'
  /** 命中时间 */
  interceptedAt: string
}

/** 断点恢复载荷 */
export interface BreakpointResumePayload {
  sessionId: string
  action: 'resume' | 'abort'
  /** action='resume' 时，完整的编辑后数据（全量，非增量） */
  modified?: {
    method: HttpMethod
    url: string
    requestHeaders: HttpHeaders
    requestBody: string
    statusCode?: number
    responseHeaders?: HttpHeaders
    responseBody?: string
  }
}

/** 请求断点状态 */
export type BreakpointStatus = 'intercepting' | 'resumed' | 'aborted'

/** 代理信息 */
export interface ProxyInfo {
  status: ProxyStatus
  port: number
  localIp: string
  certUrl: string
}

/** 系统代理操作结果 */
export interface ProxyOperationResult {
  success: boolean
  message: string
}

/** 系统代理状态详情 */
export interface SystemProxyDetail {
  serviceName: string
  http: string
  https: string
}

/** 系统代理状态 */
export interface SystemProxyStatus {
  isActive: boolean
  details: SystemProxyDetail[]
}

/** IPC 通道名称常量 */
export const IPC_CHANNELS = {
  // 代理控制
  PROXY_START: 'proxy:start',
  PROXY_STOP: 'proxy:stop',
  PROXY_STATUS: 'proxy:status',
  PROXY_NEW_REQUEST: 'proxy:new-request',
  PROXY_REQUEST_UPDATED: 'proxy:request-updated',
  PROXY_SET_DOMAIN_FILTERS: 'proxy:set-domain-filters',

  // 系统代理
  PROXY_SET_SYSTEM: 'proxy:set-system',
  PROXY_CLEAR_SYSTEM: 'proxy:clear-system',
  PROXY_GET_SYSTEM_STATUS: 'proxy:get-system-status',

  // 请求数据
  REQUEST_PERSIST: 'request:persist',
  REQUEST_GET_ALL: 'request:get-all',

  // AI 对比
  AI_COMPARE: 'ai:compare',
  AI_STREAM_CHUNK: 'ai:stream-chunk',
  AI_STREAM_END: 'ai:stream-end',
  AI_TEST_CONNECTION: 'ai:test-connection',

  // 导出
  EXPORT_FILE: 'export:file',

  // 设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_SAVE_ALL: 'settings:save-all',

  // 设备
  DEVICE_GET_ALIASES: 'device:get-aliases',
  DEVICE_SET_ALIAS: 'device:set-alias',

  // CA 证书
  CA_GENERATE: 'ca:generate',
  CA_GET_STATUS: 'ca:get-status',
  CA_GET_PATH: 'ca:get-path',

  // 系统
  SYSTEM_GET_LOCAL_IP: 'system:get-local-ip',
  SYSTEM_OPEN_PATH: 'system:open-path',
  SYSTEM_OPEN_URL: 'system:open-url',

  // 对比记录
  COMPARE_SAVE: 'compare:save',
  COMPARE_GET_HISTORY: 'compare:get-history',

  // 窗口
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // SSL 错误处理
  SSL_ERROR_NOTIFY: 'ssl:error-notify',
  SSL_GET_STATS: 'ssl:get-stats',
  SSL_GET_REPORT: 'ssl:get-report',
  SSL_CLEAR: 'ssl:clear',
  SSL_ADD_PINNED_DOMAIN: 'ssl:add-pinned-domain',

  // WiFi 自动配置
  WIFI_GENERATE_CONFIG: 'wifi:generate-config',
  WIFI_START_SERVER: 'wifi:start-server',
  WIFI_STOP_SERVER: 'wifi:stop-server',
  WIFI_GET_QR: 'wifi:get-qr',
  WIFI_GET_CURRENT: 'wifi:get-current',
  WIFI_GET_CURRENT_AIRPORT: 'wifi:get-current-airport', // 使用 airport 命令

  // 断点功能
  BREAKPOINT_ADD_RULE: 'breakpoint:add-rule',
  BREAKPOINT_REMOVE_RULE: 'breakpoint:remove-rule',
  BREAKPOINT_UPDATE_RULE: 'breakpoint:update-rule',
  BREAKPOINT_GET_RULES: 'breakpoint:get-rules',
  BREAKPOINT_INTERCEPTED: 'breakpoint:intercepted',
  BREAKPOINT_RESUME: 'breakpoint:resume',
  BREAKPOINT_ABORT: 'breakpoint:abort',
  BREAKPOINT_STATUS_UPDATE: 'breakpoint:status-update',

  // Map Local 功能
  MAP_LOCAL_GET_RULES: 'map-local:get-rules',
  MAP_LOCAL_ADD_RULE: 'map-local:add-rule',
  MAP_LOCAL_REMOVE_RULE: 'map-local:remove-rule',
  MAP_LOCAL_UPDATE_RULE: 'map-local:update-rule',
  MAP_LOCAL_SYNC_RULES: 'map-local:sync-rules',

  // Map Remote 功能
  MAP_REMOTE_GET_RULES: 'map-remote:get-rules',
  MAP_REMOTE_ADD_RULE: 'map-remote:add-rule',
  MAP_REMOTE_REMOVE_RULE: 'map-remote:remove-rule',
  MAP_REMOTE_UPDATE_RULE: 'map-remote:update-rule',
  MAP_REMOTE_SYNC_RULES: 'map-remote:sync-rules',
} as const

/** IPC 通道名称类型 */
export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

/** 模板变量定义 */
export interface TemplateVariable {
  key: string
  description: string
}

/** 可用模板变量列表 */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: '{path}', description: '请求路径（如 /order/detail）' },
  { key: '{device_a_name}', description: '设备 A 名称（别名或 IP）' },
  { key: '{device_b_name}', description: '设备 B 名称（别名或 IP）' },
  { key: '{client_ip_a}', description: '设备 A 的 IP 地址' },
  { key: '{client_ip_b}', description: '设备 B 的 IP 地址' },
  { key: '{response_a_json}', description: '设备 A 的响应体 JSON' },
  { key: '{response_b_json}', description: '设备 B 的响应体 JSON' },
  { key: '{request_method}', description: '请求方法（GET/POST 等）' },
  { key: '{request_headers_a}', description: '设备 A 的请求头' },
  { key: '{request_headers_b}', description: '设备 B 的请求头' },
]

/** AI Prompt 默认模板 v1（详细版） */
export const DEFAULT_PROMPT_V1 = `你是一个接口数据对比分析专家。请对比以下两个 JSON 响应数据的差异。

【请求路径】: {path}
【设备 A】: {device_a_name} ({client_ip_a})
【设备 B】: {device_b_name} ({client_ip_b})

【设备 A 响应】:
{response_a_json}

【设备 B 响应】:
{response_b_json}

对比规则：
1. 以下字段属于动态字段，天然不同，无需关注差异：
   - ID 类: id, orderId, traceId, paySeq, variantId, productId, fulfillmentId, orderSeq 等所有以 Id/ID/Seq 结尾的字段
   - 时间类: createdAt, updatedAt, orderTime 等所有时间戳字段
   - 链接类: orderStatusUrl, imageUrl 等 URL 字段
2. 重点关注以下业务字段的差异：
   - 金额类: price, totalTax, totalDiscounts, payAmount, refundAmount, finalPrice 等
   - 状态类: status, financialStatus, fulfillmentStatus, payStatus 等
   - 数量类: quantity, fulfillableQuantity 等
   - 配置类: currency, methodCode, paymentChannel, orderSource 等
   - 结构类: 字段缺失、字段多余、数组长度不同、嵌套结构差异
3. 如果两个字段的值仅在精度上有微小差异（如 14.03 vs 14.05），单独标注为「精度差异」
4. 如果某个字段在一个响应中存在、另一个中不存在，标注为「字段缺失」

请按以下格式输出对比结果：
1. 【关键差异】— 业务字段的实质性差异（金额、状态、结构等），每条说明路径、A 的值、B 的值、影响分析
2. 【精度差异】— 数值精度不一致的字段
3. 【字段缺失】— 一方存在另一方不存在的字段
4. 【一致的业务字段】— 关键业务字段中值一致的（简要列出即可）
5. 【总结】— 差异是否为预期行为，是否需要关注，建议下一步操作

使用中文输出。`

/** AI Prompt 默认模板 v2（精简版） */
export const DEFAULT_PROMPT_V2 = `对比以下两个 JSON 响应的差异。

请求: {path}
设备A ({device_a_name}): {response_a_json}
设备B ({device_b_name}): {response_b_json}

忽略所有 ID、时间戳、URL 等动态字段。
只关注业务字段差异：金额、状态、数量、结构。
输出格式：关键差异 | 精度差异 | 字段缺失 | 总结`

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

/** 域名排序模式 */
export type DomainSortMode = 'latest' | 'count' | 'alphabetical'

/** 树节点类型 */
export type TreeNodeType = 'domain' | 'request'

/** 域名节点（树的非叶子节点） */
export interface DomainNode {
  type: 'domain'
  host: string
  children: CaptureRequest[]
  count: number
  hasError: boolean
  pendingCount: number
  latestCapturedAt: string
  hasSelected: boolean
  hasChecked: boolean
}

/** 展平后的虚拟滚动行（统一格式） */
export interface FlatTreeNode {
  type: TreeNodeType
  key: string
  depth: number
  /** domain 字段 */
  host?: string
  /** 带协议前缀的域名，如 'https://api.example.com' */
  displayHost?: string
  count?: number
  /** 搜索时的总数（显示 "5/12 条"） */
  totalCount?: number
  hasError?: boolean
  pendingCount?: number
  expanded?: boolean
  hasSelected?: boolean
  hasChecked?: boolean
  /** request 字段 */
  request?: CaptureRequest
}
