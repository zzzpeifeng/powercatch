import { exec } from 'child_process'
import sudo from 'sudo-prompt'
import fs from 'fs'
import path from 'path'
import os from 'os'

const SNAPSHOT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'powercatch')
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'system-proxy-snapshot.json')

export interface NetworkService {
  name: string
  isActive: boolean
}

export interface ProxyState {
  http?: { host: string; port: number; enabled: boolean }
  https?: { host: string; port: number; enabled: boolean }
}

export interface SystemProxySnapshot {
  version: number
  savedAt: number
  services: NetworkService[]
  proxies: Record<string, ProxyState>
}

function promiseExec(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout)
    })
  })
}

function promiseSudo(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sudo.exec(command, { name: 'PowerCatch' }, (error: any, stdout: string, stderr: string) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout || '')
    })
  })
}

/** 引住含空格的网卡名 */
function q(name: string): string {
  return name.includes(' ') ? `"${name}"` : name
}

/** 获取所有活跃网卡 */
export async function getActiveNetworkServices(): Promise<NetworkService[]> {
  const stdout = await promiseExec('networksetup -listallnetworkservices')
  const lines = stdout.split('\n')
  const services: NetworkService[] = []
  // 第一行是标题，跳过；带 * 前缀的是禁用状态
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('*')) continue
    if (trimmed) services.push({ name: trimmed, isActive: true })
  }
  return services
}

/** 解析 networksetup -getwebproxy / -getsecurewebproxy 输出 */
function parseProxyOutput(output: string): { host: string; port: number; enabled: boolean } | null {
  let host = ''
  let port = 0
  let enabled = false
  for (const line of output.split('\n')) {
    if (line.startsWith('Server: ')) host = line.slice(8).trim()
    else if (line.startsWith('Port: ')) port = parseInt(line.slice(6).trim(), 10) || 0
    else if (line.startsWith('Enabled: ')) enabled = line.slice(9).trim() === 'Yes'
  }
  if (!host && !enabled) return null
  return { host, port, enabled }
}

/** 读取单个网卡的代理状态 */
export async function getProxyState(serviceName: string): Promise<ProxyState> {
  const [httpOut, httpsOut] = await Promise.all([
    promiseExec(`networksetup -getwebproxy ${q(serviceName)}`),
    promiseExec(`networksetup -getsecurewebproxy ${q(serviceName)}`),
  ])
  return {
    http: parseProxyOutput(httpOut),
    https: parseProxyOutput(httpsOut),
  }
}

/** 保存快照 */
async function saveSnapshot(snapshot: SystemProxySnapshot): Promise<void> {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  }
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8')
}

/** 读取快照 */
async function loadSnapshot(): Promise<SystemProxySnapshot | null> {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'))
  } catch {
    return null
  }
}

/** 删除快照 */
function deleteSnapshot(): void {
  try { fs.unlinkSync(SNAPSHOT_PATH) } catch {}
}

/**
 * 开启系统代理
 * 1. 读取当前状态保存快照
 * 2. sudo 执行 networksetup 设置代理
 */
export async function setSystemProxy(port: number): Promise<{ success: boolean; message: string }> {
  try {
    const services = await getActiveNetworkServices()
    if (services.length === 0) {
      return { success: false, message: '没有找到活跃的网络服务' }
    }

    // 保存快照
    const snapshot: SystemProxySnapshot = {
      version: 1,
      savedAt: Date.now(),
      services,
      proxies: {},
    }
    await Promise.all(
      services.map(async (s) => {
        snapshot.proxies[s.name] = await getProxyState(s.name)
      })
    )
    await saveSnapshot(snapshot)

    // 构造 sudo 命令（所有网卡一次性设置）
    const host = '127.0.0.1'
    const cmds: string[] = []
    for (const s of services) {
      const n = q(s.name)
      cmds.push(`networksetup -setwebproxy ${n} ${host} ${port}`)
      cmds.push(`networksetup -setsecurewebproxy ${n} ${host} ${port}`)
      cmds.push(`networksetup -setwebproxystate ${n} on`)
      cmds.push(`networksetup -setsecurewebproxystate ${n} on`)
    }

    await promiseSudo(cmds.join(' && '))
    return { success: true, message: `已开启系统代理（${host}:${port}）→ ${services.map(s => s.name).join('、')}` }
  } catch (error: any) {
    return { success: false, message: error.message || '开启系统代理失败' }
  }
}

/**
 * 关闭系统代理
 * 1. 尝试读取快照，还原原始配置
 * 2. 若无快照，直接关闭所有网卡的代理
 */
export async function clearSystemProxy(): Promise<{ success: boolean; message: string }> {
  try {
    const snapshot = await loadSnapshot()
    const cmds: string[] = []

    if (snapshot) {
      // 按快照还原
      for (const s of snapshot.services) {
        const n = q(s.name)
        const p = snapshot.proxies[s.name]
        if (p?.http?.enabled) {
          cmds.push(`networksetup -setwebproxy ${n} ${p.http.host} ${p.http.port}`)
          cmds.push(`networksetup -setwebproxystate ${n} on`)
        } else {
          cmds.push(`networksetup -setwebproxystate ${n} off`)
        }
        if (p?.https?.enabled) {
          cmds.push(`networksetup -setsecurewebproxy ${n} ${p.https.host} ${p.https.port}`)
          cmds.push(`networksetup -setsecurewebproxystate ${n} on`)
        } else {
          cmds.push(`networksetup -setsecurewebproxystate ${n} off`)
        }
      }
    } else {
      // 无快照：关闭所有活跃网卡的代理
      const services = await getActiveNetworkServices()
      for (const s of services) {
        const n = q(s.name)
        cmds.push(`networksetup -setwebproxystate ${n} off`)
        cmds.push(`networksetup -setsecurewebproxystate ${n} off`)
      }
    }

    if (cmds.length > 0) {
      await promiseSudo(cmds.join(' && '))
    }

    deleteSnapshot()
    return { success: true, message: '已关闭系统代理' }
  } catch (error: any) {
    return { success: false, message: error.message || '关闭系统代理失败' }
  }
}

/**
 * 查询当前系统代理状态
 * 检查是否有活跃网卡的 HTTP/HTTPS 代理指向 127.0.0.1:port
 */
export async function getSystemProxyStatus(
  port: number
): Promise<{ isActive: boolean; details: { serviceName: string; http: string; https: string }[] }> {
  try {
    const services = await getActiveNetworkServices()
    const details: { serviceName: string; http: string; https: string }[] = []
    let isActive = false
    const host = '127.0.0.1'

    await Promise.all(
      services.map(async (s) => {
        const state = await getProxyState(s.name)
        const httpOk = state.http?.enabled && state.http.host === host && state.http.port === port
        const httpsOk = state.https?.enabled && state.https.host === host && state.https.port === port
        if (httpOk || httpsOk) isActive = true
        details.push({
          serviceName: s.name,
          http: state.http?.enabled ? `${state.http.host}:${state.http.port}` : '未开启',
          https: state.https?.enabled ? `${state.https.host}:${state.https.port}` : '未开启',
        })
      })
    )

    return { isActive, details }
  } catch {
    return { isActive: false, details: [] }
  }
}
