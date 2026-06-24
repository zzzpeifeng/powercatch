/**
 * Prompt 构建服务
 * 负责构建 AI 分析的 Prompt，包括 Token 计算和文件压缩
 */
import type { AnalysisRequestInfo, CodeFile, RouteMatch } from '../../src/services/types'

/** Token 管理常量 */
const MAX_TOKENS_PER_REQUEST = 100000
const TOKEN_COMPRESSION_THRESHOLD = 90000
const TOKEN_WARNING_THRESHOLD = 80000

/**
 * 简单 Token 估算（1 Token ≈ 4 字符）
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * 精确 Token 计算（降级为简单估算，避免 tiktoken 依赖）
 */
export async function countTokensPrecise(text: string, _model: string): Promise<number> {
  // 使用简单估算（1 Token ≈ 4 字符），避免引入 tiktoken 原生依赖
  return estimateTokenCount(text)
}

/**
 * 基础 Prompt
 */
export function buildBasePrompt(): string {
  return `你是一个资深的后端代码分析专家和接口测试工程师。

你的任务是：根据给定的接口信息和仓库代码，分析接口的完整链路逻辑，
并生成多条覆盖不同测试场景的 curl 命令和 Python 断言代码。

## 分析步骤
1. 定位接口路由：找到代码中匹配的路由注册和 Handler 函数
2. 分析入参：从 Handler 函数签名和 DTO 定义中提取参数信息
3. 分析出参：从返回值类型中提取响应结构
4. 追踪调用链：从 Handler → Service → Model 完整链路
5. 识别业务逻辑：参数校验、数据库操作、外部调用等
6. 生成测试用例：覆盖正常、边界值、异常场景`
}

/**
 * Go 语言扩展 Prompt
 */
export function buildGoExtension(): string {
  return `
## Go 语言分析规则

### 路由模式识别
- **Gin**: r.POST("/path", handler) / r.Group("/prefix").GET("/path", handler)
- **Echo**: e.POST("/path", handler)
- **Fiber**: app.Post("/path", handler)
- **Chi**: r.Post("/path", handler)
- **lego/webx**: router.Group("/prefix").METHOD("/path", sa.ControllerWithResp(pkg.Handler))
- **net/http**: http.HandleFunc("/path", handler)

### import 路径解析
- Go import 路径格式: github.com/user/repo/internal/xxx
- 映射到本地文件: ./internal/xxx
- 关注 internal/ 和 pkg/ 目录下的包

### DTO 识别
- struct 定义 + json tag: \`json:"fieldName"\`
- binding tag: \`binding:"required"\` 表示必填
- validate tag: \`validate:"gte=0,lte=150"\` 表示范围约束
- 注意区分 Request DTO 和 Response DTO

### Handler 函数签名模式
- 模式 1: func Handler(param *model.Param) (*model.Resp, error)
- 模式 2: func Handler(ctx *gin.Context)
- 模式 3: func Handler(ctx *lego.Context, param *model.Param) (*model.Resp, error)
- lego/webx 包装器: sa.ControllerWithResp / sa.ControllerWithReqResp / adapter.ControllerWithReqResp`
}

/**
 * Java 语言扩展 Prompt（v1.1）
 */
export function buildJavaExtension(): string {
  return `
## Java 语言分析规则（v1.1 Preview）

### 路由注解识别
- @GetMapping("/path")
- @PostMapping("/path")
- @PutMapping("/path")
- @DeleteMapping("/path")
- @RequestMapping(value = "/path", method = RequestMethod.POST)

### DTO 识别
- @JsonProperty / @Data / @Getter / @Setter
- @NotNull / @NotBlank / @Size / @Min / @Max
- javax.validation 约束注解

### 包结构
- controller/ → Handler 层
- service/ → 业务逻辑层
- model/ / entity/ / dto/ → 数据模型层
- mapper/ / repository/ → 数据访问层`
}

/**
 * 构建路由识别 Prompt（Stage 1）
 */
export function buildRouteIdentificationPrompt(
  request: AnalysisRequestInfo,
  routeFiles: RouteMatch[]
): string {
  const routeContext = routeFiles
    .map((rf, i) => `### 候选文件 ${i + 1}: ${rf.filePath}\n路由模式: ${rf.routePattern}\nHandler: ${rf.handlerName}\n\`\`\`go\n${rf.content}\n\`\`\``)
    .join('\n\n')

  return `## 任务：路由识别

### 目标接口
- 方法: ${request.method}
- 路径: ${request.path}
- 完整 URL: ${request.url}

### 候选路由文件
${routeContext || '（未找到候选文件）'}

### 请分析
请从候选文件中找到最匹配目标接口的路由注册，返回对应的 Handler 文件路径和函数名。

如果找不到完全匹配的，返回最相似的候选。

请严格按以下 JSON 格式输出（不要输出其他内容）：
\`\`\`json
{
  "filePath": "Handler 文件的完整路径",
  "handlerName": "Handler 函数名",
  "routePattern": "匹配到的路由模式",
  "confidence": "high/medium/low"
}
\`\`\``
}

/**
 * 构建代码上下文块
 */
function buildCodeContextBlock(files: CodeFile[]): string {
  return files
    .map((f) => {
      const lang = f.filePath.endsWith('.go') ? 'go' : f.filePath.endsWith('.java') ? 'java' : ''
      return `### 文件: ${f.filePath} (${f.fileType})\n\`\`\`${lang}\n${f.content}\n\`\`\``
    })
    .join('\n\n')
}

/**
 * 构建完整分析 Prompt（Stage 2）
 */
export function buildFullAnalysisPrompt(
  request: AnalysisRequestInfo,
  codeContext: CodeFile[],
  projectType: string
): string {
  const basePrompt = buildBasePrompt()
  const langExtension = projectType === 'go' ? buildGoExtension() : projectType === 'java' ? buildJavaExtension() : ''
  const codeBlock = buildCodeContextBlock(codeContext)

  const requestHeadersStr = request.requestHeaders
    ? JSON.stringify(request.requestHeaders, null, 2)
    : '（无）'

  return `${basePrompt}

${langExtension}

## 接口信息
- 方法: ${request.method}
- 路径: ${request.path}
- 完整 URL: ${request.url}
- 请求体（如有）: ${request.requestBody || '（无）'}
- 请求头（如有）: ${requestHeadersStr}

## 代码上下文
${codeBlock}

## 输出要求
请按以下 JSON 格式输出（不要输出其他内容）：

\`\`\`json
{
  "routeInfo": "接口路由注解信息（如找到的路由模式和 Handler）",
  "analysis": "链路分析（Markdown 格式，包含：路由定位、入参分析、出参分析、业务逻辑链路）",
  "scenarios": [
    {
      "type": "正常",
      "title": "场景标题",
      "description": "场景说明",
      "curl": "完整的 curl 命令（使用真实可用的测试入参，保留原始请求头）",
      "pythonAssertion": "Python 断言代码（只断言 JSON 字段，不含 setup/teardown，使用 requests 库）"
    },
    {
      "type": "边界值",
      "title": "场景标题",
      "description": "场景说明",
      "curl": "...",
      "pythonAssertion": "..."
    },
    {
      "type": "异常",
      "title": "场景标题",
      "description": "场景说明",
      "curl": "...",
      "pythonAssertion": "..."
    }
  ]
}
\`\`\`

注意：
1. curl 命令必须使用接口的实际 URL 和正确的请求方法，保留原始请求头（Cookie/Bearer Token 等）
2. 测试入参以抓包请求参数为基线，结合代码中的 DTO 定义生成，符合字段类型和约束
3. Python 断言只断言响应 JSON 的字段存在性和值，不需要完整的 pytest 套件
4. 至少生成 3 个场景：正常入参、边界值、异常入参（如缺少必填字段）
5. 每个场景的 curl 和 pythonAssertion 必须一一对应`
}

/**
 * M4: 压缩文件内容
 */
export function compressCodeFile(
  content: string,
  fileType: string,
  projectType: string
): string {
  if (projectType === 'go') {
    return compressGoFile(content, fileType)
  }
  if (projectType === 'java') {
    return compressJavaFile(content, fileType)
  }
  return content
}

/**
 * 压缩 Go 文件
 */
function compressGoFile(content: string, fileType: string): string {
  switch (fileType) {
    case 'handler':
      // Handler 文件保留完整内容
      return content

    case 'model':
    case 'dto':
      // Model/DTO 只保留 struct 定义，删除方法实现
      return compressGoModel(content)

    case 'service':
      // Service 文件压缩方法体
      return compressGoService(content)

    default:
      return content.slice(0, 3000)
  }
}

/**
 * 压缩 Go Model 文件：只保留 struct 定义
 */
function compressGoModel(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let inStruct = false
  let braceCount = 0
  let inImport = false

  for (const line of lines) {
    // 保留 package 声明
    if (line.startsWith('package ')) {
      result.push(line)
      continue
    }

    // 保留 import 块
    if (line.trim().startsWith('import')) {
      inImport = true
      result.push(line)
      if (line.includes(')')) inImport = false
      continue
    }
    if (inImport) {
      result.push(line)
      if (line.includes(')')) inImport = false
      continue
    }

    // 保留 struct 定义
    if (line.match(/type\s+\w+\s+struct\s*\{/)) {
      inStruct = true
      braceCount = 1
      result.push(line)
      continue
    }

    if (inStruct) {
      result.push(line)
      braceCount += (line.match(/\{/g) || []).length
      braceCount -= (line.match(/\}/g) || []).length
      if (braceCount <= 0) {
        inStruct = false
        result.push('') // 空行分隔
      }
      continue
    }

    // 保留 type 声明（interface, alias 等）
    if (line.match(/^type\s+/)) {
      result.push(line)
    }

    // 删除函数实现
  }

  return result.join('\n')
}

/**
 * 压缩 Go Service 文件：保留签名，压缩方法体
 */
function compressGoService(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let inFunc = false
  let braceCount = 0
  let funcBodyLines = 0
  const MAX_FUNC_BODY_LINES = 20

  for (const line of lines) {
    // 保留 package 声明和 import
    if (line.startsWith('package ') || line.trim().startsWith('import')) {
      result.push(line)
      continue
    }

    // 检测函数开始
    if (line.match(/^func\s+/)) {
      inFunc = true
      braceCount = 0
      funcBodyLines = 0
      result.push(line)
      if (line.includes('{')) braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      continue
    }

    if (inFunc) {
      braceCount += (line.match(/\{/g) || []).length
      braceCount -= (line.match(/\}/g) || []).length
      funcBodyLines++

      // 保留前 N 行和最后一行
      if (funcBodyLines <= MAX_FUNC_BODY_LINES || braceCount <= 0) {
        result.push(line)
      } else if (funcBodyLines === MAX_FUNC_BODY_LINES + 1) {
        result.push('    // ... 方法体已压缩 ...')
      }

      if (braceCount <= 0) {
        inFunc = false
        result.push('')
      }
      continue
    }

    // 保留其他顶层声明
    result.push(line)
  }

  return result.join('\n')
}

/**
 * 压缩 Java 文件（v1.1 预留）
 */
function compressJavaFile(content: string, fileType: string): string {
  // Java 压缩策略（v1.1 实现）
  switch (fileType) {
    case 'handler':
      return content
    case 'model':
    case 'dto':
      // 只保留字段定义和注解
      return content
    case 'service':
      return content.slice(0, 5000)
    default:
      return content.slice(0, 3000)
  }
}

/**
 * M4: 构建带 Token 检查的 Prompt
 */
export async function buildPromptWithTokenCheck(
  request: AnalysisRequestInfo,
  codeFiles: CodeFile[],
  projectType: string,
  aiConfig: { apiUrl: string; apiKey: string; modelName: string }
): Promise<string> {
  let prompt = buildFullAnalysisPrompt(request, codeFiles, projectType)
  let tokenCount = await countTokensPrecise(prompt, aiConfig.modelName)

  console.log(`[PromptBuilder] 初始 Token 数: ${tokenCount}`)

  if (tokenCount > TOKEN_COMPRESSION_THRESHOLD) {
    console.log('[PromptBuilder] Token 超过阈值，开始压缩文件...')

    // 压缩文件内容
    const compressedFiles = codeFiles.map((f) => ({
      ...f,
      content: compressCodeFile(f.content, f.fileType, projectType),
    }))
    prompt = buildFullAnalysisPrompt(request, compressedFiles, projectType)
    tokenCount = await countTokensPrecise(prompt, aiConfig.modelName)

    console.log(`[PromptBuilder] 压缩后 Token 数: ${tokenCount}`)

    // 仍然超出限制，减少文件数
    if (tokenCount > MAX_TOKENS_PER_REQUEST) {
      console.log('[PromptBuilder] 仍然超出限制，减少文件数...')
      const reducedFiles = compressedFiles.slice(0, Math.ceil(compressedFiles.length / 2))
      prompt = buildFullAnalysisPrompt(request, reducedFiles, projectType)
      tokenCount = await countTokensPrecise(prompt, aiConfig.modelName)

      console.log(`[PromptBuilder] 减少文件后 Token 数: ${tokenCount}`)
    }
  }

  return prompt
}
