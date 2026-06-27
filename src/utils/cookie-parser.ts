/**
 * Cookie 解析工具
 * 从请求/响应头中解析 Cookie
 */
import type { Cookie } from '../services/types'

/**
 * 从请求头中解析 Cookie
 * @param cookieHeader Cookie 请求头的值
 * @param domain 请求域名
 * @returns Cookie 数组
 */
export function parseCookieHeader(cookieHeader: string, domain: string): Cookie[] {
  if (!cookieHeader) return []

  return cookieHeader.split(';').map(pair => {
    const [name, ...rest] = pair.trim().split('=')
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain,
      path: '/',
      httpOnly: false,
      secure: false,
      createdAt: new Date().toISOString(),
    }
  }).filter(c => c.name)
}

/**
 * 从响应头中解析 Set-Cookie
 * @param setCookieHeader Set-Cookie 响应头的值（可能是数组）
 * @param domain 响应域名
 * @returns Cookie 数组
 */
export function parseSetCookieHeader(setCookieHeader: string | string[], domain: string): Cookie[] {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]

  return headers.map(header => {
    const parts = header.split(';').map(p => p.trim())
    const [nameValue, ...attributes] = parts
    const [name, ...rest] = nameValue.split('=')

    if (!name) return null

    const cookie: Cookie = {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain,
      path: '/',
      httpOnly: false,
      secure: false,
      createdAt: new Date().toISOString(),
    }

    // 解析属性
    for (const attr of attributes) {
      const eqIndex = attr.indexOf('=')
      const key = eqIndex === -1 ? attr.toLowerCase() : attr.substring(0, eqIndex).trim().toLowerCase()
      const val = eqIndex === -1 ? '' : attr.substring(eqIndex + 1).trim()

      switch (key) {
        case 'domain':
          cookie.domain = val || domain
          break
        case 'path':
          cookie.path = val || '/'
          break
        case 'expires':
          cookie.expires = val
          break
        case 'httponly':
          cookie.httpOnly = true
          break
        case 'secure':
          cookie.secure = true
          break
        case 'samesite':
          if (val === 'Strict' || val === 'Lax' || val === 'None') {
            cookie.sameSite = val
          }
          break
      }
    }

    return cookie
  }).filter((c): c is Cookie => c !== null)
}

/**
 * 将 Cookie 数组转换为 Cookie 请求头
 * @param cookies Cookie 数组
 * @returns Cookie 请求头的值
 */
export function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

/**
 * 合并 Cookie（新的覆盖旧的）
 * @param existing 现有 Cookie 列表
 * @param newCookies 新 Cookie 列表
 * @returns 合并后的 Cookie 列表
 */
export function mergeCookies(existing: Cookie[], newCookies: Cookie[]): Cookie[] {
  const map = new Map<string, Cookie>()

  for (const cookie of existing) {
    const key = `${cookie.domain}:${cookie.path}:${cookie.name}`
    map.set(key, cookie)
  }

  for (const cookie of newCookies) {
    const key = `${cookie.domain}:${cookie.path}:${cookie.name}`
    map.set(key, cookie)
  }

  return Array.from(map.values())
}
