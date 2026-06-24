/**
 * 仓库代码获取服务
 * 负责 Clone 仓库、检测 Git 可用性、检查磁盘空间
 *
 * 注意：CPU 密集型路由扫描逻辑已迁移到 Worker 线程 (electron/workers/scan-worker.ts)
 * 由 ScanWorkerManager (electron/services/scan-worker-manager.ts) 管理
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
} from '../../src/services/types'

const execFileAsync = promisify(execFile)

/** Clone 选项 */
export interface CloneOptions {
  repoUrl: string
  branch: string
  accessToken: string
  authMethod: 'http' | 'ssh'
  cloneDir?: string
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
  if (!repoUrl) return []
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
  if (!repoUrl) return ''
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
  if (!repoUrl) return 'unknown-repo'
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
      status: 'cloning',
      percent: parseInt(receivingMatch[1], 10),
      message: `正在下载对象... ${receivingMatch[1]}%`,
    }
  }

  // 匹配: Resolving deltas:  67% (100/149)
  const deltaMatch = stderr.match(/Resolving deltas:\s+(\d+)%/)
  if (deltaMatch) {
    return {
      status: 'cloning',
      percent: 80 + parseInt(deltaMatch[1], 10) * 0.2,
      message: `正在解析增量... ${deltaMatch[1]}%`,
    }
  }

  // 匹配: remote: Counting objects: 100%
  const countingMatch = stderr.match(/remote: Counting objects:\s+(\d+)%/)
  if (countingMatch) {
    return {
      status: 'cloning',
      percent: parseInt(countingMatch[1], 10) * 0.3,
      message: `正在统计对象... ${countingMatch[1]}%`,
    }
  }

  // 匹配: Cloning into 'xxx'
  if (stderr.includes('Cloning into')) {
    return { status: 'cloning', percent: 5, message: '正在初始化 Clone...' }
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
 * @param progressCallback 进度回调函数（用于 SSE 推送）
 */
export async function cloneRepoWithProgress(
  options: CloneOptions,
  mainWindow: BrowserWindow,
  progressCallback?: (progress: CloneProgress) => void
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
      if (progress) {
        // 通过 IPC 推送（前端未连接 SSE 时使用）
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send('ai:clone-progress', progress)
          } catch (e) {
            console.error('[RepoService] 推送 Clone 进度失败:', e)
          }
        }

        // 通过回调推送（前端已连接 SSE 时使用）
        if (progressCallback) {
          try {
            progressCallback(progress)
          } catch (e) {
            console.error('[RepoService] 回调推送 Clone 进度失败:', e)
          }
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
            mainWindow.webContents.send('ai:clone-progress', {
              status: 'done',
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
