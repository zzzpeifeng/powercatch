/**
 * 仓库代码获取服务
 * 负责 Clone 仓库、检测 Git 可用性、检查磁盘空间、扫描路由文件、提取调用链
 */
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { BrowserWindow } from 'electron'
import type {
  GitAvailabilityResult,
  CloneProgress,
  DiskSpaceResult,
  CodeFile,
  RouteMatch,
} from '../../src/services/types'

const execFileAsync = promisify(execFile)

/** Clone 选项 */
export interface CloneOptions {
  repoUrl: string
  branch: string
  accessToken: string
  authMethod: 'http' | 'ssh'
  cloneDir: string
}

/** 仓库信息 */
export interface RepoInfo {
  clonePath: string
  projectType: 'go' | 'java' | 'unknown'
  repoName: string
}

/** 清理结果 */
export interface CleanupResult {
  cleanedCount: number
  freedBytes: number
}

/** 路由扫描正则 - lego/webx 框架（POC 验证更新版） */
const GO_ROUTE_SCAN_REGEX =
  /\.Group\s*\(\s*["'][^"']+["']\s*\)\.\s*(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["'][^"']+["']\s*,\s*\w+\.(?:ControllerWithResp|ControllerWithReqResp|ControllerWithoutReq|NewController|NewControllerWithoutReq)\s*\(\s*\w+\.\w+\s*\)/g

/** 路由提取正则（精细匹配，用于解析扫描结果） */
const GO_ROUTE_EXTRACT_REGEX =
  /\.Group\s*\(\s*["']([^"']+)["']\s*\)\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\.(?:ControllerWithResp|ControllerWithReqResp|ControllerWithoutReq|NewController|NewControllerWithoutReq)\s*\(\s*(\w+)\.(\w+)\s*\)/

/** 通用 Go 路由匹配正则（Gin/Echo 等框架 + lego adapter 模式） */
const GO_GENERIC_ROUTE_REGEX =
  /\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["']([^"']+)["']\s*,\s*(?:\w+\.(?:NewController|NewControllerWithoutReq|ControllerWithResp|ControllerWithReqResp|ControllerWithoutReq)\s*\(\s*(\w+(?:\.\w+)?)\s*\)|(\w+(?:\.\w+)?))\s*\)/g

/** 应跳过的目录 */
const SKIP_DIRS = new Set([
  '.git', 'vendor', 'node_modules', '.idea', '.vscode',
  'dist', 'build', 'target', 'docs', 'doc',
])

/** 应跳过的文件后缀 */
const SKIP_FILE_PATTERNS = [
  /_test\.go$/,
  /Test\.java$/,
  /\.test\./,
  /\.spec\./,
]

/** 默认 Clone 目录 */
function getDefaultCloneDir(): string {
  return path.join(os.homedir(), '.powercatch', 'repos')
}

/**
 * M1: 检测 Git 可用性
 */
export async function checkGitAvailability(): Promise<GitAvailabilityResult> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 5000 })
    const version = stdout.trim()
    return { available: true, version }
  } catch (error: any) {
    // Windows: 尝试常见安装路径
    if (process.platform === 'win32') {
      const commonPaths = [
        'C:\\Program Files\\Git\\bin\\git.exe',
        'C:\\Program Files (x86)\\Git\\bin\\git.exe',
        path.join(os.homedir(), 'AppData\\Local\\Programs\\Git\\bin\\git.exe'),
      ]
      for (const gitPath of commonPaths) {
        if (fs.existsSync(gitPath)) {
          try {
            const { stdout } = await execFileAsync(gitPath, ['--version'], { timeout: 5000 })
            return { available: true, version: stdout.trim(), gitPath }
          } catch {
            continue
          }
        }
      }
    }
    return {
      available: false,
      error: '未检测到 Git，请先安装 Git。下载地址: https://git-scm.com/downloads',
    }
  }
}

/**
 * 获取远程仓库分支列表
 */
export async function fetchBranches(repoUrl: string, accessToken: string, authMethod: string): Promise<string[]> {
  try {
    const cleanUrl = repoUrl.trim()
    if (!cleanUrl) return []

    // 构建认证 URL
    let fetchUrl = cleanUrl
    if (accessToken && authMethod === 'http') {
      try {
        const url = new URL(cleanUrl)
        const isGitLab = url.hostname.includes('gitlab') || url.hostname.startsWith('git.')
        if (isGitLab) {
          fetchUrl = `https://oauth2:${accessToken}@${url.host}${url.pathname}`
        } else {
          fetchUrl = `https://${accessToken}@${url.host}${url.pathname}`
        }
      } catch {
        // URL 解析失败，使用原 URL
      }
    }

    const { stdout } = await execFileAsync('git', ['ls-remote', '--heads', fetchUrl], { timeout: 15000 })
    const branches = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // 格式: <hash>\trefs/heads/<branch>
        const match = line.match(/refs\/heads\/(.+)$/)
        return match ? match[1] : ''
      })
      .filter(Boolean)
      .sort()

    return branches
  } catch (error: any) {
    console.error('[RepoService] 获取分支列表失败:', error.message)
    return []
  }
}

/**
 * M3: 检查磁盘空间
 */
export async function checkDiskSpace(dirPath: string): Promise<DiskSpaceResult> {
  try {
    const dir = dirPath || getDefaultCloneDir()
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let freeBytes = 0
    if (process.platform === 'win32') {
      const drive = path.parse(dir).root
      const { stdout } = await execFileAsync('wmic', [
        'logicaldisk',
        'where', `DeviceID='${drive.replace('\\', '')}'`,
        'get', 'FreeSpace',
        '/value',
      ], { timeout: 5000 })
      const match = stdout.match(/FreeSpace=(\d+)/)
      freeBytes = match ? parseInt(match[1], 10) : 0
    } else {
      const { stdout } = await execFileAsync('df', ['-k', dir], { timeout: 5000 })
      const lines = stdout.trim().split('\n')
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/)
        freeBytes = parseInt(parts[3], 10) * 1024 // KB → bytes
      }
    }

    const freeGB = freeBytes / (1024 * 1024 * 1024)
    let warning: string | null = null
    let hasEnoughSpace = true

    if (freeGB < 0.5) {
      hasEnoughSpace = false
      warning = `磁盘空间严重不足（剩余 ${freeGB.toFixed(1)} GB），无法 Clone 仓库`
    } else if (freeGB < 1) {
      warning = `磁盘空间不足（剩余 ${freeGB.toFixed(1)} GB），Clone 大仓库可能失败`
    }

    return { freeBytes, hasEnoughSpace, warning }
  } catch (error: any) {
    console.error('[RepoService] 磁盘空间检查失败:', error.message)
    // 检查失败不阻止操作，仅返回警告
    return { freeBytes: 0, hasEnoughSpace: true, warning: '无法检查磁盘空间' }
  }
}

/**
 * 构建 Clone URL
 */
function buildCloneUrl(repoUrl: string, token: string, authMethod: string): string {
  // 去除首尾空白
  const cleanUrl = repoUrl.trim()
  if (!cleanUrl) return cleanUrl

  if (authMethod === 'ssh') {
    // SSH 方式：使用原始 URL（需用户已配置 SSH Key）
    return cleanUrl.endsWith('.git') ? cleanUrl : `${cleanUrl}.git`
  }

  // HTTP + Token 方式
  try {
    const url = new URL(cleanUrl)
    const isGitHub = url.hostname.includes('github')
    const isGitLab = url.hostname.includes('gitlab') || url.hostname.startsWith('git.')

    if (token) {
      if (isGitHub) {
        // GitHub: https://<token>@github.com/owner/repo.git
        return `https://${token}@${url.host}${url.pathname}${url.pathname.endsWith('.git') ? '' : '.git'}`
      } else if (isGitLab) {
        // GitLab: https://oauth2:<token>@gitlab.com/owner/repo.git
        return `https://oauth2:${token}@${url.host}${url.pathname}${url.pathname.endsWith('.git') ? '' : '.git'}`
      } else {
        // 通用: https://<token>@host/path.git
        return `https://${token}@${url.host}${url.pathname}${url.pathname.endsWith('.git') ? '' : '.git'}`
      }
    }
    return cleanUrl.endsWith('.git') ? cleanUrl : `${cleanUrl}.git`
  } catch {
    return cleanUrl.endsWith('.git') ? cleanUrl : `${cleanUrl}.git`
  }
}

/**
 * 从 URL 提取仓库名
 */
function extractRepoName(repoUrl: string): string {
  try {
    const url = new URL(repoUrl.trim())
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return parts[parts.length - 1].replace(/\.git$/, '')
    }
    return 'unknown-repo'
  } catch {
    return 'unknown-repo'
  }
}

/**
 * 解析 Git stderr 中的进度信息
 */
function parseGitProgress(stderr: string): CloneProgress | null {
  // 匹配: Receiving objects:  45% (123/273)
  const receivingMatch = stderr.match(/Receiving objects:\s+(\d+)%/)
  if (receivingMatch) {
    return {
      percent: parseInt(receivingMatch[1], 10),
      message: `正在下载对象... ${receivingMatch[1]}%`,
    }
  }

  // 匹配: Resolving deltas:  67% (100/149)
  const deltaMatch = stderr.match(/Resolving deltas:\s+(\d+)%/)
  if (deltaMatch) {
    return {
      percent: 80 + parseInt(deltaMatch[1], 10) * 0.2,
      message: `正在解析增量... ${deltaMatch[1]}%`,
    }
  }

  // 匹配: remote: Counting objects: 100%
  const countingMatch = stderr.match(/remote: Counting objects:\s+(\d+)%/)
  if (countingMatch) {
    return {
      percent: parseInt(countingMatch[1], 10) * 0.3,
      message: `正在统计对象... ${countingMatch[1]}%`,
    }
  }

  // 匹配: Cloning into 'xxx'
  if (stderr.includes('Cloning into')) {
    return { percent: 5, message: '正在初始化 Clone...' }
  }

  return null
}

/**
 * 解析 Git 错误信息，返回友好提示
 */
function parseGitError(stderr: string): string {
  if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) {
    return '仓库认证失败，请检查 Access Token 是否正确'
  }
  if (stderr.includes('not found') || stderr.includes('does not exist')) {
    return '仓库不存在或无访问权限（私有仓库请填写 Access Token）'
  }
  if (stderr.includes('Could not resolve host')) {
    return '无法解析仓库地址，请检查网络连接'
  }
  if (stderr.includes('Permission denied')) {
    return '权限被拒，请检查 Token 或 SSH Key 配置'
  }
  return `Git Clone 失败: ${stderr.slice(0, 200)}`
}

/**
 * M2: 使用 spawn 执行 Clone，带进度推送
 */
export async function cloneRepoWithProgress(
  options: CloneOptions,
  mainWindow: BrowserWindow
): Promise<RepoInfo> {
  const { repoUrl, branch, accessToken, authMethod, cloneDir } = options
  const targetDir = cloneDir || getDefaultCloneDir()
  const repoName = extractRepoName(repoUrl)
  const localPath = path.join(targetDir, repoName)

  // 如果目录已存在，先删除
  if (fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true })
  }

  // 确保父目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const cloneUrl = buildCloneUrl(repoUrl, accessToken, authMethod)

  const args = ['clone', '--depth', '1', '--single-branch']
  if (branch) {
    args.push('-b', branch)
  }
  args.push(cloneUrl, localPath)

  console.log('[RepoService] 开始 Clone:', repoUrl, '分支:', branch)

  return new Promise<RepoInfo>((resolve, reject) => {
    const TIMEOUT_MS = 300_000 // 5 分钟
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const gitProcess = spawn('git', args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderrData = ''

    gitProcess.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrData += text

      // 解析进度并推送
      const progress = parseGitProgress(text)
      if (progress && mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('ai:repo-clone-progress', progress)
        } catch (e) {
          console.error('[RepoService] 推送 Clone 进度失败:', e)
        }
      }
    })

    gitProcess.on('close', (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (code === 0) {
        console.log('[RepoService] Clone 完成:', localPath)

        // 推送 100% 进度
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send('ai:repo-clone-progress', {
              percent: 100,
              message: 'Clone 完成',
            })
          } catch (e) {
            // 忽略
          }
        }

        const projectType = detectProjectType(localPath)
        resolve({ clonePath: localPath, projectType, repoName })
      } else {
        const errorMsg = parseGitError(stderrData)
        console.error('[RepoService] Clone 失败:', errorMsg)
        reject(new Error(errorMsg))
      }
    })

    gitProcess.on('error', (err) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      reject(new Error(`Git 进程启动失败: ${err.message}`))
    })

    // 超时保护
    timeoutId = setTimeout(() => {
      gitProcess.kill('SIGTERM')
      reject(new Error('Clone 超时（5分钟），请检查网络或减小仓库大小'))
    }, TIMEOUT_MS)
  })
}

/**
 * 检测项目类型
 */
export function detectProjectType(clonePath: string): 'go' | 'java' | 'unknown' {
  if (fs.existsSync(path.join(clonePath, 'go.mod'))) {
    return 'go'
  }
  if (
    fs.existsSync(path.join(clonePath, 'pom.xml')) ||
    fs.existsSync(path.join(clonePath, 'build.gradle')) ||
    fs.existsSync(path.join(clonePath, 'build.gradle.kts'))
  ) {
    return 'java'
  }
  return 'unknown'
}

/**
 * 递归遍历目录，收集 .go 文件（异步，避免阻塞事件循环）
 */
async function walkGoFiles(dir: string, maxFiles: number = 500): Promise<string[]> {
  const results: string[] = []

  async function walk(currentDir: string): Promise<void> {
    if (results.length >= maxFiles) return

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return

      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath)
        }
      } else if (entry.name.endsWith('.go')) {
        const shouldSkip = SKIP_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))
        if (!shouldSkip) {
          results.push(fullPath)
        }
      }
    }
  }

  await walk(dir)
  return results
}

/**
 * 异步延迟：让出事件循环
 */
function yieldEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

/**
 * 将多行 Go 代码 collapse 为单行（用于正则匹配链式调用）
 */
function collapseGoCode(content: string): string {
  return content.replace(/\n\s*/g, ' ')
}

/**
 * 扫描路由文件（异步分批，避免阻塞主进程）
 * v1.0 只支持 Go 项目
 * @param onProgress 进度回调 (scanned, total) => void
 */
export async function scanRouteFiles(
  clonePath: string,
  projectType: string,
  method: string,
  requestPath: string,
  onProgress?: (scanned: number, total: number) => void
): Promise<RouteMatch[]> {
  if (projectType !== 'go') {
    console.warn('[RepoService] v1.0 只支持 Go 项目路由扫描，跳过')
    return []
  }

  const goFiles = await walkGoFiles(clonePath)
  const totalFiles = goFiles.length
  console.log(`[RepoService] 开始扫描 ${totalFiles} 个 Go 文件...`)

  // 第一步：分批读取 web 目录下文件，收集 contextPath 和 RegisterRoutes 映射
  const registerRoutesMap = new Map<string, string>()
  let contextPath = ''

  for (let i = 0; i < goFiles.length; i++) {
    const filePath = goFiles[i]
    if (!filePath.includes('/internal/web/')) continue

    try {
      const stats = await fs.promises.stat(filePath)
      if (stats.size > 100000) continue
      const content = await fs.promises.readFile(filePath, 'utf-8')

      const cpMatch = content.match(/contextPath\s*=\s*["']([^"']+)["']/)
      if (cpMatch) {
        contextPath = cpMatch[1]
      }

      const regRegex = /(\w+)\.RegisterRoutes\s*\(\s*\w+\.Group\s*\(\s*["']\/?([^"']+)["']\s*\)/g
      let regMatch
      while ((regMatch = regRegex.exec(content)) !== null) {
        const pkgName = regMatch[1]
        const groupPrefix = regMatch[2].startsWith('/') ? regMatch[2] : '/' + regMatch[2]
        registerRoutesMap.set(pkgName, groupPrefix)
      }
    } catch {
      // ignore
    }

    // 每处理 10 个文件让出事件循环（更频繁 yield，保持 UI 响应）
    if (i % 10 === 0) {
      if (onProgress) {
        onProgress(i, totalFiles)
      }
      await yieldEventLoop()
    }
  }

  console.log(`[RepoService] 找到 ${registerRoutesMap.size} 个 RegisterRoutes 映射，contextPath: ${contextPath}`)

  // 第二步：分批扫描所有 Go 文件，匹配路由
  const matches: RouteMatch[] = []

  for (let i = 0; i < goFiles.length; i++) {
    const filePath = goFiles[i]
    if (filePath.includes('_test.go') || filePath.includes('/vendor/') || filePath.includes('/docs/')) {
      if (onProgress && i % 20 === 0) {
        onProgress(i, totalFiles)
      }
      continue
    }

    try {
      const stats = await fs.promises.stat(filePath)
      if (stats.size > 100000) continue
      const content = await fs.promises.readFile(filePath, 'utf-8')

      // 推断包名
      let filePkgPrefix = ''
      const goModPath = path.join(clonePath, 'go.mod')
      if (fs.existsSync(goModPath)) {
        try {
          const goModContent = await fs.promises.readFile(goModPath, 'utf-8')
          const modMatch = goModContent.match(/^module\s+(.+)$/m)
          if (modMatch) {
            const moduleName = modMatch[1].trim()
            const relPath = filePath.replace(clonePath, '').replace(/^\//, '')
            const pkgMatch = relPath.match(/internal\/domain\/(?:\w+\/)*(\w+)\//)
            if (pkgMatch) {
              filePkgPrefix = pkgMatch[1]
            }
          }
        } catch { /* ignore */ }
      }

      const hasRegisterRoutes = /func\s+RegisterRoutes\s*\(/.test(content)
      const groupPrefix = registerRoutesMap.get(filePkgPrefix) || ''

      const singleLine = collapseGoCode(content)

      // 尝试精确正则
      GO_ROUTE_EXTRACT_REGEX.lastIndex = 0
      let match = GO_ROUTE_EXTRACT_REGEX.exec(singleLine)
      if (match) {
        do {
          const [, prefix, httpMethod, subPath, , handlerPkg, handlerFunc] = match
          const fullPath = prefix + subPath
          if (matchRequestPath(fullPath, method, requestPath)) {
            matches.push({
              filePath,
              content: content.slice(0, 2000),
              routePattern: fullPath,
              handlerName: `${handlerPkg}.${handlerFunc}`,
              lineNumber: 0,
            })
          }
        } while ((match = GO_ROUTE_EXTRACT_REGEX.exec(singleLine)) !== null)
      }

      // 通用正则
      if (matches.length === 0) {
        GO_GENERIC_ROUTE_REGEX.lastIndex = 0
        let genericMatch = GO_GENERIC_ROUTE_REGEX.exec(singleLine)
        if (genericMatch) {
          do {
            const [, httpMethod, routePath, handlerFromCall, handlerDirect] = genericMatch
            const handler = handlerFromCall || handlerDirect
            let fullPath = routePath
            if (hasRegisterRoutes && groupPrefix) {
              fullPath = contextPath + groupPrefix + routePath
            }
            if (matchRequestPath(fullPath, method, requestPath)) {
              const beforeMatch = content.slice(0, content.indexOf(genericMatch[0].replace(/\s+/g, ' ')))
              const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1
              matches.push({
                filePath,
                content: content.slice(0, 2000),
                routePattern: fullPath,
                handlerName: handler,
                lineNumber,
              })
            }
          } while ((genericMatch = GO_GENERIC_ROUTE_REGEX.exec(singleLine)) !== null)
        }
      }
    } catch {
      continue
    }

    if (onProgress && i % 20 === 0) {
      onProgress(i, totalFiles)
    }

    // 每处理 20 个文件让出事件循环
    if (i % 20 === 0) {
      await yieldEventLoop()
    }
  }

  console.log(`[RepoService] 路由扫描完成，扫描 ${totalFiles} 个文件，找到 ${matches.length} 个匹配`)
  return matches
}

/**
 * 路径匹配（支持路径参数 :id 等）
 */
function matchRequestPath(routePath: string, requestMethod: string, requestPath: string): boolean {
  // 先检查 HTTP 方法（宽松匹配，不区分大小写）
  // 由于正则已经按方法过滤，这里只做路径匹配

  // 精确匹配
  if (routePath === requestPath) return true

  // 去掉尾部斜杠后比较
  const normalizedRoute = routePath.replace(/\/+$/, '')
  const normalizedRequest = requestPath.replace(/\/+$/, '')
  if (normalizedRoute === normalizedRequest) return true

  // 支持路径参数匹配（如 /users/:id 匹配 /users/123）
  const routeParts = normalizedRoute.split('/')
  const requestParts = normalizedRequest.split('/')
  if (routeParts.length !== requestParts.length) return false

  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':') || routeParts[i].startsWith('{')) {
      continue // 路径参数，匹配任意值
    }
    if (routeParts[i] !== requestParts[i]) return false
  }

  return true
}

/**
 * 查找 Handler 函数所在的文件
 */
function findHandlerFile(clonePath: string, handlerPkg: string, handlerFunc: string): string | null {
  // 在仓库中搜索包含该函数定义的文件
  const goFiles = walkGoFiles(clonePath, 500)
  for (const filePath of goFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      // 匹配 func HandlerFunc( 或 func (receiver) HandlerFunc(
      const funcRegex = new RegExp(`func\\s+(?:\\([^)]+\\)\\s+)?${handlerFunc}\\s*\\(`)
      if (funcRegex.test(content)) {
        return filePath
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * 提取调用链文件
 * 读取 handler 文件，解析 import，提取同仓库的引用文件
 */
export function extractCallChain(
  clonePath: string,
  projectType: string,
  handlerFile: CodeFile
): CodeFile[] {
  if (projectType !== 'go') {
    return [handlerFile]
  }

  const result: CodeFile[] = [handlerFile]
  const visited = new Set<string>([handlerFile.filePath])
  const MAX_FILES = 15

  // 提取 import 路径
  const importRegex = /import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/g
  const imports: string[] = []

  let importMatch = importRegex.exec(handlerFile.content)
  while (importMatch) {
    if (importMatch[1]) {
      // 多行 import
      const lines = importMatch[1].split('\n')
      for (const line of lines) {
        const pathMatch = line.match(/"([^"]+)"/)
        if (pathMatch) {
          imports.push(pathMatch[1])
        }
      }
    } else if (importMatch[2]) {
      imports.push(importMatch[2])
    }
    importMatch = importRegex.exec(handlerFile.content)
  }

  // 获取仓库的 Go module 名
  let moduleName = ''
  try {
    const goModPath = path.join(clonePath, 'go.mod')
    if (fs.existsSync(goModPath)) {
      const goModContent = fs.readFileSync(goModPath, 'utf-8')
      const modMatch = goModContent.match(/^module\s+(.+)$/m)
      if (modMatch) {
        moduleName = modMatch[1].trim()
      }
    }
  } catch {
    // 忽略
  }

  // 解析内部包引用
  for (const importPath of imports) {
    if (result.length >= MAX_FILES) break

    // 只处理同仓库的包
    if (moduleName && importPath.startsWith(moduleName)) {
      const relativePath = importPath.slice(moduleName.length)
      const localPath = path.join(clonePath, relativePath)

      // 可能是目录（包含多个 .go 文件）
      let targetDir = localPath
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        // 尝试去掉最后一个路径段作为文件
        targetDir = path.dirname(localPath)
      }

      if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
        try {
          const entries = fs.readdirSync(targetDir)
          for (const entry of entries) {
            if (result.length >= MAX_FILES) break
            if (!entry.endsWith('.go')) continue
            if (SKIP_FILE_PATTERNS.some((p) => p.test(entry))) continue

            const fullPath = path.join(targetDir, entry)
            if (visited.has(fullPath)) continue
            visited.add(fullPath)

            try {
              const content = fs.readFileSync(fullPath, 'utf-8')
              const fileType = classifyGoFile(fullPath, content)
              result.push({ filePath: fullPath, content: content.slice(0, 5000), fileType })
            } catch {
              continue
            }
          }
        } catch {
          continue
        }
      }
    }
  }

  return result
}

/**
 * 分类 Go 文件类型
 */
function classifyGoFile(filePath: string, content: string): CodeFile['fileType'] {
  const fileName = path.basename(filePath).toLowerCase()
  const dirName = path.basename(path.dirname(filePath)).toLowerCase()

  if (dirName.includes('model') || dirName.includes('dto') || dirName.includes('entity')) {
    return 'model'
  }
  if (dirName.includes('service') || dirName.includes('biz') || dirName.includes('usecase')) {
    return 'service'
  }
  if (dirName.includes('handler') || dirName.includes('controller') || dirName.includes('api')) {
    return 'handler'
  }
  if (fileName.includes('handler') || fileName.includes('controller')) {
    return 'handler'
  }
  if (fileName.includes('service') || fileName.includes('biz')) {
    return 'service'
  }
  if (fileName.includes('model') || fileName.includes('dto') || fileName.includes('param') || fileName.includes('resp')) {
    return 'model'
  }
  return 'other'
}

/**
 * 清理临时仓库
 */
export async function cleanupRepo(clonePath: string): Promise<void> {
  if (fs.existsSync(clonePath)) {
    fs.rmSync(clonePath, { recursive: true, force: true })
    console.log('[RepoService] 已清理仓库:', clonePath)
  }
}

/**
 * M3: LRU 策略清理旧仓库
 */
export async function cleanupOldRepos(
  cloneDir: string,
  maxAgeDays: number = 3
): Promise<CleanupResult> {
  const targetDir = cloneDir || getDefaultCloneDir()
  let cleanedCount = 0
  let freedBytes = 0

  if (!fs.existsSync(targetDir)) {
    return { cleanedCount: 0, freedBytes: 0 }
  }

  const now = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000

  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const fullPath = path.join(targetDir, entry.name)
      try {
        const stats = fs.statSync(fullPath)
        const age = now - stats.atimeMs

        if (age > maxAgeMs) {
          // 计算目录大小
          const dirSize = getDirSize(fullPath)
          fs.rmSync(fullPath, { recursive: true, force: true })
          cleanedCount++
          freedBytes += dirSize
          console.log('[RepoService] 已清理过期仓库:', entry.name)
        }
      } catch {
        continue
      }
    }
  } catch (error: any) {
    console.error('[RepoService] 清理旧仓库失败:', error.message)
  }

  return { cleanedCount, freedBytes }
}

/**
 * 递归计算目录大小
 */
function getDirSize(dirPath: string): number {
  let size = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        try {
          const stats = fs.statSync(fullPath)
          size += stats.size
        } catch {
          continue
        }
      }
    }
  } catch {
    // 忽略
  }
  return size
}
