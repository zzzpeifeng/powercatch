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
  /** 命中的 Auto Responder 规则 ID */
  autoResponderRuleId?: string
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
  /** Auto Responder 规则 */
  autoResponderRules?: AutoResponderRule[]
  /** AI 代码分析配置 */
  aiCodeAnalysisConfig?: {
    repoUrl?: string
    branch?: string
    accessToken?: string
    authMethod?: 'http' | 'ssh'
    cloneDir?: string
    repoUrlHistory?: string[]
  }
}

/** 仓库配置（AI 代码分析） */
export interface RepoConfig {
  repoUrl: string
  repoType: 'github' | 'gitlab' | 'gitee' | 'bitbucket' | 'unknown'
  branch: string
  accessToken: string
  authMethod: 'http' | 'ssh'
  cloneDir: string
  repoUrlHistory: string[]
}

/** AI 代码分析请求参数 */
export interface CodeAnalysisRequest {
  repoUrl: string
  branch: string
  accessToken: string
  authMethod: 'http' | 'ssh'
  method: string
  url: string
  path: string
  requestBody?: string
  requestHeaders?: Record<string, string | string[]>
  modelName?: string
  apiUrl?: string
  apiKey?: string
  request?: CaptureRequest | AnalysisRequestInfo
}

/** 测试场景 */
export interface TestScenario {
  type: string
  title: string
  description?: string
  curl: string
  pythonAssertion: string
}

/** AI 代码分析结果 */
export interface CodeAnalysisResult {
  success: boolean
  routeMatches?: RouteMatch[]
  repoInfo?: any
  repoName?: string
  scenarios?: TestScenario[]
  routeInfo?: any
  modelName?: string
  analyzedAt?: string
  analysis?: string
  message?: string
  error?: string
}

/** Clone 进度 */
export interface CloneProgress {
  status: 'cloning' | 'done' | 'error'
  percent: number
  message?: string
}

/** 磁盘空间检查结果 */
export interface DiskSpaceResult {
  hasEnoughSpace: boolean
  warning?: string
  error?: string
}

/** Git 可用性检查结果 */
export interface GitAvailabilityResult {
  available: boolean
  error?: string
}

/** 请求信息（用于分析） */
export interface AnalysisRequestInfo {
  method: string
  url: string
  path: string
  requestBody?: string
  requestHeaders?: Record<string, string | string[]>
}

/** 代码文件类型分类 */
export type FileType = 'handler' | 'model' | 'service' | 'other'

/** 代码文件（用于 AI 分析上下文） */
export interface CodeFile {
  filePath: string
  content: string
  fileType: FileType
}

/** 路由匹配结果 */
export interface RouteMatch {
  filePath: string
  content: string
  routePattern: string
  handlerName: string
  lineNumber: number
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

/** Auto Responder 规则 */
export interface AutoResponderRule {
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
  /** 响应配置 */
  response: {
    /** HTTP 状态码 */
    statusCode: number
    /** 响应头 */
    headers: Record<string, string>
    /** 响应体（字符串） */
    body: string
    /** 响应延迟（毫秒，0 = 无延迟） */
    delay: number
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

  // ===== AI 代码分析 =====
  AI_ANALYZE: 'ai:analyze',
  AI_ABORT: 'ai:abort',
  AI_CLEANUP_REPO: 'ai:cleanup-repo',
  AI_CHECK_GIT_AVAILABILITY: 'ai:check-git-availability',
  AI_CLONE_PROGRESS: 'ai:clone-progress',
  AI_CHECK_DISK_SPACE: 'ai:check-disk-space',
  AI_FETCH_BRANCHES: 'ai:fetch-branches',
  AI_CODE_ANALYZE_STREAM_CHUNK: 'ai:code-analyze-stream-chunk',
  AI_CODE_ANALYZE_STREAM_END: 'ai:code-analyze-stream-end',

  // ===== AI 混合模式（新增）=====
  // SSE 服务器控制
  AI_SSE_START: 'ai:sse-start',
  AI_SSE_STOP: 'ai:sse-stop',
  AI_SSE_GET_PORT: 'ai:sse-get-port',

  // 分析控制
  AI_START_ANALYSIS: 'ai:start-analysis',
  AI_CANCEL_ANALYSIS: 'ai:cancel-analysis',
  AI_GET_LOGS: 'ai:get-logs',

  // 分析进度推送
  AI_ANALYSIS_LOG: 'ai:analysis-log',
  AI_ANALYSIS_PROGRESS: 'ai:analysis-progress',
  AI_ANALYSIS_DONE: 'ai:analysis-done',
  AI_ANALYSIS_ERROR: 'ai:analysis-error',

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

  // Auto Responder 功能
  AUTO_RESPONDER_GET_RULES: 'auto-responder:get-rules',
  AUTO_RESPONDER_ADD_RULE: 'auto-responder:add-rule',
  AUTO_RESPONDER_REMOVE_RULE: 'auto-responder:remove-rule',
  AUTO_RESPONDER_UPDATE_RULE: 'auto-responder:update-rule',
  AUTO_RESPONDER_SYNC_RULES: 'auto-responder:sync-rules',

  // 会话管理
  SESSION_SAVE: 'session:save',
  SESSION_LIST: 'session:list',
  SESSION_LOAD_REQUESTS: 'session:load-requests',
  SESSION_DELETE: 'session:delete',
  SESSION_RENAME: 'session:rename',

  // 请求重放
  REQUEST_REPLAY: 'request:replay',
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

// ===== AI 混合模式类型定义（新增）=====

/**
 * 分析阶段枚举
 */
export type AnalysisPhase =
  | 'idle'              // 空闲
  | 'cloning'          // 克隆仓库中
  | 'scanning'         // 阶段1：扫描中
  | 'scan-failed'      // 阶段1：扫描失败
  | 'code-exploring'   // Phase 1：代码探索中（两阶段 Pipeline）
  | 'analyzing'        // 阶段2：AI 分析中
  | 'test-generating'  // Phase 2：测试用例生成中（两阶段 Pipeline）
  | 'generating'       // 生成报告中
  | 'done'             // 完成
  | 'error'            // 错误

/**
 * 实时日志条目
 */
export interface AnalysisLogEntry {
  /** 日志 ID（递增） */
  id: number
  /** 时间戳（ISO 8601） */
  timestamp: string
  /** 日志级别 */
  level: 'info' | 'warn' | 'error' | 'debug'
  /** 日志消息 */
  message: string
}

/**
 * 场景调用链路步骤
 */
export interface CallChainStep {
  /** 步骤序号 */
  step: number
  /** 组件类型（Router/Handler/Service/Model/DB） */
  component: string
  /** 文件路径 */
  filePath: string
  /** 函数名 */
  functionName: string
  /** 描述 */
  description: string
}

/**
 * 场景来源引用（P0-6 新增）
 * 说明测试场景覆盖了哪个代码结论
 */
export interface SourceRef {
  /** 来源类型 */
  sourceType: 'param' | 'branch' | 'businessRule' | 'errorPath' | 'externalCall' | 'featureFlag'
  /** 来源标识（如 params.ProductInfos、businessRules[0]） */
  sourceId: string
  /** 文件路径 */
  filePath: string
  /** 行范围（如 "45-52"） */
  lineRange: string
  /** 触发条件 */
  condition?: string
  /** 覆盖意图（为什么需要这个场景） */
  coverageIntent: string
}

/**
 * 场景校验警告（P1-1 新增）
 */
export interface ScenarioValidationWarning {
  /** 警告代码 */
  code: string
  /** 警告消息 */
  message: string
  /** 严重程度 */
  severity: 'info' | 'warning' | 'error'
  /** 相关来源类型 */
  sourceType?: string
  /** 相关来源标识 */
  sourceId?: string
}

/**
 * 场景类型（两阶段 Pipeline 使用）
 * 保留旧类型 (param-error/auth-error) 作为过渡，Phase 3.2 删除
 */
export type ScenarioType =
  // ===== v2.0 新增类型（12 种）=====
  | 'normal'           // 正常流程（200）
  | 'missing-required' // 必填字段缺失（400）
  | 'boundary'         // 边界值（400）
  | 'type-error'       // 类型错误（400）
  | 'format-error'     // 格式错误（400）
  | 'business-rule'    // 业务规则违反（400/422）
  | 'auth-missing'     // 缺少认证（401）
  | 'auth-expired'     // 认证过期（401）
  | 'forbidden'        // 权限不足（403）
  | 'not-found'        // 资源不存在（404）
  | 'conflict'         // 资源冲突（409）
  | 'server-error'     // 服务端错误（500）
  // ===== 旧类型（过渡期保留，Phase 3.2 删除）=====
  | 'param-error'      // @deprecated 请用 missing-required/boundary/type-error
  | 'auth-error'       // @deprecated 请用 auth-missing/auth-expired

/**
 * 场景定义
 */
export interface AnalysisScenario {
  /** 场景名称 */
  scenarioName: string
  /** 场景类型 */
  scenarioType: ScenarioType
  /** 预期 HTTP 状态码（v2.0 新增） */
  expectedStatusCode?: number
  /** 测试用入参（v2.0 新增） */
  testData?: Record<string, any>
  /** 调用链路 */
  callChain: CallChainStep[]
  /** curl 命令 */
  curlCommand: string
  /** Python 断言代码 */
  pythonAssertion: string
  /** 场景来源引用（P0-6 新增，说明覆盖了哪个代码结论） */
  sourceRefs?: SourceRef[]
  /** 场景校验警告（P1-1 新增） */
  validationWarnings?: ScenarioValidationWarning[]
}

/**
 * AI 深度分析结果
 */
export interface AIDeepAnalysisResult {
  /** 是否成功 */
  success: boolean
  /** 仓库名称 */
  repoName?: string
  /** Handler 文件 */
  handlerFile?: string
  /** Handler 函数 */
  handlerFunction?: string
  /** 3 个场景 */
  scenarios: AnalysisScenario[]
  /** 分析摘要（Markdown） */
  analysisSummary?: string
  /** 错误信息 */
  error?: string
  /** 是否触发了兜底分析（阶段1失败后自动触发阶段2） */
  usedFallback?: boolean
}

/**
 * 分析进度（实时推送）
 */
export interface AnalysisProgress {
  /** 当前阶段 */
  phase: AnalysisPhase
  /** 进度百分比（0-100） */
  percent: number
  /** 当前步骤描述 */
  currentStep?: string
  /** 日志条目列表 */
  logs: AnalysisLogEntry[]
}

/**
 * SSE 消息格式
 */
export interface SSEMessage {
  /** 消息类型 */
  type: 'connected' | 'log' | 'progress' | 'agent_thinking' | 'agent_tool_call' | 'agent_tool_result' | 'heartbeat' | 'done' | 'error' | 'disconnect'
  /** 消息数据 */
  data: any
  /** 时间戳 */
  timestamp?: number
}

/**
 * SSE 连接状态
 */
export type SSEConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

/**
 * SSE 事件类型（后端推送）
 */
export interface SSEEvent {
  /** 事件类型 */
  event: string
  /** 事件数据（JSON 字符串或对象） */
  data: string | object
  /** 时间戳 */
  timestamp?: number
}

/**
 * 心跳消息
 */
export interface SSEHeartbeat {
  timestamp: number
}

/**
 * 连接成功消息
 */
export interface SSEConnected {
  message: string
}

/**
 * 进度消息
 */
export interface SSEProgress {
  phase: string
  message: string
  extra?: any
}

/**
 * 日志消息
 */
export interface SSELog {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

/**
 * AI Agent 思考过程消息
 */
export interface SSEAgentThinking {
  content: string
}

/**
 * AI Agent 工具调用消息
 */
export interface SSEAgentToolCall {
  tool: string
  args?: any
}

/**
 * AI Agent 工具结果消息
 */
export interface SSEAgentToolResult {
  tool: string
  result: any
}

/** 请求重放参数 */
export interface ReplayRequest {
  /** HTTP 方法 */
  method: HttpMethod
  /** 完整 URL */
  url: string
  /** 请求头 */
  requestHeaders: HttpHeaders
  /** 请求体 */
  requestBody: string
}

/** 请求重放结果 */
export interface ReplayResult {
  /** 是否成功 */
  success: boolean
  /** HTTP 状态码 */
  statusCode?: number
  /** 响应头 */
  responseHeaders?: HttpHeaders
  /** 响应体 */
  responseBody?: string
  /** 耗时（ms） */
  duration?: number
  /** 错误信息 */
  error?: string
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

/** 会话元数据（Session = 元数据 + 时间范围引用，不复制请求数据） */
export interface CaptureSession {
  /** 会话 ID */
  id: number
  /** 会话名称（用户自定义） */
  name: string
  /** 会话开始时间（ISO 8601） */
  startTime: string
  /** 会话结束时间（ISO 8601） */
  endTime: string
  /** 会话期间的请求数 */
  requestCount: number
  /** 过滤条件 JSON（FilterState 的序列化） */
  filtersJson?: string
  /** 视图模式 */
  viewMode: 'list' | 'group'
  /** 域名过滤 JSON（string[] 的序列化） */
  domainFiltersJson?: string
  /** 创建时间 */
  createdAt: string
}

/** Diff 对比结果 */
export interface DiffResult {
  /** 概览统计 */
  overview: {
    same: string[]
    different: string[]
    stats: {
      requestHeaders: { added: number; removed: number; modified: number }
      requestBody: { changes: number }
      responseHeaders: { added: number; removed: number; modified: number }
      responseBody: { changes: number }
    }
  }
  requestHeaders: {
    added: Record<string, string>
    removed: Record<string, string>
    modified: Array<{ key: string; old: string; new: string }>
  }
  requestBody: {
    type: 'json' | 'text' | 'binary' | 'empty'
    delta?: any
    changes?: Array<{ value: string; added?: boolean; removed?: boolean }>
  }
  responseHeaders: {
    added: Record<string, string>
    removed: Record<string, string>
    modified: Array<{ key: string; old: string; new: string }>
  }
  responseBody: {
    type: 'json' | 'text' | 'binary' | 'empty'
    delta?: any
    changes?: Array<{ value: string; added?: boolean; removed?: boolean }>
  }
}
