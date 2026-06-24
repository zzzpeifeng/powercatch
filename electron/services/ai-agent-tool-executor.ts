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
          result = await this.withTimeout(
            this.readFile(args.path),
            `read_file(${args.path})`
          )
          break

        case 'search_code':
          result = await this.withTimeout(
            this.searchCode(args.keyword, args.filePattern),
            `search_code(${args.keyword})`
          )
          break

        case 'get_file_tree':
          result = await this.withTimeout(
            this.getFileTree(),
            'get_file_tree()'
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
}
