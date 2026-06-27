/**
 * Cookie 状态管理
 * 管理 Cookie 的增删改查和持久化
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Cookie, CookieJar } from '../services/types'
import { ipc } from '../services/ipc'
import { mergeCookies } from '../utils/cookie-parser'

export const useCookieStore = defineStore('cookie', () => {
  // ===== State =====

  /** Cookie 列表 */
  const cookies = ref<Cookie[]>([])

  /** 是否已加载 */
  const loaded = ref<boolean>(false)

  /** 当前选中的域名 */
  const selectedDomain = ref<string | null>(null)

  // ===== Getters =====

  /** 所有域名列表（去重、排序） */
  const domains = computed(() => {
    const domainSet = new Set(cookies.value.map(c => c.domain))
    return Array.from(domainSet).sort()
  })

  /** 按域名过滤后的 Cookie */
  const filteredCookies = computed(() => {
    if (!selectedDomain.value) return cookies.value
    return cookies.value.filter(c => c.domain === selectedDomain.value)
  })

  /** Cookie 总数 */
  const cookieCount = computed(() => cookies.value.length)

  // ===== Actions =====

  /** 加载所有 Cookie */
  async function loadCookies(): Promise<void> {
    try {
      cookies.value = await ipc.cookie.getAll()
      loaded.value = true
    } catch (error) {
      console.error('Failed to load cookies:', error)
    }
  }

  /** 添加 Cookie */
  async function addCookie(cookie: Cookie): Promise<void> {
    try {
      await ipc.cookie.add(cookie)
      // 更新本地状态：替换同 domain+path+name 的 Cookie
      const key = `${cookie.domain}:${cookie.path}:${cookie.name}`
      const index = cookies.value.findIndex(
        c => `${c.domain}:${c.path}:${c.name}` === key
      )
      if (index !== -1) {
        cookies.value[index] = cookie
      } else {
        cookies.value.push(cookie)
      }
    } catch (error) {
      console.error('Failed to add cookie:', error)
    }
  }

  /** 更新 Cookie */
  async function updateCookie(domain: string, path: string, name: string, updates: Partial<Cookie>): Promise<void> {
    try {
      await ipc.cookie.update(domain, path, name, updates)
      const index = cookies.value.findIndex(
        c => c.domain === domain && c.path === path && c.name === name
      )
      if (index !== -1) {
        cookies.value[index] = { ...cookies.value[index], ...updates }
      }
    } catch (error) {
      console.error('Failed to update cookie:', error)
    }
  }

  /** 删除单个 Cookie */
  async function deleteCookie(domain: string, path: string, name: string): Promise<void> {
    try {
      await ipc.cookie.delete(domain, path, name)
      cookies.value = cookies.value.filter(
        c => !(c.domain === domain && c.path === path && c.name === name)
      )
    } catch (error) {
      console.error('Failed to delete cookie:', error)
    }
  }

  /** 清空某个域名下的所有 Cookie */
  async function clearDomain(domain: string): Promise<void> {
    try {
      await ipc.cookie.clearDomain(domain)
      cookies.value = cookies.value.filter(c => c.domain !== domain)
    } catch (error) {
      console.error('Failed to clear domain cookies:', error)
    }
  }

  /** 清空所有 Cookie */
  async function clearAll(): Promise<void> {
    try {
      await ipc.cookie.clearAll()
      cookies.value = []
    } catch (error) {
      console.error('Failed to clear all cookies:', error)
    }
  }

  /** 导出 Cookie Jar */
  function exportJar(): CookieJar {
    return {
      cookies: cookies.value,
      exportedAt: new Date().toISOString(),
      source: 'PowerCatch',
    }
  }

  /** 导入 Cookie Jar */
  async function importJar(jar: CookieJar): Promise<void> {
    try {
      await ipc.cookie.importJar(jar)
      cookies.value = mergeCookies(cookies.value, jar.cookies)
    } catch (error) {
      console.error('Failed to import cookie jar:', error)
    }
  }

  /** 选择域名过滤 */
  function selectDomain(domain: string | null): void {
    selectedDomain.value = domain
  }

  return {
    // State
    cookies,
    loaded,
    selectedDomain,
    // Getters
    domains,
    filteredCookies,
    cookieCount,
    // Actions
    loadCookies,
    addCookie,
    updateCookie,
    deleteCookie,
    clearDomain,
    clearAll,
    exportJar,
    importJar,
    selectDomain,
  }
})
