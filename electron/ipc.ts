/**
 * IPC 通信层 - 注册所有 IPC 通道处理
 */
import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { IPC_CHANNELS, type BreakpointRule, type BreakpointResumePayload, type MapLocalRule, type MapRemoteRule } from '../src/services/types'
import * as sqlite from './db/sqlite'
import { startProxy, stopProxy, getProxyStatus, getLocalIP, setDomainFilters, setDeviceAliases, setBreakpointRules as setProxyBreakpointRules, setMapLocalRules as setProxyMapLocalRules, setMapRemoteRules as setProxyMapRemoteRules, abortAllPendingInterceptions, resolveBreakpointResume, rejectBreakpointResume } from './proxy/mitm-server'
import { generateCACert, isCAGenerated, getCertFilePath } from './proxy/ca-cert'
import { setSystemProxy, clearSystemProxy, getSystemProxyStatus } from './proxy/system-proxy'
import { executeCompare, testConnection, isCompareInProgress } from './services/ai-service'
import {
  cloneRepoWithProgress,
  cleanupRepo as cleanupRepoService,
  checkGitAvailability,
  checkDiskSpace,
  fetchBranches,
} from './services/repo-service'
import { exportCompareResult } from './services/export-service'
import { SSLErrorLogger } from './services/ssl-logger'
import type { CaptureRequest, AppSettings } from '../src/services/types'
import { generateWifiConfig, generateWifiQRContent } from './wifi-config'
import { startConfigServer, stopConfigServer, getConfigServerUrl } from './config-server'
import { generateQRCode } from './qr-generator'
import { getCurrentWifiInfo, getCurrentWifiInfoWithSudo, getWifiSsidWithAppleScript } from './wifi-info'
import { AIAnalyzeService, ProgressCallback } from './services/ai-analyze-service'
import { pushSSEEvent, pushProgress, pushLog, pushDone, pushError, getSSEPort, getBufferedLogs } from './sse-manager'

/** 全局 AIAnalyzeService 引用（用于分析控制和退出清理） */
let aiAnalyzeServiceRef: AIAnalyzeService | null = null

/** 分析是否正在运行 */
let isAnalysisRunning = false


/**
 * 异步执行 AI 分析（不阻塞 IPC 返回）
 */
async function executeAnalysisAsync(params: {
  repoUrl: string
  branch: string
  accessToken: string
  authMethod: string
  method: string
  url: string
  requestBody?: string
  requestHeaders?: Record<string, string | string[]>
  enableDeepAnalysis: boolean
  apiKey: string
  apiUrl: string
  modelName: string
  mainWindow: BrowserWindow
}): Promise<void> {
  try {
    pushLog('info', `开始克隆仓库: ${params.repoUrl}`)

    // Step 1: Clone 仓库
    const repoInfo = await cloneRepoWithProgress(
      {
        repoUrl: params.repoUrl,
        branch: params.branch,
        accessToken: params.accessToken,
        authMethod: params.authMethod,
      },
      params.mainWindow,
      // 进度回调：通过 SSE 推送 Clone 进度
      (progress) => {
        pushProgress('cloning', `正在克隆仓库... ${progress.percent}%`, {
          cloneProgress: progress,
        })
      }
    )

    pushLog('info', `仓库克隆完成: ${repoInfo.repoName}`)
    pushProgress('scanning', '正在扫描路由...')

    // Step 2: 创建 AIAnalyzeService 并运行分析
    const progressCallback: ProgressCallback = (event, data) => {
      if (event === 'log') {
        pushLog(data.level || 'info', data.message || '')
      } else if (event === 'progress') {
        pushProgress(data.phase || 'analyzing', data.message || '')
      }
    }

    aiAnalyzeServiceRef = new AIAnalyzeService(
      params.mainWindow,
      params.apiKey,
      params.apiUrl,
      progressCallback,
    )

    pushLog('info', '开始 AI 分析...')

    // 调用分析方法
    const result = await aiAnalyzeServiceRef.analyze({
      clonePath: repoInfo.clonePath,
      method: params.method,
      url: params.url,
      requestBody: params.requestBody,
      requestHeaders: params.requestHeaders,
    })

    pushLog('info', '分析完成！')

    // 构造 AIDeepAnalysisResult 格式
    pushDone({
      success: true,
      repoName: repoInfo.repoName,
      handlerFile: result.matches?.[0]?.filePath || '',
      handlerFunction: result.matches?.[0]?.handlerName || '',
      scenarios: result.scenarios || [],
      analysisSummary: result.analysis || '',
    })

    isAnalysisRunning = false
    aiAnalyzeServiceRef = null
  } catch (error: any) {
    console.error('[IPC] 分析执行失败:', error.message)
    pushError(error.message || '分析失败')
    isAnalysisRunning = false
    aiAnalyzeServiceRef = null
  }
}

/**
 * 注册所有 IPC 通道
 * @param mainWindow 主窗口引用
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ===== 代理控制 =====
  ipcMain.handle(IPC_CHANNELS.PROXY_START, async (_event, port: number) => {
    try {
      const success = await startProxy(port, mainWindow)
      return { success, status: getProxyStatus() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STOP, async () => {
    try {
      await stopProxy()
      return { success: true, status: getProxyStatus() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, () => {
    return getProxyStatus()
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_SET_DOMAIN_FILTERS, (_event, filters: string[]) => {
    try {
      setDomainFilters(filters)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== 系统代理 =====
  ipcMain.handle(IPC_CHANNELS.PROXY_SET_SYSTEM, async (_event, port: number) => {
    try {
      return await setSystemProxy(port)
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_CLEAR_SYSTEM, async () => {
    try {
      return await clearSystemProxy()
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_GET_SYSTEM_STATUS, async (_event, port: number) => {
    try {
      return await getSystemProxyStatus(port)
    } catch (error: any) {
      return { isActive: false, details: [], error: error.message }
    }
  })

  // ===== 请求数据 =====
  ipcMain.handle(IPC_CHANNELS.REQUEST_PERSIST, (_event, request: CaptureRequest) => {
    try {
      const id = sqlite.persistRequest(request)
      return { success: true, id }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_GET_ALL, (_event, { limit, offset }: { limit?: number; offset?: number }) => {
    try {
      const requests = sqlite.getAllRequests(limit || 100, offset || 0)
      return { success: true, requests }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== AI 对比 =====
  ipcMain.handle(IPC_CHANNELS.AI_COMPARE, async (_event, { requestA, requestB }: { requestA: CaptureRequest; requestB: CaptureRequest }) => {
    if (isCompareInProgress()) {
      return { success: false, error: 'AI 对比正在进行中，请等待完成后再试。' }
    }

    // 超时保护：90 秒
    const TIMEOUT_MS = 90000
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`AI 对比超时（${TIMEOUT_MS / 1000}秒），请检查 API 地址和网络连接。`)), TIMEOUT_MS)
    })

    try {
      // 先持久化两个请求
      const idA = sqlite.persistRequest(requestA)
      const idB = sqlite.persistRequest(requestB)

      // 获取设置
      const settings = sqlite.getAllSettings()

      if (!settings.apiKey) {
        return { success: false, error: '请先在设置页面配置 API Key。' }
      }

      console.log('[IPC] AI 对比开始，模型:', settings.modelName, 'API:', settings.apiUrl)

      // 执行对比（流式），加超时保护
      const result = await Promise.race([
        executeCompare(
          {
            requestA,
            requestB,
            promptTemplate: settings.aiPromptTemplate,
            modelName: settings.modelName,
            apiUrl: settings.apiUrl,
            apiKey: settings.apiKey,
          },
          // 流式 token 回调
          (chunk: string) => {
            try {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.AI_STREAM_CHUNK, chunk)
              }
            } catch (e) {
              console.error('[IPC] 推送流式 chunk 失败:', e)
            }
          },
          // 完成回调
          (compareResult) => {
            try {
              sqlite.saveComparison(idA, idB, compareResult.analysis, compareResult.modelName)
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_CHANNELS.AI_STREAM_END, compareResult)
              }
            } catch (e) {
              console.error('[IPC] 推送完成事件失败:', e)
            }
          }
        ),
        timeoutPromise,
      ])

      console.log('[IPC] AI 对比完成')
      return { success: true, result }
    } catch (error: any) {
      console.error('[IPC] AI 对比失败:', error?.message || error)
      return { success: false, error: error?.message || 'AI 对比失败，请检查 API 配置和网络连接。' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_TEST_CONNECTION, async (_event, { apiUrl, apiKey, modelName }: { apiUrl: string; apiKey: string; modelName: string }) => {
    try {
      return await testConnection(apiUrl, apiKey, modelName)
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  // ===== AI 代码分析 =====

  ipcMain.handle(IPC_CHANNELS.AI_CLEANUP_REPO, async (_event, repoName: string) => {
    try {
      const result = await cleanupRepoService(repoName)
      return { success: true, ...result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHECK_GIT_AVAILABILITY, async () => {
    try {
      const result = await checkGitAvailability()
      return result
    } catch (error: any) {
      return { available: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHECK_DISK_SPACE, async (_event, cloneDir: string) => {
    try {
      const result = await checkDiskSpace(cloneDir)
      return result
    } catch (error: any) {
      return { hasEnoughSpace: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_FETCH_BRANCHES, async (_event, { repoUrl, accessToken, authMethod }) => {
    try {
      const result = await fetchBranches(repoUrl, accessToken, authMethod)
      return result
    } catch (error: any) {
      throw new Error(`获取分支失败: ${error.message}`)
    }
  })

  // ===== 导出 =====
  ipcMain.handle(IPC_CHANNELS.EXPORT_FILE, async (_event, { format, compareResult, requestA, requestB }) => {
    try {
      return await exportCompareResult(format, compareResult, requestA, requestB)
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== 设置 =====
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, key: string) => {
    try {
      return sqlite.getSetting(key)
    } catch (error: any) {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, { key, value }: { key: string; value: string }) => {
    try {
      sqlite.setSetting(key, value)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    try {
      return sqlite.getAllSettings()
    } catch (error: any) {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE_ALL, (_event, settings: Partial<AppSettings>) => {
    try {
      sqlite.saveAllSettings(settings)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== 设备别名 =====
  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_ALIASES, () => {
    try {
      const settings = sqlite.getAllSettings()
      return settings.deviceAliases
    } catch {
      return {}
    }
  })

  ipcMain.handle(IPC_CHANNELS.DEVICE_SET_ALIAS, (_event, { ip, alias }: { ip: string; alias: string }) => {
    try {
      const settings = sqlite.getAllSettings()
      const aliases = { ...settings.deviceAliases, [ip]: alias }
      sqlite.saveAllSettings({ deviceAliases: aliases })
      setDeviceAliases(aliases)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== CA 证书 =====
  ipcMain.handle(IPC_CHANNELS.CA_GENERATE, async () => {
    try {
      const result = await generateCACert()
      await sqlite.saveAllSettings({ caCertGenerated: result.success })
      return result
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CA_GET_STATUS, () => {
    return isCAGenerated()
  })

  ipcMain.handle(IPC_CHANNELS.CA_GET_PATH, () => {
    return getCertFilePath()
  })

  // ===== 系统 =====
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_LOCAL_IP, () => {
    return getLocalIP()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_PATH, (_event, path: string) => {
    shell.openPath(path)
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_URL, (_event, url: string) => {
    shell.openExternal(url)
  })

  // ===== 对比记录 =====
  ipcMain.handle(IPC_CHANNELS.COMPARE_SAVE, (_event, { requestIdA, requestIdB, aiResult, modelName }: { requestIdA: number; requestIdB: number; aiResult: string; modelName: string }) => {
    try {
      const id = sqlite.saveComparison(requestIdA, requestIdB, aiResult, modelName)
      return { success: true, id }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.COMPARE_GET_HISTORY, (_event, { limit }: { limit?: number }) => {
    try {
      const history = sqlite.getComparisonHistory(limit || 50)
      return { success: true, history }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== 窗口控制 =====
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow.close()
  })

  // ===== SSL 错误处理 =====
  const sslLogger = SSLErrorLogger.getInstance()

  ipcMain.handle(IPC_CHANNELS.SSL_GET_STATS, () => {
    try {
      return sslLogger.getErrorSummary()
    } catch (error: any) {
      return { totalErrors: 0, uniqueDomains: 0, topErrorDomains: [], errorsByType: {}, pinnedDomainErrors: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SSL_GET_REPORT, () => {
    try {
      return sslLogger.generateDiagnosticReport()
    } catch (error: any) {
      return `生成诊断报告失败: ${error.message}`
    }
  })

  ipcMain.handle(IPC_CHANNELS.SSL_CLEAR, () => {
    try {
      sslLogger.clear()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SSL_ADD_PINNED_DOMAIN, (_event, pattern: string) => {
    try {
      // 动态添加证书固定域名
      const { SSLErrorClassifier } = require('./services/ssl-error-handler')
      SSLErrorClassifier.addPinnedDomain(pattern)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== WiFi 自动配置 =====
  ipcMain.handle(IPC_CHANNELS.WIFI_GENERATE_CONFIG, (_event, options: any) => {
    try {
      const result = generateWifiConfig(options)
      return result
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WIFI_START_SERVER, (_event, port?: number) => {
    try {
      const url = startConfigServer(port || 3000)
      return { success: true, url }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WIFI_STOP_SERVER, () => {
    try {
      stopConfigServer()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WIFI_GET_QR, async (_event, text: string) => {
    try {
      const result = await generateQRCode({ text })
      return result
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WIFI_GET_CURRENT, async () => {
    try {
      const result = await getCurrentWifiInfo()
      return { success: true, ...result }
    } catch (error: any) {
      return { success: false, ssid: '', error: error.message }
    }
  })

  // 使用 airport 命令获取（更可靠）
  ipcMain.handle('wifi:get-current-airport', async () => {
    try {
      const result = await getWifiSsidWithAppleScript()
      return { success: true, ...result }
    } catch (error: any) {
      return { success: false, ssid: '', error: error.message }
    }
  })

  // ===== 断点功能 =====

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_ADD_RULE, async (_event, rule: Omit<BreakpointRule, 'id' | 'createdAt'>) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = settings.breakpointRules || []
      
      const newRule: BreakpointRule = {
        ...rule,
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        createdAt: new Date().toISOString(),
      }
      
      rules.push(newRule)
      sqlite.saveAllSettings({ breakpointRules: rules })
      setProxyBreakpointRules(rules)
      
      return { success: true, rule: newRule }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_REMOVE_RULE, async (_event, ruleId: string) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = (settings.breakpointRules || []).filter(r => r.id !== ruleId)
      sqlite.saveAllSettings({ breakpointRules: rules })
      setProxyBreakpointRules(rules)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_UPDATE_RULE, async (_event, { ruleId, updates }: { ruleId: string; updates: Partial<BreakpointRule> }) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = settings.breakpointRules || []
      const index = rules.findIndex(r => r.id === ruleId)
      
      if (index === -1) {
        return { success: false, error: '规则不存在' }
      }
      
      rules[index] = { ...rules[index], ...updates }
      sqlite.saveAllSettings({ breakpointRules: rules })
      setProxyBreakpointRules(rules)
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_GET_RULES, () => {
    try {
      const settings = sqlite.getAllSettings()
      return settings.breakpointRules || []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_RESUME, async (_event, payload: BreakpointResumePayload) => {
    try {
      const { sessionId, action, modified } = payload
      
      if (action === 'abort') {
        rejectBreakpointResume(sessionId)
        return { success: true }
      }
      
      // action === 'resume'
      if (modified) {
        resolveBreakpointResume(sessionId, {
          id: sessionId,
          status: 'resumed',
          editable: modified,
          original: modified, // 临时使用，实际应该从 pendingInterceptions 获取
          stage: 'request', // 临时使用
          ruleId: '',
          interceptedAt: new Date().toISOString(),
        })
      }
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_ABORT, async (_event, sessionId: string) => {
    try {
      rejectBreakpointResume(sessionId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('breakpoint:sync-rules', async (_event, rules: BreakpointRule[]) => {
    try {
      setProxyBreakpointRules(rules)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== Map Local 功能 =====

  ipcMain.handle(IPC_CHANNELS.MAP_LOCAL_ADD_RULE, async (_event, rule: Omit<MapLocalRule, 'id' | 'createdAt'>) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = settings.mapLocalRules || []

      const newRule: MapLocalRule = {
        ...rule,
        id: `map_local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        createdAt: new Date().toISOString(),
      }

      rules.push(newRule)
      sqlite.saveAllSettings({ mapLocalRules: rules })
      setProxyMapLocalRules(rules.filter(r => r.enabled))

      return { success: true, rule: newRule }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_LOCAL_REMOVE_RULE, async (_event, ruleId: string) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = (settings.mapLocalRules || []).filter(r => r.id !== ruleId)
      sqlite.saveAllSettings({ mapLocalRules: rules })
      setProxyMapLocalRules(rules.filter(r => r.enabled))
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_LOCAL_UPDATE_RULE, async (_event, { ruleId, updates }: { ruleId: string; updates: Partial<MapLocalRule> }) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = settings.mapLocalRules || []
      const index = rules.findIndex(r => r.id === ruleId)

      if (index === -1) {
        return { success: false, error: '规则不存在' }
      }

      rules[index] = { ...rules[index], ...updates }
      sqlite.saveAllSettings({ mapLocalRules: rules })
      setProxyMapLocalRules(rules.filter(r => r.enabled))

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_LOCAL_GET_RULES, () => {
    try {
      const settings = sqlite.getAllSettings()
      return settings.mapLocalRules || []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_LOCAL_SYNC_RULES, async (_event, rules: MapLocalRule[]) => {
    try {
      setProxyMapLocalRules(rules)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== Map Remote 功能 =====

  ipcMain.handle(IPC_CHANNELS.MAP_REMOTE_ADD_RULE, async (_event, rule: Omit<MapRemoteRule, 'id' | 'createdAt'>) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = settings.mapRemoteRules || []

      const newRule: MapRemoteRule = {
        ...rule,
        id: `map_remote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        createdAt: new Date().toISOString(),
      }

      rules.push(newRule)
      sqlite.saveAllSettings({ mapRemoteRules: rules })
      setProxyMapRemoteRules(rules.filter(r => r.enabled))

      return { success: true, rule: newRule }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_REMOTE_REMOVE_RULE, async (_event, ruleId: string) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = (settings.mapRemoteRules || []).filter(r => r.id !== ruleId)
      sqlite.saveAllSettings({ mapRemoteRules: rules })
      setProxyMapRemoteRules(rules.filter(r => r.enabled))
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_REMOTE_UPDATE_RULE, async (_event, { ruleId, updates }: { ruleId: string; updates: Partial<MapRemoteRule> }) => {
    try {
      const settings = sqlite.getAllSettings()
      const rules = settings.mapRemoteRules || []
      const index = rules.findIndex(r => r.id === ruleId)

      if (index === -1) {
        return { success: false, error: '规则不存在' }
      }

      rules[index] = { ...rules[index], ...updates }
      sqlite.saveAllSettings({ mapRemoteRules: rules })
      setProxyMapRemoteRules(rules.filter(r => r.enabled))

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_REMOTE_GET_RULES, () => {
    try {
      const settings = sqlite.getAllSettings()
      return settings.mapRemoteRules || []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.MAP_REMOTE_SYNC_RULES, async (_event, rules: MapRemoteRule[]) => {
    try {
      setProxyMapRemoteRules(rules)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ===== AI 混合模式（使用 sse-manager.ts）=====

  /**
   * 获取 SSE 服务器端口
   */
  ipcMain.handle(IPC_CHANNELS.AI_SSE_GET_PORT, () => {
    return { success: true, port: getSSEPort() }
  })

  /**
   * 开始 AI 分析（混合模式）
   */
  ipcMain.handle(IPC_CHANNELS.AI_START_ANALYSIS, async (event, args: any) => {
    try {
      if (isAnalysisRunning) {
        return { success: false, error: '分析正在进行中，请等待完成后再试。' }
      }

      // preload 发送的是 { request, enableDeepAnalysis }
      const { request, enableDeepAnalysis } = args
      const { repoUrl, branch, accessToken, authMethod, method, url, requestBody, requestHeaders } = request || {}

      console.log('[IPC] AI 混合模式分析开始，深度分析:', enableDeepAnalysis)

      // 获取 API 配置
      const settings = sqlite.getAllSettings()
      if (!settings.apiKey) {
        return { success: false, error: '请先在设置页面配置 API Key。' }
      }

      isAnalysisRunning = true

      // 获取 mainWindow（从 IPC event）
      const mainWindow = BrowserWindow.fromWebContents(event.sender)

      // 推送分析开始事件
      pushLog('info', '开始 AI 代码分析...')

      // 异步执行分析（不阻塞 IPC 返回）
      executeAnalysisAsync({
        repoUrl,
        branch,
        accessToken,
        authMethod,
        method,
        url,
        requestBody,
        requestHeaders,
        enableDeepAnalysis: enableDeepAnalysis || false,
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl,
        modelName: settings.modelName,
        mainWindow,
      }).catch((err) => {
        console.error('[IPC] 分析执行失败:', err.message)
        isAnalysisRunning = false
      })

      return { success: true, message: '分析已启动' }
    } catch (error: any) {
      console.error('[IPC] AI 分析启动失败:', error.message)
      isAnalysisRunning = false
      return { success: false, error: error.message }
    }
  })

  /**
   * 取消 AI 分析
   */
  ipcMain.handle(IPC_CHANNELS.AI_CANCEL_ANALYSIS, async () => {
    try {
      // TODO: 实现取消逻辑（终止 Worker、关闭 SSE 连接）
      console.log('[IPC] AI 分析取消请求')

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * 获取分析日志（IPC 轮询备选方案）
   */
  ipcMain.handle(IPC_CHANNELS.AI_GET_LOGS, async (_event, lastLogId: number) => {
    try {
      console.log(`[IPC][AI_GET_LOGS] 收到请求，lastLogId=${lastLogId}`)
      const { logs, lastId } = getBufferedLogs(lastLogId || 0)
      console.log(`[IPC][AI_GET_LOGS] 返回 ${logs.length} 条日志，lastId=${lastId}`)
      return { success: true, logs, lastLogId: lastId, hasMore: false }
    } catch (error: any) {
      console.error(`[IPC][AI_GET_LOGS] 错误:`, error.message)
      return { success: false, error: error.message }
    }
  })

  // ===== 文件选择 =====
  ipcMain.handle('file:select', async (event) => {
    try {
      const webContents = event.sender
      const browserWindow = BrowserWindow.fromWebContents(webContents)
      const result = await dialog.showOpenDialog(browserWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'JavaScript', extensions: ['js', 'mjs'] },
          { name: 'CSS', extensions: ['css'] },
          { name: 'HTML', extensions: ['html', 'htm'] },
          { name: 'Text', extensions: ['txt', 'md', 'xml', 'yaml', 'yml'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }
      return { success: true, filePath: result.filePaths[0] }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 初始化时加载断点规则和 Map Local/Remote 规则到 proxy
  const initialSettings = sqlite.getAllSettings()
  if (initialSettings.breakpointRules) {
    setProxyBreakpointRules(initialSettings.breakpointRules)
  }
  if (initialSettings.mapLocalRules) {
    setProxyMapLocalRules(initialSettings.mapLocalRules.filter(r => r.enabled))
  }
  if (initialSettings.mapRemoteRules) {
    setProxyMapRemoteRules(initialSettings.mapRemoteRules.filter(r => r.enabled))
  }
}
