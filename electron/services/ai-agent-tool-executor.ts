/**
 * AI Agent 工具调用执行器
 * 封装 AI 工具调用，提供文件系统操作能力
 *
 * 工具列表：
 * - list_directory: 列出目录内容
 * - read_file: 读取文件内容
 * - search_code: 在代码中搜索关键字
 * - get_file_tree: 获取文件树结构
 */

import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import { execFile } from 'child_process'
import type {
  CallerRef,
  GetCallersResult,
  StructField,
  GetStructFieldsResult,
} from './types'

/** get_callers 返回调用方的最大数量（截断保护） */
const MAX_CALLERS = 50

/** 一层嵌套解析时，最多展开的嵌套 struct 数量 */
const MAX_NESTED_STRUCTS = 10

/** Go 基础类型集合（用于判断某类型是否为可展开 struct） */
const GO_PRIMITIVES = new Set<string>([
  'string', 'int', 'int8', 'int16', 'int32', 'int64',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64',
  'byte', 'rune', 'float32', 'float64', 'bool', 'error', 'any', 'interface{}',
])

const readdirAsync = util.promisify(fs.readdir)
const readFileAsync = util.promisify(fs.readFile)
const statAsync = util.promisify(fs.stat)

/** 工具调用结果 */
export interface ToolCallResult {
  success: boolean
  result?: any
  error?: string
}

/** 文件树节点 */
export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  size?: number
}

/** 搜索结果 */
export interface SearchResult {
  filePath: string
  lineNumber: number
  lineContent: string
  matchCount: number
}

/**
 * AI Agent 工具调用执行器
 */
export class AIAgentToolExecutor {
  private readonly clonePath: string
  private readonly timeoutMs: number = 30000 // 30秒超时

  /**
   * 构造函数
   * @param clonePath 仓库本地路径
   */
  constructor(clonePath: string) {
    this.clonePath = clonePath
    console.log(`[AIAgentToolExecutor] 初始化，clonePath: ${clonePath}`)
  }

  /**
   * 执行工具调用
   * @param toolName 工具名称
   * @param args 工具参数
   * @returns 工具调用结果
   */
  async executeTool(toolName: string, args: any): Promise<ToolCallResult> {
    console.log(`[AIAgentToolExecutor] 执行工具: ${toolName}, 参数:`, args)

    try {
      let result: ToolCallResult

      switch (toolName) {
        case 'list_directory':
          result = await this.withTimeout(
            this.listDirectory(args.path),
            `list_directory(${args.path})`
          )
          break

        case 'read_file':
          // 警告：read_file 不支持 offset/limit，会读取整个文件
          if (args.offset !== undefined || args.limit !== undefined) {
            console.warn(`[AIAgentToolExecutor] read_file 忽略 offset/limit 参数，将读取整个文件: ${args.path}`)
          }
          result = await this.withTimeout(
            this.readFile(args.path),
            `read_file(${args.path})`
          )
          break

        case 'search_code': {
          // 兼容 filePattern（camelCase）和 file_pattern（snake_case）
          const keyword = args.keyword
          const filePattern = args.filePattern ?? args.file_pattern
          result = await this.withTimeout(
            this.searchCode(keyword, filePattern),
            `search_code(${keyword})`
          )
          break
        }

        case 'get_file_tree':
          result = await this.withTimeout(
            this.getFileTree(),
            'get_file_tree()'
          )
          break

        case 'get_callers':
          // Phase 5 新增：ripgrep 反查调用方
          result = await this.withTimeout(
            this.get_callers(args),
            `get_callers(${args.symbol})`
          )
          break

        case 'get_struct_fields':
          // Phase 5 新增：精准提取 Go struct 字段约束
          result = await this.withTimeout(
            this.get_struct_fields(args),
            `get_struct_fields(${args.structName})`
          )
          break

        default:
          result = {
            success: false,
            error: `Unknown tool: ${toolName}`,
          }
      }

      console.log(`[AIAgentToolExecutor] 工具 ${toolName} 执行完成:`, result.success ? '成功' : '失败')
      return result
    } catch (error: any) {
      console.error(`[AIAgentToolExecutor] 工具 ${toolName} 执行异常:`, error.message)
      return {
        success: false,
        error: error.message || 'Unknown error',
      }
    }
  }

  /**
   * 列出目录内容
   * @param relativePath 相对于 clonePath 的路径
   * @returns 目录内容列表
   */
  private async listDirectory(relativePath: string): Promise<ToolCallResult> {
    const fullPath = this.resolvePath(relativePath)

    if (!fs.existsSync(fullPath)) {
      return {
        success: false,
        error: `Directory does not exist: ${relativePath}`,
      }
    }

    const stats = await statAsync(fullPath)
    if (!stats.isDirectory()) {
      return {
        success: false,
        error: `Path is not a directory: ${relativePath}`,
      }
    }

    const entries = await readdirAsync(fullPath, { withFileTypes: true })
    const result = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(relativePath || '.', entry.name)
        const fullEntryPath = path.join(fullPath, entry.name)

        try {
          const entryStats = await statAsync(fullEntryPath)
          return {
            name: entry.name,
            path: entryPath,
            type: entry.isDirectory() ? 'directory' as const : 'file' as const,
            size: entry.isFile() ? entryStats.size : undefined,
            modifiedAt: entryStats.mtime.toISOString(),
          }
        } catch {
          return {
            name: entry.name,
            path: entryPath,
            type: entry.isDirectory() ? 'directory' as const : 'file' as const,
          }
        }
      })
    )

    // 排序：目录在前，文件在后
    result.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return {
      success: true,
      result: {
        path: relativePath || '.',
        entries: result,
        totalCount: result.length,
      },
    }
  }

  /**
   * 读取文件内容
   * @param relativePath 相对于 clonePath 的路径
   * @returns 文件内容
   */
  private async readFile(relativePath: string): Promise<ToolCallResult> {
    const fullPath = this.resolvePath(relativePath)

    if (!fs.existsSync(fullPath)) {
      return {
        success: false,
        error: `File does not exist: ${relativePath}`,
      }
    }

    const stats = await statAsync(fullPath)
    if (!stats.isFile()) {
      return {
        success: false,
        error: `Path is not a file: ${relativePath}`,
      }
    }

    // 检查文件大小（限制 1MB）
    if (stats.size > 1024 * 1024) {
      return {
        success: false,
        error: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${relativePath}`,
      }
    }

    const content = await readFileAsync(fullPath, 'utf-8')

    return {
      success: true,
      result: {
        path: relativePath,
        content: content,
        size: stats.size,
        encoding: 'utf-8',
      },
    }
  }

  /**
   * 在代码中搜索关键字
   * @param keyword 搜索关键字
   * @param filePattern 文件模式（可选，如 *.ts）
   * @returns 搜索结果
   */
  private async searchCode(keyword: string, filePattern?: string): Promise<ToolCallResult> {
    if (!keyword || keyword.trim().length === 0) {
      return {
        success: false,
        error: 'Keyword cannot be empty',
      }
    }

    const results: SearchResult[] = []
    const keywordLower = keyword.toLowerCase()
    const maxResults = 100 // 限制最大结果数

    console.log(`[AIAgentToolExecutor] 搜索关键字: "${keyword}", 文件模式: ${filePattern || 'all'}`)

    await this.searchInDirectory(this.clonePath, keywordLower, filePattern, results, maxResults)

    console.log(`[AIAgentToolExecutor] 搜索完成，找到 ${results.length} 个匹配`)

    return {
      success: true,
      result: {
        keyword: keyword,
        filePattern: filePattern || 'all',
        matches: results,
        totalMatches: results.length,
        truncated: results.length >= maxResults,
      },
    }
  }

  /**
   * 递归搜索目录
   */
  private async searchInDirectory(
    dirPath: string,
    keywordLower: string,
    filePattern: string | undefined,
    results: SearchResult[],
    maxResults: number
  ): Promise<void> {
    if (results.length >= maxResults) {
      return
    }

    try {
      const entries = await readdirAsync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (results.length >= maxResults) {
          break
        }

        const fullPath = path.join(dirPath, entry.name)

        // 跳过隐藏目录和 node_modules
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') {
            continue
          }

          await this.searchInDirectory(fullPath, keywordLower, filePattern, results, maxResults)
        } else if (entry.isFile()) {
          // 检查文件模式
          if (filePattern) {
            const patternRegex = this.globToRegex(filePattern)
            if (!patternRegex.test(entry.name)) {
              continue
            }
          }

          // 搜索文件内容
          try {
            const content = await readFileAsync(fullPath, 'utf-8')
            const lines = content.split('\n')

            for (let i = 0; i < lines.length; i++) {
              const lineLower = lines[i].toLowerCase()
              if (lineLower.includes(keywordLower)) {
                const matchCount = (lines[i].match(new RegExp(keywordLower, 'gi')) || []).length
                results.push({
                  filePath: path.relative(this.clonePath, fullPath),
                  lineNumber: i + 1,
                  lineContent: lines[i].trim(),
                  matchCount: matchCount,
                })

                if (results.length >= maxResults) {
                  break
                }
              }
            }
          } catch {
            // 跳过无法读取的文件
            continue
          }
        }
      }
    } catch (error: any) {
      console.warn(`[AIAgentToolExecutor] 搜索目录失败 ${dirPath}:`, error.message)
    }
  }

  /**
   * 获取文件树结构
   * @returns 文件树
   */
  private async getFileTree(): Promise<ToolCallResult> {
    const tree = await this.buildFileTree(this.clonePath, '')

    return {
      success: true,
      result: {
        rootPath: this.clonePath,
        tree: tree,
      },
    }
  }

  /**
   * 递归构建文件树
   */
  private async buildFileTree(dirPath: string, relativePath: string): Promise<FileTreeNode[]> {
    const nodes: FileTreeNode[] = []

    try {
      const entries = await readdirAsync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        // 跳过隐藏目录和常见无关目录
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') {
          continue
        }

        const fullPath = path.join(dirPath, entry.name)
        const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name

        if (entry.isDirectory()) {
          const children = await this.buildFileTree(fullPath, entryRelativePath)
          nodes.push({
            name: entry.name,
            path: entryRelativePath,
            type: 'directory',
            children: children,
          })
        } else if (entry.isFile()) {
          try {
            const stats = await statAsync(fullPath)
            nodes.push({
              name: entry.name,
              path: entryRelativePath,
              type: 'file',
              size: stats.size,
            })
          } catch {
            nodes.push({
              name: entry.name,
              path: entryRelativePath,
              type: 'file',
            })
          }
        }
      }

      // 排序：目录在前，文件在后
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
    } catch (error: any) {
      console.warn(`[AIAgentToolExecutor] 构建文件树失败 ${dirPath}:`, error.message)
    }

    return nodes
  }

  /**
   * 解析相对路径为绝对路径
   * @param relativePath 相对路径
   * @returns 绝对路径
   */
  private resolvePath(relativePath: string): string {
    if (!relativePath || relativePath === '.' || relativePath === './') {
      return this.clonePath
    }

    // 防止路径遍历攻击
    const resolved = path.resolve(this.clonePath, relativePath)
    if (!resolved.startsWith(this.clonePath)) {
      throw new Error(`Path traversal detected: ${relativePath}`)
    }

    return resolved
  }

  /**
   * 添加超时保护
   * @param promise 原始 Promise
   * @param label 标签（用于日志）
   * @returns 带超时的 Promise
   */
  private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timeout (${this.timeoutMs}ms): ${label}`))
      }, this.timeoutMs)
    })

    try {
      const result = await Promise.race([promise, timeoutPromise])
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      return result
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      throw error
    }
  }

  /**
   * 将 glob 模式转换为正则表达式
   * @param glob glob 模式
   * @returns 正则表达式
   */
  private globToRegex(glob: string): RegExp {
    const regexStr = glob
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${regexStr}$`)
  }

  // ============================================================
  // Phase 5 新增：专用反向分析工具（get_callers / get_struct_fields）
  // ============================================================

  /**
   * 执行 ripgrep 命令并返回标准输出文本。
   * 设计目标：工具脆弱性兜底——rg 未安装（ENOENT）或无匹配（退出码 1）均返回空串，不抛错。
   */
  private runRg(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      execFile('rg', args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
          // ripgrep 退出码 1 = 无匹配；ENOENT = rg 未安装。两者都降级为空结果。
          // 注意：Node 在进程非 0 退出时把退出码（数字 1）写入 error.code，
          // 而 spawn 失败时为字符串 'ENOENT'；故 code 实际为 string | number。
          const code = (
            error as Omit<NodeJS.ErrnoException, 'code'> & { code?: string | number }
          ).code
          if (code === 1 || code === 'ENOENT') {
            resolve('')
            return
          }
          // 其他错误（如非法正则）上抛，由调用方决定兜底
          reject(error)
        } else {
          resolve(stdout || '')
        }
      })
    })
  }

  /** 转义正则特殊字符（用于 ripgrep -P 模式） */
  private rgEscape(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /** 从 `file:line:packageName` 输出中解析 file→package 映射 */
  private parsePackageMap(rgOutput: string): Map<string, string> {
    const map = new Map<string, string>()
    for (const line of rgOutput.split('\n')) {
      const m = line.match(/^(.+?):\d+:(.*)$/)
      if (!m) continue
      const pkg = m[2].match(/package\s+([A-Za-z_]\w*)/)
      if (pkg) map.set(m[1], pkg[1])
    }
    return map
  }

  /** 判断一行是否为「调用点」（含标识符调用，且非 func 定义本身） */
  private isCallerLine(content: string): boolean {
    if (/\bfunc\b/.test(content)) return false
    return /\b[A-Za-z_]\w*\s*\(/.test(content)
  }

  /**
   * 解析 ripgrep 的调用点输出（含 -B 上下文）为 CallerRef[]。
   * 通过顺序扫描：遇到 func 定义行更新 currentFunc，遇到调用点行记录调用方。
   */
  private parseCallerLines(rgOutput: string, pkgMap: Map<string, string>): CallerRef[] {
    const callers: CallerRef[] = []
    let currentFunc = ''
    const lines = rgOutput.split('\n')

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      if (line === '--') {
        currentFunc = ''
        continue
      }
      // 检测最近的 func 定义，作为「调用方所在函数名」
      const funcMatch = line.match(/\bfunc\b\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\(/)
      if (funcMatch) {
        currentFunc = funcMatch[1]
      }
      const callMatch = line.match(/^(.+?):(\d+):(.*)$/)
      if (!callMatch) continue
      const file = callMatch[1]
      const lineNo = parseInt(callMatch[2], 10)
      const content = callMatch[3]
      if (!this.isCallerLine(content)) continue
      // 方法调用 .Foo( → 提取接收者标识符用于消歧
      const receiverMatch = content.match(/([A-Za-z_]\w*)\.[A-Za-z_]\w*\s*\(/)
      const receiver = receiverMatch ? receiverMatch[1] : ''
      callers.push({
        file,
        line: lineNo,
        functionName: currentFunc,
        receiver,
        package: pkgMap.get(file) || '',
        snippet: content.trim().slice(0, 300),
      })
    }
    return callers
  }

  /**
   * 反查某符号的全部调用方（get_callers 工具实现）。
   * 使用 ripgrep 反查 `Symbol(` / `.Symbol(` 调用点，返回带 receiver/package 消歧的调用方列表。
   */
  private async get_callers(args: any): Promise<ToolCallResult> {
    const symbol = String(args?.symbol || '').trim()
    if (!symbol) {
      return { success: false, error: 'get_callers 需要 symbol 参数' }
    }
    try {
      // 1) 全局反查调用点（带 -B 上下文用于推断调用方函数名）
      const pattern = `\\b${this.rgEscape(symbol)}\\(\\`
      const callOutput = await this.runRg(['-n', '-B', '40', '-P', pattern, this.clonePath])
      // 2) 一次全局扫描建立 file→package 映射
      const pkgOutput = await this.runRg(['-n', '-P', '-o', '^package\\s+([A-Za-z_]\\w*)', this.clonePath])
      const pkgMap = this.parsePackageMap(pkgOutput)

      let callers = this.parseCallerLines(callOutput, pkgMap)
      // 截断到 maxCallers，防止超大仓库返回爆炸
      if (callers.length > MAX_CALLERS) {
        callers = callers.slice(0, MAX_CALLERS)
      }
      return { success: true, result: { symbol, callers } as GetCallersResult }
    } catch (e: any) {
      // 工具脆弱性兜底：失败不抛错，返回空，交由 AI 回退 A/B/C/D 启发式
      console.warn(`[AIAgentToolExecutor] get_callers 失败:`, e?.message)
      return { success: true, result: { symbol, callers: [] } as GetCallersResult }
    }
  }

  /** 读取源文件文本内容（供 get_struct_fields 解析 struct 用） */
  private async readSourceFile(relativePath: string): Promise<string> {
    const res = await this.readFile(relativePath)
    if (!res.success) {
      throw new Error(res.error || 'read failed')
    }
    return res.result?.content || ''
  }

  /**
   * 提取某 Go struct 的字段与约束（get_struct_fields 工具实现）。
   * 仅支持 Go；非 Go 或未找到 Go 结构体定义时返回 language:'unsupported' + 空 fields，不抛错。
   */
  private async get_struct_fields(args: any): Promise<ToolCallResult> {
    const structName = String(args?.structName || '').trim()
    if (!structName) {
      return { success: false, error: 'get_struct_fields 需要 structName 参数' }
    }
    try {
      // 1) 定位 `type Xxx struct`（仅在 .go 文件）
      const locateOut = await this.runRg([
        '-n', '--glob', '*.go', `type\\s+${this.rgEscape(structName)}\\s+struct`, this.clonePath,
      ])
      const locMatch = locateOut
        .split('\n')
        .map((l) => l.match(/^(.+?):(\d+):(.*)$/))
        .find(Boolean) as RegExpMatchArray | undefined

      if (!locMatch) {
        // 未找到 Go 结构体定义：判断是否为非 Go 仓库
        const goFiles = await this.runRg(['--files', '--glob', '*.go', this.clonePath])
        if (!goFiles.trim()) {
          return {
            success: true,
            result: {
              structName,
              language: 'unsupported',
              fields: [],
              note: '未检测到 Go 源文件，get_struct_fields 仅支持 Go struct',
            } as GetStructFieldsResult,
          }
        }
        return {
          success: true,
          result: {
            structName,
            language: 'go',
            fields: [],
            note: `未找到结构体定义 ${structName}（可能命名不符或位于非 .go 文件）`,
          } as GetStructFieldsResult,
        }
      }

      const file = locMatch[1]
      const defLine = parseInt(locMatch[2], 10)
      const content = await this.readSourceFile(file)
      const flatFields = this.parseStructFields(content, defLine)
      // 2) 展开一层嵌套 struct
      const { fields, note } = await this.expandOneLevelNesting(flatFields)

      return {
        success: true,
        result: { structName, language: 'go', fields, note } as GetStructFieldsResult,
      }
    } catch (e: any) {
      console.warn(`[AIAgentToolExecutor] get_struct_fields 失败:`, e?.message)
      return {
        success: true,
        result: {
          structName,
          language: 'unsupported',
          fields: [],
          note: `解析失败: ${e?.message || 'unknown'}`,
        } as GetStructFieldsResult,
      }
    }
  }

  /**
   * 解析 struct 主体字段（扁平，含一层嵌套边界）。
   * @param content 文件全文
   * @param defLine struct 定义所在行（1-based）
   */
  private parseStructFields(content: string, defLine: number): StructField[] {
    const lines = content.split('\n')
    const startIdx = defLine - 1
    const fields: StructField[] = []
    let depth = 0
    let started = false

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i]
      // 统计花括号深度（声明行也含 '{'）
      for (const ch of line) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') depth--
      }
      if (!started) continue
      // 跳过 `type Xxx struct {` 声明行（不是字段）
      if (i === startIdx) continue

      const trimmed = line.trim()
      if (trimmed === '}') {
        if (depth === 0) break
        continue
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      // 内联嵌套 struct（更深嵌套）：跳过字段解析，由 note 标注未展开
      if (/^[A-Za-z_]\w*\s+struct\s*\{/.test(trimmed)) continue

      const field = this.parseFieldLine(line)
      if (field) fields.push(field)
      if (depth === 0) break
    }
    return fields
  }

  /** 解析单行 struct 字段（name type `tags`） */
  private parseFieldLine(line: string): StructField | null {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '}') {
      return null
    }
    const m = trimmed.match(/^([A-Za-z_]\w*)\s+([\s\S]*?)(`[^`]*`)?\s*$/)
    if (!m) return null
    const name = m[1]
    const typePart = (m[2] || '').trim()
    const tagStr = m[3] ? m[3].slice(1, -1) : ''
    const tags: Record<string, string> = {}
    if (tagStr) {
      for (const part of tagStr.split(/\s+/).filter(Boolean)) {
        const kv = part.match(/^([A-Za-z_]\w*):"(.*)"$/)
        if (kv) tags[kv[1]] = kv[2]
      }
    }
    return { name, type: typePart, tags }
  }

  /** 计算字段类型的「基础类型」（去掉 * / [] / map[...] 前缀） */
  private baseTypeName(type: string): string {
    let t = type.trim()
    for (let i = 0; i < 5; i++) {
      const r = t.replace(/^(\*|\[\])/, '')
      if (r === t) break
      t = r
    }
    t = t.replace(/^map\[[^\]]+\]/, '').trim()
    return t
  }

  /** 判断基础类型是否为可展开的命名 struct（排除基础类型与接口） */
  private isStructType(baseType: string): boolean {
    if (!baseType) return false
    if (GO_PRIMITIVES.has(baseType)) return false
    return /^[A-Z]\w*$/.test(baseType)
  }

  /**
   * 展开一层嵌套 struct 字段：对每个引用其他 struct 的字段，
   * 递归解析其一层字段并附加 nestedType=父字段名。更深嵌套在 note 标注不展开。
   */
  private async expandOneLevelNesting(
    flatFields: StructField[],
  ): Promise<{ fields: StructField[]; note?: string }> {
    const fields: StructField[] = []
    let deeper = false
    let resolvedCount = 0

    for (const f of flatFields) {
      fields.push(f)
      const baseType = this.baseTypeName(f.type)
      if (this.isStructType(baseType) && resolvedCount < MAX_NESTED_STRUCTS) {
        resolvedCount++
        const sub = await this.resolveStructFields(baseType)
        if (sub) {
          for (const sf of sub) {
            fields.push({ ...sf, nestedType: f.name })
          }
          // 子 struct 自身若还有嵌套字段 → 标记更深一层未展开
          if (sub.some((sf) => this.isStructType(this.baseTypeName(sf.type)))) {
            deeper = true
          }
        }
      }
    }

    const note = deeper ? '已展开一层嵌套 struct 字段，更深嵌套字段未展开' : undefined
    return { fields, note }
  }

  /** 解析某个命名 struct 的扁平字段（供一层嵌套展开使用） */
  private async resolveStructFields(structName: string): Promise<StructField[] | null> {
    const locateOut = await this.runRg([
      '-n', '--glob', '*.go', `type\\s+${this.rgEscape(structName)}\\s+struct`, this.clonePath,
    ])
    const locMatch = locateOut
      .split('\n')
      .map((l) => l.match(/^(.+?):(\d+):(.*)$/))
      .find(Boolean) as RegExpMatchArray | undefined
    if (!locMatch) return null
    try {
      const content = await this.readSourceFile(locMatch[1])
      return this.parseStructFields(content, parseInt(locMatch[2], 10))
    } catch {
      return null
    }
  }
}
