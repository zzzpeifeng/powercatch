/**
 * IPC 通信封装
 * 将 Electron IPC 调用封装为类型安全的异步函数
 */
import type {
  CaptureRequest,
  RequestUpdate,
  ProxyStatus,
  ProxyInfo,
  AppSettings,
  CompareResult,
  ExportFormat,
  Toast,
  ProxyOperationResult,
  SystemProxyStatus,
  BreakpointRule,
  InterceptSession,
  BreakpointResumePayload,
  BreakpointStatus,
} from './types'

/** Electron API 类型（由 preload.ts 暴露） */
interface ElectronAPI {
  proxy: {
    start: (port: number) => Promise<{ success: boolean; status?: any; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    status: () => Promise<{ status: ProxyStatus; port: number; localIp: string }>
    onNewRequest: (callback: (request: CaptureRequest) => void) => () => void
    onRequestUpdated: (callback: (update: RequestUpdate) => void) => () => void
    setDomainFilters: (filters: string[]) => Promise<void>
    setSystemProxy: (port: number) => Promise<ProxyOperationResult>
    clearSystemProxy: () => Promise<ProxyOperationResult>
    getSystemProxyStatus: (port: number) => Promise<SystemProxyStatus>
  }
  ai: {
    compare: (requestA: CaptureRequest, requestB: CaptureRequest) => Promise<{ success: boolean; result?: CompareResult; error?: string }>
    onStreamChunk: (callback: (chunk: string) => void) => () => void
    onStreamEnd: (callback: (result: CompareResult) => void) => () => void
    testConnection: (apiUrl: string, apiKey: string, modelName: string) => Promise<{ success: boolean; message: string }>
  }
  export: {
    file: (format: ExportFormat, compareResult: CompareResult, requestA: CaptureRequest, requestB: CaptureRequest) => Promise<{ success: boolean; filePath?: string; error?: string }>
  }
  request: {
    persist: (request: CaptureRequest) => Promise<{ success: boolean; id?: number; error?: string }>
    getAll: (limit?: number, offset?: number) => Promise<{ success: boolean; requests?: any[]; error?: string }>
  }
  settings: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<{ success: boolean; error?: string }>
    getAll: () => Promise<AppSettings | null>
    saveAll: (settings: Partial<AppSettings>) => Promise<{ success: boolean; error?: string }>
  }
  device: {
    getAliases: () => Promise<Record<string, string>>
    setAlias: (ip: string, alias: string) => Promise<{ success: boolean; error?: string }>
  }
  ca: {
    generate: () => Promise<{ success: boolean; error?: string }>
    getStatus: () => Promise<boolean>
    getPath: () => Promise<string>
  }
  system: {
    getLocalIp: () => Promise<string>
    openPath: (path: string) => Promise<void>
    openUrl: (url: string) => Promise<void>
  }
  compare: {
    save: (requestIdA: number, requestIdB: number, aiResult: string, modelName: string) => Promise<{ success: boolean; id?: number; error?: string }>
    getHistory: (limit?: number) => Promise<{ success: boolean; history?: any[]; error?: string }>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
  ssl: {
    getStats: () => Promise<any>
    getReport: () => Promise<string>
    clear: () => Promise<{ success: boolean; error?: string }>
    addPinnedDomain: (pattern: string) => Promise<{ success: boolean; error?: string }>
  }
  wifi: {
    getCurrentWifi: () => Promise<{ success: boolean; ssid: string; error?: string }>
    generateConfig: (options: any) => Promise<{ success: boolean; message: string; filePath?: string; error?: string }>
    startServer: (port?: number) => Promise<{ success: boolean; url: string; error?: string }>
    stopServer: () => Promise<{ success: boolean; error?: string }>
    getQRCode: (text: string) => Promise<{ success: boolean; dataUrl: string; error?: string }>
  }
  breakpoint: {
    addRule: (rule: Omit<BreakpointRule, 'id' | 'createdAt'>) => Promise<{ success: boolean; rule?: BreakpointRule; error?: string }>
    removeRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>
    updateRule: (ruleId: string, updates: Partial<BreakpointRule>) => Promise<{ success: boolean; error?: string }>
    getRules: () => Promise<BreakpointRule[]>
    resume: (payload: BreakpointResumePayload) => Promise<{ success: boolean; error?: string }>
    abort: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    onIntercepted: (callback: (session: InterceptSession) => void) => () => void
    onStatusUpdate: (callback: (data: { requestId: string; status: BreakpointStatus }) => void) => () => void
    syncRules: (rules: BreakpointRule[]) => Promise<{ success: boolean; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

/**
 * 获取 Electron API（如果在 Electron 环境中）
 */
function getElectronAPI(): ElectronAPI | null {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI
  }
  return null
}

/**
 * IPC 通信层
 */
export const ipc = {
  // ===== 代理控制 =====
  proxy: {
    start: async (port: number): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.proxy.start(port)
    },

    stop: async (): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.proxy.stop()
    },

    status: async (): Promise<ProxyInfo> => {
      const api = getElectronAPI()
      if (!api) return { status: 'stopped', port: 8888, localIp: '127.0.0.1', certUrl: '' }
      const result = await api.proxy.status()
      return {
        status: result.status,
        port: result.port,
        localIp: result.localIp,
        certUrl: `http://${result.localIp}:8889/cert`,
      }
    },

    onNewRequest: (callback: (request: CaptureRequest) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.proxy.onNewRequest(callback)
    },

    onRequestUpdated: (callback: (update: RequestUpdate) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.proxy.onRequestUpdated(callback)
    },

    setDomainFilters: async (filters: string[]): Promise<void> => {
      const api = getElectronAPI()
      if (!api) return
      // 防止 filters 是 Vue reactive Proxy，先深拷贝成普通数组
      const plain = JSON.parse(JSON.stringify(filters))
      await api.proxy.setDomainFilters(plain)
    },

    // ===== 系统代理 =====
    setSystemProxy: async (port: number): Promise<ProxyOperationResult> => {
      const api = getElectronAPI()
      if (!api) return { success: false, message: 'Not in Electron environment' }
      return api.proxy.setSystemProxy(port)
    },

    clearSystemProxy: async (): Promise<ProxyOperationResult> => {
      const api = getElectronAPI()
      if (!api) return { success: false, message: 'Not in Electron environment' }
      return api.proxy.clearSystemProxy()
    },

    getSystemProxyStatus: async (port: number): Promise<SystemProxyStatus> => {
      const api = getElectronAPI()
      if (!api) return { isActive: false, details: [] }
      return api.proxy.getSystemProxyStatus(port)
    },
  },

  // ===== AI 对比 =====
  ai: {
    compare: async (requestA: CaptureRequest, requestB: CaptureRequest): Promise<{ success: boolean; result?: CompareResult; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      // 防止 request 对象是 Vue reactive Proxy，先深拷贝成普通对象
      const plainA = JSON.parse(JSON.stringify(requestA))
      const plainB = JSON.parse(JSON.stringify(requestB))
      return api.ai.compare(plainA, plainB)
    },

    onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.ai.onStreamChunk(callback)
    },

    onStreamEnd: (callback: (result: CompareResult) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.ai.onStreamEnd(callback)
    },

    testConnection: async (apiUrl: string, apiKey: string, modelName: string): Promise<{ success: boolean; message: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, message: 'Not in Electron environment' }
      return api.ai.testConnection(apiUrl, apiKey, modelName)
    },
  },

  // ===== 导出 =====
  export: {
    file: async (format: ExportFormat, compareResult: CompareResult, requestA: CaptureRequest, requestB: CaptureRequest) => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      // 防止对象是 Vue reactive Proxy，先深拷贝成普通对象
      const plainResult = JSON.parse(JSON.stringify(compareResult))
      const plainA = JSON.parse(JSON.stringify(requestA))
      const plainB = JSON.parse(JSON.stringify(requestB))
      return api.export.file(format, plainResult, plainA, plainB)
    },
  },

  // ===== 设置 =====
  settings: {
    get: async (key: string): Promise<string | null> => {
      const api = getElectronAPI()
      if (!api) return null
      return api.settings.get(key)
    },

    set: async (key: string, value: string): Promise<boolean> => {
      const api = getElectronAPI()
      if (!api) return false
      const result = await api.settings.set(key, value)
      return result.success
    },

    getAll: async (): Promise<AppSettings | null> => {
      const api = getElectronAPI()
      if (!api) return null
      return api.settings.getAll()
    },

    saveAll: async (settings: Partial<AppSettings>): Promise<boolean> => {
      const api = getElectronAPI()
      if (!api) return false
      const result = await api.settings.saveAll(settings)
      return result.success
    },
  },

  // ===== 设备 =====
  device: {
    getAliases: async (): Promise<Record<string, string>> => {
      const api = getElectronAPI()
      if (!api) return {}
      return api.device.getAliases()
    },

    setAlias: async (ip: string, alias: string): Promise<boolean> => {
      const api = getElectronAPI()
      if (!api) return false
      const result = await api.device.setAlias(ip, alias)
      return result.success
    },
  },

  // ===== CA 证书 =====
  ca: {
    generate: async (): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.ca.generate()
    },

    getStatus: async (): Promise<boolean> => {
      const api = getElectronAPI()
      if (!api) return false
      return api.ca.getStatus()
    },

    getPath: async (): Promise<string> => {
      const api = getElectronAPI()
      if (!api) return ''
      return api.ca.getPath()
    },
  },

  // ===== 系统 =====
  system: {
    getLocalIp: async (): Promise<string> => {
      const api = getElectronAPI()
      if (!api) return '127.0.0.1'
      return api.system.getLocalIp()
    },

    openPath: async (path: string): Promise<void> => {
      const api = getElectronAPI()
      if (!api) return
      return api.system.openPath(path)
    },

    openUrl: async (url: string): Promise<void> => {
      const api = getElectronAPI()
      if (!api) return
      return api.system.openUrl(url)
    },
  },

  // ===== 对比记录 =====
  compare: {
    save: async (requestIdA: number, requestIdB: number, aiResult: string, modelName: string): Promise<number | null> => {
      const api = getElectronAPI()
      if (!api) return null
      const result = await api.compare.save(requestIdA, requestIdB, aiResult, modelName)
      return result.success ? result.id ?? null : null
    },

    getHistory: async (limit?: number) => {
      const api = getElectronAPI()
      if (!api) return []
      const result = await api.compare.getHistory(limit)
      return result.success ? result.history || [] : []
    },
  },

  // ===== 窗口控制 =====
  window: {
    minimize: async () => {
      const api = getElectronAPI()
      if (!api) return
      return api.window.minimize()
    },

    maximize: async () => {
      const api = getElectronAPI()
      if (!api) return
      return api.window.maximize()
    },

    close: async () => {
      const api = getElectronAPI()
      if (!api) return
      return api.window.close()
    },
  },

  // ===== SSL 错误处理 =====
  ssl: {
    getStats: async (): Promise<any> => {
      const api = getElectronAPI()
      if (!api) return { totalErrors: 0, uniqueDomains: 0, topErrorDomains: [], errorsByType: {}, pinnedDomainErrors: 0 }
      return api.ssl.getStats()
    },

    getReport: async (): Promise<string> => {
      const api = getElectronAPI()
      if (!api) return ''
      return api.ssl.getReport()
    },

    clear: async (): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.ssl.clear()
    },

    addPinnedDomain: async (pattern: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.ssl.addPinnedDomain(pattern)
    },
  },

  // ===== WiFi 自动配置 =====
  wifi: {
    generateConfig: async (options: any): Promise<{ success: boolean; filePath?: string; downloadUrl?: string; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.wifi.generateConfig(options)
    },

    startServer: async (port?: number): Promise<{ success: boolean; url?: string; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.wifi.startServer(port)
    },

    stopServer: async (): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.wifi.stopServer()
    },

    getQRCode: async (text: string): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.wifi.getQRCode(text)
    },

    getCurrentWifi: async (): Promise<{ success: boolean; ssid: string; error?: string; needSudo?: boolean }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, ssid: '', error: 'Not in Electron environment' }
      return api.wifi.getCurrentWifi()
    },
  },

  // ===== 断点功能 =====
  breakpoint: {
    addRule: async (rule: Omit<BreakpointRule, 'id' | 'createdAt'>): Promise<{ success: boolean; rule?: BreakpointRule; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.breakpoint.addRule(rule)
    },

    removeRule: async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.breakpoint.removeRule(ruleId)
    },

    updateRule: async (ruleId: string, updates: Partial<BreakpointRule>): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.breakpoint.updateRule(ruleId, updates)
    },

    getRules: async (): Promise<BreakpointRule[]> => {
      const api = getElectronAPI()
      if (!api) return []
      return api.breakpoint.getRules()
    },

    resume: async (payload: BreakpointResumePayload): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.breakpoint.resume(payload)
    },

    abort: async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.breakpoint.abort(sessionId)
    },

    onIntercepted: (callback: (session: InterceptSession) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.breakpoint.onIntercepted(callback)
    },

    onStatusUpdate: (callback: (data: { requestId: string; status: BreakpointStatus }) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.breakpoint.onStatusUpdate(callback)
    },

    syncRules: async (rules: BreakpointRule[]): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.breakpoint.syncRules(rules)
    },
  },
}
