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
  BreakpointStatus,
  MapLocalRule,
  MapRemoteRule,
  AutoResponderRule,
  CodeAnalysisRequest,
  CodeAnalysisResult,
  CloneProgress,
  DiskSpaceResult,
  GitAvailabilityResult,
  AnalysisLogEntry,
  AIDeepAnalysisResult,
  CaptureSession,
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
  aiCodeAnalysis: {
    // ===== 兼容旧版本 =====
    analyze: (request: CodeAnalysisRequest) => Promise<{ success: boolean; error?: string }>
    abort: () => Promise<{ success: boolean }>
    cleanupRepo: (repoName: string) => Promise<{ success: boolean; error?: string }>
    checkGitAvailability: () => Promise<GitAvailabilityResult>
    checkDiskSpace: (cloneDir: string) => Promise<DiskSpaceResult>
    fetchBranches: (repoUrl: string, token: string, authMethod: string) => Promise<string[]>
    onScanProgress: (callback: (progress: { scanned: number; total: number; percent: number; phase?: string; currentFile?: string; matchCount?: number }) => void) => () => void
    onCloneProgress: (callback: (progress: CloneProgress) => void) => () => void
    onStreamChunk: (callback: (chunk: string) => void) => () => void
    onStreamEnd: (callback: (result: CodeAnalysisResult) => void) => () => void

    // ===== 新增：混合模式 API =====

    /**
     * 开始分析（支持混合模式）
     */
    startAnalysis: (request: CodeAnalysisRequest, enableDeepAnalysis: boolean) => Promise<{ success: boolean; error?: string }>

    /**
     * 取消分析
     */
    cancelAnalysis: () => Promise<{ success: boolean; error?: string }>

    /**
     * 获取 SSE 服务器端口号
     */
    getSSEPort: () => Promise<{ success: boolean; port?: number; error?: string }>

    /**
     * 启动 SSE 服务器
     */
    startSSEServer: () => Promise<{ success: boolean; port?: number; error?: string }>

    /**
     * 停止 SSE 服务器
     */
    stopSSEServer: () => Promise<{ success: boolean; error?: string }>

    /**
     * 获取增量日志（IPC 轮询降级方案）
     */
    getLogs: (lastLogId: number) => Promise<{ logs: AnalysisLogEntry[]; lastLogId: number }>

    /**
     * 监听分析日志（通过 IPC 推送）
     */
    onAnalysisLog: (callback: (log: AnalysisLogEntry) => void) => () => void

    /**
     * 监听分析进度（通过 IPC 推送）
     */
    onAnalysisProgress: (callback: (progress: { phase: string; percent: number; currentStep?: string }) => void) => () => void

    /**
     * 监听分析完成（通过 IPC 推送）
     */
    onAnalysisDone: (callback: (result: { success: boolean; result?: AIDeepAnalysisResult }) => void) => () => void

    /**
     * 监听分析错误（通过 IPC 推送）
     */
    onAnalysisError: (callback: (error: { message: string }) => void) => () => void
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
    resume: (payload: any) => Promise<{ success: boolean; error?: string }>
    abort: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    onIntercepted: (callback: (session: InterceptSession) => void) => () => void
    onStatusUpdate: (callback: (data: { requestId: string; status: BreakpointStatus }) => void) => () => void
    syncRules: (rules: BreakpointRule[]) => Promise<{ success: boolean; error?: string }>
  }
  mapLocal: {
    addRule: (rule: Omit<MapLocalRule, 'id' | 'createdAt'>) => Promise<{ success: boolean; rule?: MapLocalRule; error?: string }>
    removeRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>
    updateRule: (ruleId: string, updates: Partial<MapLocalRule>) => Promise<{ success: boolean; error?: string }>
    getRules: () => Promise<MapLocalRule[]>
    syncRules: (rules: MapLocalRule[]) => Promise<{ success: boolean; error?: string }>
  }
  mapRemote: {
    addRule: (rule: Omit<MapRemoteRule, 'id' | 'createdAt'>) => Promise<{ success: boolean; rule?: MapRemoteRule; error?: string }>
    removeRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>
    updateRule: (ruleId: string, updates: Partial<MapRemoteRule>) => Promise<{ success: boolean; error?: string }>
    getRules: () => Promise<MapRemoteRule[]>
    syncRules: (rules: MapRemoteRule[]) => Promise<{ success: boolean; error?: string }>
  }
  autoResponder: {
    addRule: (rule: Omit<AutoResponderRule, 'id' | 'createdAt'>) => Promise<{ success: boolean; rule?: AutoResponderRule; error?: string }>
    removeRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>
    updateRule: (ruleId: string, updates: Partial<AutoResponderRule>) => Promise<{ success: boolean; error?: string }>
    getRules: () => Promise<AutoResponderRule[]>
    syncRules: (rules: AutoResponderRule[]) => Promise<{ success: boolean; error?: string }>
  }
  session: {
    save: (session: Omit<CaptureSession, 'id' | 'createdAt'>) => Promise<{ success: boolean; id?: number; error?: string }>
    list: () => Promise<{ success: boolean; sessions?: CaptureSession[]; error?: string }>
    loadRequests: (sessionId: number) => Promise<{ success: boolean; requests?: CaptureRequest[]; error?: string }>
    delete: (sessionId: number) => Promise<{ success: boolean; error?: string }>
    rename: (sessionId: number, newName: string) => Promise<{ success: boolean; error?: string }>
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

  // ===== AI 代码分析 =====
  aiCodeAnalysis: {
    // ===== 兼容旧版本 =====

    analyze: async (request: CodeAnalysisRequest): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.analyze(request)
    },

    abort: async (): Promise<{ success: boolean }> => {
      const api = getElectronAPI()
      if (!api) return { success: false }
      return api.aiCodeAnalysis.abort()
    },

    cleanupRepo: async (repoName: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.cleanupRepo(repoName)
    },

    checkGitAvailability: async (): Promise<GitAvailabilityResult> => {
      const api = getElectronAPI()
      if (!api) return { available: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.checkGitAvailability()
    },

    checkDiskSpace: async (cloneDir: string): Promise<DiskSpaceResult> => {
      const api = getElectronAPI()
      if (!api) return { hasEnoughSpace: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.checkDiskSpace(cloneDir)
    },

    fetchBranches: async (repoUrl: string, token: string, authMethod: string): Promise<string[]> => {
      const api = getElectronAPI()
      if (!api) return []
      return api.aiCodeAnalysis.fetchBranches(repoUrl, token, authMethod)
    },

    onScanProgress: (callback: (progress: {
      scanned: number; total: number; percent: number;
      phase?: string; currentFile?: string; matchCount?: number
    }) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onScanProgress(callback)
    },

    onCloneProgress: (callback: (progress: CloneProgress) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onCloneProgress(callback)
    },

    onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onStreamChunk(callback)
    },

    onStreamEnd: (callback: (result: CodeAnalysisResult) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onStreamEnd(callback)
    },

    // ===== 新增：混合模式 API =====

    /**
     * 开始分析（支持混合模式）
     * @param request 分析请求参数
     * @param enableDeepAnalysis 是否启用深度分析（阶段2）
     */
    startAnalysis: async (
      request: CodeAnalysisRequest,
      enableDeepAnalysis: boolean = false
    ): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      // 参数格式需要与 preload.ts 中的 ipcRenderer.invoke 调用匹配
      // preload.ts 中：ipcRenderer.invoke(IPC_CHANNELS.AI_START_ANALYSIS, { request, enableDeepAnalysis })
      // 因此这里需要传递两个参数，而不是一个对象
      return api.aiCodeAnalysis.startAnalysis(request, enableDeepAnalysis)
    },

    /**
     * 取消分析
     */
    cancelAnalysis: async (): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.cancelAnalysis()
    },

    /**
     * 获取 SSE 服务器端口号
     * @returns { success: boolean, port?: number, error?: string }
     */
    getSSEPort: async (): Promise<{ success: boolean; port?: number; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.getSSEPort()
    },

    /**
     * 启动 SSE 服务器
     * @returns { success: boolean, port?: number, error?: string }
     */
    startSSEServer: async (): Promise<{ success: boolean; port?: number; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.startSSEServer()
    },

    /**
     * 停止 SSE 服务器
     * @returns { success: boolean, error?: string }
     */
    stopSSEServer: async (): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.aiCodeAnalysis.stopSSEServer()
    },

    /**
     * 获取增量日志（IPC 轮询降级方案）
     * @param lastLogId 上次获取的日志 ID
     * @returns { logs: AnalysisLogEntry[], lastLogId: number }
     */
    getLogs: async (lastLogId: number = 0): Promise<{ logs: AnalysisLogEntry[]; lastLogId: number }> => {
      const api = getElectronAPI()
      if (!api) return { logs: [], lastLogId: 0 }
      return api.aiCodeAnalysis.getLogs(lastLogId)
    },

    /**
     * 监听分析日志（通过 IPC 推送）
     * @param callback 日志回调函数
     * @returns 取消监听的函数
     */
    onAnalysisLog: (callback: (log: AnalysisLogEntry) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onAnalysisLog(callback)
    },

    /**
     * 监听分析进度（通过 IPC 推送）
     * @param callback 进度回调函数
     * @returns 取消监听的函数
     */
    onAnalysisProgress: (callback: (progress: { phase: string; percent: number; currentStep?: string }) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onAnalysisProgress(callback)
    },

    /**
     * 监听分析完成（通过 IPC 推送）
     * @param callback 完成回调函数
     * @returns 取消监听的函数
     */
    onAnalysisDone: (callback: (result: { success: boolean; result?: AIDeepAnalysisResult }) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onAnalysisDone(callback)
    },

    /**
     * 监听分析错误（通过 IPC 推送）
     * @param callback 错误回调函数
     * @returns 取消监听的函数
     */
    onAnalysisError: (callback: (error: { message: string }) => void): (() => void) => {
      const api = getElectronAPI()
      if (!api) return () => {}
      return api.aiCodeAnalysis.onAnalysisError(callback)
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

    resume: async (payload: any): Promise<{ success: boolean; error?: string }> => {
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

  // ===== Map Local 功能 =====
  mapLocal: {
    addRule: async (rule: Omit<MapLocalRule, 'id' | 'createdAt'>): Promise<{ success: boolean; rule?: MapLocalRule; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapLocal.addRule(rule)
    },

    removeRule: async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapLocal.removeRule(ruleId)
    },

    updateRule: async (ruleId: string, updates: Partial<MapLocalRule>): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapLocal.updateRule(ruleId, updates)
    },

    getRules: async (): Promise<MapLocalRule[]> => {
      const api = getElectronAPI()
      if (!api) return []
      return api.mapLocal.getRules()
    },

    syncRules: async (rules: MapLocalRule[]): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapLocal.syncRules(rules)
    },
  },

  // ===== Map Remote 功能 =====
  mapRemote: {
    addRule: async (rule: Omit<MapRemoteRule, 'id' | 'createdAt'>): Promise<{ success: boolean; rule?: MapRemoteRule; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapRemote.addRule(rule)
    },

    removeRule: async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapRemote.removeRule(ruleId)
    },

    updateRule: async (ruleId: string, updates: Partial<MapRemoteRule>): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapRemote.updateRule(ruleId, updates)
    },

    getRules: async (): Promise<MapRemoteRule[]> => {
      const api = getElectronAPI()
      if (!api) return []
      return api.mapRemote.getRules()
    },

    syncRules: async (rules: MapRemoteRule[]): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.mapRemote.syncRules(rules)
    },
  },

  // ===== Auto Responder 功能 =====
  autoResponder: {
    addRule: async (rule: Omit<AutoResponderRule, 'id' | 'createdAt'>): Promise<{ success: boolean; rule?: AutoResponderRule; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.autoResponder.addRule(rule)
    },

    removeRule: async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.autoResponder.removeRule(ruleId)
    },

    updateRule: async (ruleId: string, updates: Partial<AutoResponderRule>): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.autoResponder.updateRule(ruleId, updates)
    },

    getRules: async (): Promise<AutoResponderRule[]> => {
      const api = getElectronAPI()
      if (!api) return []
      return api.autoResponder.getRules()
    },

    syncRules: async (rules: AutoResponderRule[]): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.autoResponder.syncRules(rules)
    },
  },

  // ===== 会话管理 =====
  session: {
    save: async (session: Omit<CaptureSession, 'id' | 'createdAt'>): Promise<{ success: boolean; id?: number; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.session.save(session)
    },

    list: async (): Promise<{ success: boolean; sessions?: CaptureSession[]; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.session.list()
    },

    loadRequests: async (sessionId: number): Promise<{ success: boolean; requests?: CaptureRequest[]; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.session.loadRequests(sessionId)
    },

    delete: async (sessionId: number): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.session.delete(sessionId)
    },

    rename: async (sessionId: number, newName: string): Promise<{ success: boolean; error?: string }> => {
      const api = getElectronAPI()
      if (!api) return { success: false, error: 'Not in Electron environment' }
      return api.session.rename(sessionId, newName)
    },
  },
}
