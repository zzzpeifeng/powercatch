/**
 * 系统代理状态管理
 *
 * 功能：
 * - 监听/查询本机系统代理是否开启
 * - 提供开启/关闭本机代理的方法
 * - 周期性轮询状态（避免 UI 与实际系统状态不同步）
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ipc } from '../services/ipc'

export const useSystemProxyStore = defineStore('system-proxy', () => {
  // ===== State =====

  /** 系统代理是否激活 */
  const isActive = ref<boolean>(false)

  /** 当前激活的网卡列表 */
  const activeServices = ref<string[]>([])

  /** 代理端口（用于查询时匹配） */
  const port = ref<number>(8888)

  // ===== 轮询 =====

  let pollTimer: ReturnType<typeof setInterval> | null = null

  /** 启动周期性轮询（每 3 秒刷新一次） */
  function startPolling(): void {
    if (pollTimer) return
    refresh()
    pollTimer = setInterval(refresh, 3000)
  }

  /** 停止轮询 */
  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** 主动刷新状态 */
  async function refresh(): Promise<void> {
    try {
      const result = await ipc.proxy.getSystemProxyStatus(port.value)
      isActive.value = result.isActive
      activeServices.value = result.details?.map((d) => d.serviceName) || []
    } catch {
      // 静默失败
    }
  }

  // ===== Actions =====

  /** 开启本机代理 */
  async function enable(targetPort: number): Promise<{ success: boolean; message: string }> {
    port.value = targetPort
    const result = await ipc.proxy.setSystemProxy(targetPort)
    if (result.success) {
      await refresh()
    }
    return result
  }

  /** 关闭本机代理 */
  async function disable(): Promise<{ success: boolean; message: string }> {
    const result = await ipc.proxy.clearSystemProxy()
    if (result.success) {
      await refresh()
    }
    return result
  }

  return {
    // State
    isActive,
    activeServices,
    port,
    // Actions
    refresh,
    startPolling,
    stopPolling,
    enable,
    disable,
  }
})
