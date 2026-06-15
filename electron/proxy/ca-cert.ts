/**
 * CA 证书路径管理
 * 
 * 核心设计：
 * - 不自己生成 CA 证书，而是让 http-mitm-proxy 自己管理
 * - 我们只需知道 sslCaDir 在哪里，然后从那里读取 ca.pem 供用户下载
 * - 这样可以确保下载的 CA 与代理用来签发网站证书的 CA 100% 一致
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, mkdirSync } from 'fs'

/**
 * 获取 http-mitm-proxy 的 sslCaDir 路径
 * 必须与 mitm-server.ts 中传给 proxy.listen() 的路径一致
 */
export function getSslCaDir(): string {
  return join(app.getPath('userData'), 'ssl-ca')
}

/**
 * 获取 CA 证书文件完整路径
 */
export function getCACertPath(): string {
  return join(getSslCaDir(), 'certs', 'ca.pem')
}

/**
 * 获取 CA 私钥文件完整路径
 */
export function getCAKeyPath(): string {
  return join(getSslCaDir(), 'keys', 'ca.private.key')
}

/**
 * 检查 CA 证书是否已存在（由 http-mitm-proxy 生成）
 */
export function isCAGenerated(): boolean {
  return existsSync(getCACertPath()) && existsSync(getCAKeyPath())
}

/**
 * 确保 sslCaDir 目录存在
 * http-mitm-proxy 会自动生成 CA 证书，我们只需要确保目录存在
 */
export function ensureSslCaDir(): void {
  const sslCaDir = getSslCaDir()
  const certsDir = join(sslCaDir, 'certs')
  const keysDir = join(sslCaDir, 'keys')
  
  if (!existsSync(certsDir)) {
    mkdirSync(certsDir, { recursive: true })
  }
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true })
  }
}

/**
 * 清理旧版 CA 证书文件（ca-cert.pem、ca-key.pem）
 */
export function cleanupOldCACerts(): void {
  const certDir = join(app.getPath('userData'), 'certs')
  const oldCertPath = join(certDir, 'ca-cert.pem')
  const oldKeyPath = join(certDir, 'ca-key.pem')

  try {
    if (existsSync(oldCertPath)) {
      const { unlinkSync } = require('fs')
      unlinkSync(oldCertPath)
      console.log('[CA] 已清理旧证书文件: ca-cert.pem')
    }
    if (existsSync(oldKeyPath)) {
      const { unlinkSync } = require('fs')
      unlinkSync(oldKeyPath)
      console.log('[CA] 已清理旧密钥文件: ca-key.pem')
    }
  } catch (e) {
    console.error('[CA] 清理旧证书失败:', e)
  }
}

/**
 * 获取 CA 证书内容（用于下载）
 */
export function getCACert(): string | null {
  const certPath = getCACertPath()
  if (!existsSync(certPath)) return null
  return readFileSync(certPath, 'utf-8')
}

/**
 * 获取 CA 证书文件完整路径（供下载端点使用）
 */
export function getCertFilePath(): string {
  return getCACertPath()
}

/**
 * 在应用启动时预生成 CA 证书
 * 
 * 直接调用 http-mitm-proxy 内部的 CA.create() 生成证书文件，
 * 而不是通过启动代理来间接触发（代理是惰性生成的，不可靠）。
 * 
 * ⚠️ 只会生成一次：如果 ca.pem 已存在，直接跳过
 */
export async function preGenerateCA(): Promise<void> {
  // 如果 CA 证书已存在，直接返回
  if (isCAGenerated()) {
    console.log(`[CA] CA 证书已存在，跳过生成: ${getCACertPath()}`)
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    try {
      const sslCaDir = getSslCaDir()
      // 确保目录存在
      ensureSslCaDir()

      // 直接调用 http-mitm-proxy 内部的 CA.create()
      // 它会正确生成 ca.pem / ca.private.key / ca.public.key
      const { CA } = require('http-mitm-proxy/dist/lib/ca')
      CA.create(sslCaDir, (err: any) => {
        if (err) {
          console.error('[CA] CA.create() 失败:', err)
          reject(err)
        } else {
          console.log(`[CA] CA 证书生成成功: ${getCACertPath()}`)
          resolve()
        }
      })
    } catch (e) {
      console.error('[CA] 预生成 CA 证书失败:', e)
      reject(e)
    }
  })
}

/**
 * 生成 CA 证书（向后兼容 API）
 * @returns 生成的证书和密钥路径及成功状态
 */
export async function generateCACert(): Promise<{ certPath: string; keyPath: string; success: boolean }> {
  await preGenerateCA()
  const certPath = getCACertPath()
  const keyPath = getCAKeyPath()
  const success = existsSync(certPath) && existsSync(keyPath)
  return { certPath, keyPath, success }
}
