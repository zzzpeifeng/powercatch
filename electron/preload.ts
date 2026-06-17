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
}

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 导出类型（供渲染进程使用）
export type ElectronAPI = typeof electronAPI
