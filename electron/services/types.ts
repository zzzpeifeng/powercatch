/**
 * AI 代码分析内部类型定义（仅主进程使用）
 *
 * 这些类型用于两阶段 Pipeline 的内部数据传递，不暴露给前端。
 * 前端使用的类型在 src/services/types.ts 中定义。
 */

// ============================================================
// Phase 1: Code Explorer Agent 输出类型
// ============================================================

/**
 * 代码证据
 */
export interface Evidence {
  /** 文件路径 */
  filePath: string
  /** 行范围（如 "120-138"） */
  lineRange: string
  /** 代码片段（最多 200 字符） */
  snippet: string
  /** 为什么这是证据 */
  reason: string
}

/**
 * 项目技术栈信息
 */
export interface ProjectProfile {
  /** 编程语言列表 */
  languages: string[]
  /** 框架列表 */
  frameworks: string[]
}

/**
 * 未解决项（Phase 1 找不到但应该找的内容）
 */
export interface UnresolvedItem {
  /** 类型 */
  type: 'header' | 'validation' | 'feature-flag' | 'error-mapping' | 'response' | 'external-call'
  /** 描述（未找到什么） */
  description: string
  /** 影响（缺失会导致什么问题） */
  impact: string
}

/**
 * 入口点信息
 */
export interface EntryPoint {
  /** Handler 文件路径 */
  handlerFile: string
  /** Handler 函数名 */
  handlerFunction: string
  /** 路由模式（如 POST /api/v1/orders/checkout） */
  routePattern: string
  /** 使用的框架 */
  framework: 'gin' | 'echo' | 'fiber' | 'chi' | 'lego' | 'net/http' | 'unknown'
}

/**
 * 调用链节点
 */
export interface CallChainNode {
  /** 深度（0=Handler） */
  depth: number
  /** 层级 */
  layer: 'middleware' | 'handler' | 'service' | 'repository' | 'external'
  /** 文件路径 */
  filePath: string
  /** 函数名 */
  functionName: string
  /** 行范围（如 "45-78"） */
  lineRange: string
  /** 描述 */
  description: string
  /** 输入参数列表 */
  inputParams: string[]
  /** 输出类型 */
  outputType: string
  /** 条件分支列表 */
  branches: CallChainBranch[]
  /** 被调用的下游函数 */
  callees: string[]
}

/**
 * 调用链中的条件分支
 */
export interface CallChainBranch {
  /** 条件表达式 */
  condition: string
  /** 分支动作 */
  action: string
  /** 分支类型 */
  type: 'param-validation' | 'auth' | 'business-rule' | 'error-return' | 'feature-flag'
}

/**
 * 参数定义
 */
export interface ParamDefinition {
  /** 参数名 */
  name: string
  /** 参数位置 */
  location: 'query' | 'path' | 'header' | 'body'
  /** 参数类型 */
  type: string
  /** 是否必填 */
  required: boolean
  /** 约束条件 */
  constraints: {
    min?: number | null
    max?: number | null
    pattern?: string | null
    enum?: string[] | null
  }
  /** 默认值 */
  defaultValue: any
  /** 描述 */
  description: string
  /** 来源标记（如 struct tag、Check() 方法） */
  sourceTag: string
}

/**
 * 响应结构字段
 */
export interface RespField {
  /** 字段路径（如 "data.storeId"） */
  path: string
  /** 字段类型 */
  type: string
  /** 描述 */
  description: string
  /** 示例值（可选） */
  exampleValue?: any
}

/**
 * 业务规则
 */
export interface BusinessRule {
  /** 规则类型 */
  type: 'status-check' | 'permission' | 'rate-limit' | 'business-logic'
  /** 所在文件 */
  file: string
  /** 所在行 */
  line: number
  /** 条件表达式 */
  condition: string
  /** 动作（如 "return error"） */
  action: string
  /** 触发场景描述 */
  triggerScenario: string
  /** 代码证据（P0-1 新增） */
  evidence?: Evidence
}

/**
 * 错误路径
 */
export interface ErrorPath {
  /** HTTP 状态码 */
  statusCode: number
  /** 业务错误码 */
  errorCode: string
  /** 触发条件 */
  condition: string
  /** 所在文件 */
  file: string
  /** 所在行 */
  line: number
  /** 代码证据（P0-1 新增） */
  evidence?: Evidence
}

/**
 * 外部调用
 */
export interface ExternalCall {
  /** 调用类型 */
  type: 'database' | 'http' | 'grpc' | 'cache'
  /** 目标 */
  target: string
  /** 操作（如 SELECT、POST） */
  operation: string
  /** 所在文件 */
  file: string
  /** 所在行 */
  line: number
  /** 代码证据（P0-1 新增） */
  evidence?: Evidence
}

/**
 * Code Explorer Agent 完整输出
 * 这是 Phase 1 产生、Phase 2 消费的中间数据结构
 */
export interface CodeExplorationResult {
  /** 项目技术栈信息（P0-2 新增） */
  projectProfile?: ProjectProfile
  /** 入口点信息 */
  entryPoint: EntryPoint
  /** 完整调用链（含分支信息） */
  fullCallChain: CallChainNode[]
  /** 入参定义 + 校验规则 */
  params: ParamDefinition[]
  /** 响应结构 */
  respStructure: {
    type: string
    fields: RespField[]
  }
  /** 业务规则（if/switch 分支） */
  businessRules: BusinessRule[]
  /** 错误路径 */
  errorPaths: ErrorPath[]
  /** 外部服务/DB 调用 */
  externalCalls: ExternalCall[]
  /** 未解决项（P0-3 新增） */
  unresolvedItems?: UnresolvedItem[]
  /** JSON 解析状态（新增：complete=完整解析，partial=部分提取，failed=解析失败） */
  parseStatus?: 'complete' | 'partial' | 'failed'
  /** 解析警告信息（新增） */
  parseWarnings?: string[]
}
