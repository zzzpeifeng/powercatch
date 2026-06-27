/**
 * Electron 预加载脚本
 * 通过 contextBridge 暴露 IPC 通信接口给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../src/services/types'

/**
 * 暴露给渲染进程的 API
 */
const electronAPI = {
  // 代理控制
  proxy: {
    start: (port: number) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_START, port),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STOP),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STATUS),
    onNewRequest: (callback: (request: any) => void) => {
      const handler = (_event: any, request: any) => callback(request)
      ipcRenderer.on(IPC_CHANNELS.PROXY_NEW_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PROXY_NEW_REQUEST, handler)
    },
    onRequestUpdated: (callback: (update: any) => void) => {
      const handler = (_event: any, update: any) => callback(update)
      ipcRenderer.on(IPC_CHANNELS.PROXY_REQUEST_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PROXY_REQUEST_UPDATED, handler)
    },
    setDomainFilters: (filters: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROXY_SET_DOMAIN_FILTERS, filters),

    // 系统代理
    setSystemProxy: (port: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROXY_SET_SYSTEM, port),
    clearSystemProxy: () =>
      ipcRenderer.invoke(IPC_CHANNELS.PROXY_CLEAR_SYSTEM),
    getSystemProxyStatus: (port: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROXY_GET_SYSTEM_STATUS, port),
  },

  // AI 对比
  ai: {
    compare: (requestA: any, requestB: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_COMPARE, { requestA, requestB }),
    onStreamChunk: (callback: (chunk: string) => void) => {
      const handler = (_event: any, chunk: string) => callback(chunk)
      ipcRenderer.on(IPC_CHANNELS.AI_STREAM_CHUNK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_STREAM_CHUNK, handler)
    },
    onStreamEnd: (callback: (result: any) => void) => {
      const handler = (_event: any, result: any) => callback(result)
      ipcRenderer.on(IPC_CHANNELS.AI_STREAM_END, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_STREAM_END, handler)
    },
    testConnection: (apiUrl: string, apiKey: string, modelName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_TEST_CONNECTION, { apiUrl, apiKey, modelName }),
  },

  // AI 代码分析
  aiCodeAnalysis: {
    // ===== 兼容旧版本 =====
    analyze: (request: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYZE, request),
    abort: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ABORT),
    cleanupRepo: (repoName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CLEANUP_REPO, repoName),
    checkGitAvailability: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHECK_GIT_AVAILABILITY),
    checkDiskSpace: (cloneDir: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHECK_DISK_SPACE, cloneDir),
    fetchBranches: (repoUrl: string, token: string, authMethod: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_FETCH_BRANCHES, { repoUrl, accessToken: token, authMethod }),
    onScanProgress: (callback: (progress: any) => void) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.AI_SCAN_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_SCAN_PROGRESS, handler)
    },
    onCloneProgress: (callback: (progress: any) => void) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.AI_CLONE_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_CLONE_PROGRESS, handler)
    },
    onStreamChunk: (callback: (chunk: string) => void) => {
      const handler = (_event: any, chunk: string) => callback(chunk)
      ipcRenderer.on(IPC_CHANNELS.AI_CODE_ANALYZE_STREAM_CHUNK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_CODE_ANALYZE_STREAM_CHUNK, handler)
    },
    onStreamEnd: (callback: (result: any) => void) => {
      const handler = (_event: any, result: any) => callback(result)
      ipcRenderer.on(IPC_CHANNELS.AI_CODE_ANALYZE_STREAM_END, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_CODE_ANALYZE_STREAM_END, handler)
    },

    // ===== 新增：混合模式 API =====

    /**
     * 开始分析（支持混合模式）
     * @param request 分析请求参数
     * @param enableDeepAnalysis 是否启用深度分析（阶段2）
     */
    startAnalysis: (request: any, enableDeepAnalysis: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_START_ANALYSIS, { request, enableDeepAnalysis }),

    /**
     * 取消分析
     */
    cancelAnalysis: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CANCEL_ANALYSIS),

    /**
     * 获取 SSE 服务器端口号
     * @returns { success: boolean, port?: number }
     */
    getSSEPort: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SSE_GET_PORT),

    /**
     * 启动 SSE 服务器
     * @returns { success: boolean, port?: number }
     */
    startSSEServer: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SSE_START),

    /**
     * 停止 SSE 服务器
     * @returns { success: boolean }
     */
    stopSSEServer: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SSE_STOP),

    /**
     * 获取增量日志（IPC 轮询降级方案）
     * @param lastLogId 上次获取的日志 ID
     * @returns { logs: AnalysisLogEntry[], lastLogId: number }
     */
    getLogs: (lastLogId: number = 0) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_GET_LOGS, lastLogId),

    /**
     * 监听分析日志（通过 IPC 推送）
     * @param callback 日志回调函数
     * @returns 取消监听的函数
     */
    onAnalysisLog: (callback: (log: any) => void) => {
      const handler = (_event: any, log: any) => callback(log)
      ipcRenderer.on(IPC_CHANNELS.AI_ANALYSIS_LOG, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_ANALYSIS_LOG, handler)
    },

    /**
     * 监听分析进度（通过 IPC 推送）
     * @param callback 进度回调函数
     * @returns 取消监听的函数
     */
    onAnalysisProgress: (callback: (progress: any) => void) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.AI_ANALYSIS_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_ANALYSIS_PROGRESS, handler)
    },

    /**
     * 监听分析完成（通过 IPC 推送）
     * @param callback 完成回调函数
     * @returns 取消监听的函数
     */
    onAnalysisDone: (callback: (result: any) => void) => {
      const handler = (_event: any, result: any) => callback(result)
      ipcRenderer.on(IPC_CHANNELS.AI_ANALYSIS_DONE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_ANALYSIS_DONE, handler)
    },

    /**
     * 监听分析错误（通过 IPC 推送）
     * @param callback 错误回调函数
     * @returns 取消监听的函数
     */
    onAnalysisError: (callback: (error: any) => void) => {
      const handler = (_event: any, error: any) => callback(error)
      ipcRenderer.on(IPC_CHANNELS.AI_ANALYSIS_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_ANALYSIS_ERROR, handler)
    },
  },

  // 导出
  export: {
    file: (format: string, compareResult: any, requestA: any, requestB: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_FILE, { format, compareResult, requestA, requestB }),
  },

  // 请求数据
  request: {
    persist: (request: any) => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_PERSIST, request),
    getAll: (limit?: number, offset?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.REQUEST_GET_ALL, { limit, offset }),
    replay: (request: any) => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_REPLAY, request),
  },

  // 设置
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    saveAll: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE_ALL, settings),
  },

  // 设备别名
  device: {
    getAliases: () => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_ALIASES),
    setAlias: (ip: string, alias: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DEVICE_SET_ALIAS, { ip, alias }),
  },

  // CA 证书
  ca: {
    generate: () => ipcRenderer.invoke(IPC_CHANNELS.CA_GENERATE),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.CA_GET_STATUS),
    getPath: () => ipcRenderer.invoke(IPC_CHANNELS.CA_GET_PATH),
  },

  // 系统
  system: {
    getLocalIp: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_LOCAL_IP),
    openPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_PATH, path),
    openUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_URL, url),
  },

  // 对比记录
  compare: {
    save: (requestIdA: number, requestIdB: number, aiResult: string, modelName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPARE_SAVE, { requestIdA, requestIdB, aiResult, modelName }),
    getHistory: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPARE_GET_HISTORY, { limit }),
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  },

  // SSL 错误处理
  ssl: {
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.SSL_GET_STATS),
    getReport: () => ipcRenderer.invoke(IPC_CHANNELS.SSL_GET_REPORT),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.SSL_CLEAR),
    addPinnedDomain: (pattern: string) => ipcRenderer.invoke(IPC_CHANNELS.SSL_ADD_PINNED_DOMAIN, pattern),
  },

  // WiFi 自动配置
  wifi: {
    generateConfig: (options: any) => ipcRenderer.invoke(IPC_CHANNELS.WIFI_GENERATE_CONFIG, options),
    startServer: (port?: number) => ipcRenderer.invoke(IPC_CHANNELS.WIFI_START_SERVER, port),
    stopServer: () => ipcRenderer.invoke(IPC_CHANNELS.WIFI_STOP_SERVER),
    getQRCode: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.WIFI_GET_QR, text),
    getCurrentWifi: () => ipcRenderer.invoke(IPC_CHANNELS.WIFI_GET_CURRENT),
    getCurrentWifiAirport: () => ipcRenderer.invoke(IPC_CHANNELS.WIFI_GET_CURRENT_AIRPORT),
  },

  // 断点功能
  breakpoint: {
    addRule: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_ADD_RULE, rule),
    removeRule: (ruleId: string) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_REMOVE_RULE, ruleId),
    updateRule: (ruleId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_UPDATE_RULE, { ruleId, updates }),
    getRules: () => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_GET_RULES),
    resume: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_RESUME, payload),
    abort: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_ABORT, sessionId),
    onIntercepted: (callback: (session: any) => void) => {
      const handler = (_event: any, session: any) => callback(session)
      ipcRenderer.on(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BREAKPOINT_INTERCEPTED, handler)
    },
    onStatusUpdate: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.BREAKPOINT_STATUS_UPDATE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BREAKPOINT_STATUS_UPDATE, handler)
    },
    syncRules: (rules: any[]) => ipcRenderer.invoke('breakpoint:sync-rules', rules),
  },

  // Map Local 功能
  mapLocal: {
    addRule: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.MAP_LOCAL_ADD_RULE, rule),
    removeRule: (ruleId: string) => ipcRenderer.invoke(IPC_CHANNELS.MAP_LOCAL_REMOVE_RULE, ruleId),
    updateRule: (ruleId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.MAP_LOCAL_UPDATE_RULE, { ruleId, updates }),
    getRules: () => ipcRenderer.invoke(IPC_CHANNELS.MAP_LOCAL_GET_RULES),
    syncRules: (rules: any[]) => ipcRenderer.invoke(IPC_CHANNELS.MAP_LOCAL_SYNC_RULES, rules),
  },

  // Map Remote 功能
  mapRemote: {
    addRule: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_ADD_RULE, rule),
    removeRule: (ruleId: string) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_REMOVE_RULE, ruleId),
    updateRule: (ruleId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_UPDATE_RULE, { ruleId, updates }),
    getRules: () => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_GET_RULES),
    syncRules: (rules: any[]) => ipcRenderer.invoke(IPC_CHANNELS.MAP_REMOTE_SYNC_RULES, rules),
  },

  // Auto Responder 功能
  autoResponder: {
    addRule: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.AUTO_RESPONDER_ADD_RULE, rule),
    removeRule: (ruleId: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTO_RESPONDER_REMOVE_RULE, ruleId),
    updateRule: (ruleId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.AUTO_RESPONDER_UPDATE_RULE, { ruleId, updates }),
    getRules: () => ipcRenderer.invoke(IPC_CHANNELS.AUTO_RESPONDER_GET_RULES),
    syncRules: (rules: any[]) => ipcRenderer.invoke(IPC_CHANNELS.AUTO_RESPONDER_SYNC_RULES, rules),
  },

  // Rewrite Rules 功能
  rewriteRules: {
    addRule: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULES_ADD_RULE, rule),
    removeRule: (ruleId: string) => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULES_REMOVE_RULE, ruleId),
    updateRule: (ruleId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULES_UPDATE_RULE, { ruleId, updates }),
    getRules: () => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULES_GET_RULES),
    syncRules: (rules: any[]) => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULES_SYNC_RULES, rules),
  },

  // 会话管理
  session: {
    save: (session: any) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_SAVE, session),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
    loadRequests: (sessionId: number) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD_REQUESTS, sessionId),
    delete: (sessionId: number) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, sessionId),
    rename: (sessionId: number, newName: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_RENAME, { sessionId, newName }),
  },

  // 文件选择
  file: {
    select: () => ipcRenderer.invoke('file:select'),
  },
}

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 导出类型（供渲染进程使用）
export type ElectronAPI = typeof electronAPI
