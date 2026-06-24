/**
 * Electron 主进程入口
 * 负责窗口管理、IPC 注册、服务初始化
 */
const { app, BrowserWindow, Menu, nativeImage, nativeTheme, globalShortcut, ipcMain, shell, Tray } = require('electron') as any
import { join } from 'path'
import { initDatabase, closeDatabase, getAllSettings, saveAllSettings } from './db/sqlite'
import { registerIpcHandlers } from './ipc'
import { setDomainFilters, setDeviceAliases, getLocalIP, stopProxy } from './proxy/mitm-server'
import { startCertServer, stopCertServer } from './proxy/cert-server'
import { preGenerateCA, cleanupOldCACerts } from './proxy/ca-cert'
import { clearSystemProxy, hasPendingSnapshot } from './proxy/system-proxy'
import { startSSEServer, stopSSEServer, pushSSEEvent, getSSEPort } from './sse-manager'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let isCleaningUp = false

// ===== SSE 服务器相关变量（已迁移到 sse-manager.ts）=====
// 保留 getSSEPort 函数供其他模块使用

/**
 * 创建应用菜单
 */
function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * 创建主窗口并初始化所有服务
 */
async function createAndInitWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'PowerCatch',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#f5f5f5',
    show: false,
  })

  // 初始化数据库（必须在 registerIpcHandlers 之前，因为 IPC handler 会调用 getAllSettings）
  initDatabase()

  // 注册 IPC 处理器（在页面加载之前，避免渲染进程调用时 handler 未就绪）
  registerIpcHandlers(mainWindow)

  // 创建菜单
  createAppMenu()

  // 加载设置并应用
  const settings = getAllSettings()
  setDomainFilters(settings.domainFilters)
  setDeviceAliases(settings.deviceAliases)
  const localIp = getLocalIP()
  if (settings.localIp !== localIp) {
    saveAllSettings({ localIp })
  }

  // 启动证书下载服务（不阻塞窗口显示）
  startCertServer(8889).catch((err) => console.error('Cert server error:', err))

  // 启动 SSE 服务器（用于实时推送分析进度）
  try {
    const port = await startSSEServer(3001)
    console.log(`[Main] SSE 服务器启动成功，端口: ${port}`)
  } catch (err) {
    console.error('[Main] SSE 服务器启动失败:', err)
  }

  // 加载页面（IPC 已全部就绪）
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 点击关闭按钮时隐藏窗口（而非销毁），实现 Dock 驻留行为
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  // 窗口真正销毁时清理引用
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 注册全局快捷键 Cmd+Option+I 打开开发者工具
  globalShortcut.register('CmdOrCtrl+Alt+I', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools()
    }
  })
}

/**
 * 应用生命周期管理
 */
app.whenReady().then(async () => {
  // 提前生成 CA 证书，确保用户访问证书下载页面时证书已存在
  // 通过启动临时代理触发 http-mitm-proxy 生成 CA 证书
  try {
    cleanupOldCACerts()
    await preGenerateCA()
  } catch (e) {
    console.error('[Main] 提前生成 CA 证书失败:', e)
  }

  // 设置 Dock 图标（开发模式下 electron-builder 的 icon 配置不生效，需要手动设置）
  // 开发：项目根目录/resources/icon.png
  // 打包：Contents/Resources/resources/icon.png（由 extraResources 复制）
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  try {
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) {
      console.warn('[Dock Icon] 图标文件未找到:', iconPath)
    } else {
      app.dock.setIcon(img)
      console.log('[Dock Icon] 已设置图标:', iconPath)
    }
  } catch (e) {
    console.warn('[Dock Icon] 设置失败:', e)
  }

  createAndInitWindow()

  // 启动恢复：检查上次是否有异常退出（遗留快照文件）
  // 如果存在快照，说明上次退出时代理未被正常恢复，尝试自动恢复
  if (hasPendingSnapshot()) {
    console.log('[Main] 检测到遗留的系统代理快照，正在尝试恢复...')
    clearSystemProxy()
      .then((result) => {
        if (result.success) {
          console.log('[Main] 启动恢复成功:', result.message)
        } else {
          console.warn('[Main] 启动恢复失败:', result.message)
        }
      })
      .catch((e) => console.error('[Main] 启动恢复异常:', e))
  }

  // macOS: 点击 dock 图标时显示窗口（窗口隐藏后再次打开）
  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
    } else {
      createAndInitWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // macOS: 关闭窗口时不退出应用
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * 应用退出前的异步清理
 * 1. 停止 MITM 代理服务器（stopProxy）
 * 2. 恢复系统代理（clearSystemProxy，需要 sudo，可能需要用户输入密码）
 * 3. 执行同步清理（证书服务、数据库、全局快捷键）
 * 4. 强制退出应用
 *
 * 设计要点：
 * - 超时保护：10 秒后强制退出，避免 sudo 弹窗卡住退出流程
 * - 错误容错：每步独立 try/catch，即使某步失败也继续后续清理
 * - 防止重复触发：由 isCleaningUp 标志在 before-quit 中守卫
 */
async function cleanupBeforeQuit(): Promise<void> {
  // 超时保护：10 秒后强制退出（clearSystemProxy 的 sudo 弹窗可能需要用户输入密码）
  const TIMEOUT_MS = 10000
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.warn('[Main] 退出清理超时（10s），强制退出')
      resolve()
    }, TIMEOUT_MS)
  })

  const cleanupPromise = (async () => {
    // 1. 停止 MITM 代理服务器
    try {
      await stopProxy()
      console.log('[Main] MITM 代理服务器已停止')
    } catch (e) {
      console.error('[Main] 停止 MITM 代理失败:', e)
    }

    // 2. 恢复系统代理（读取快照还原原始设置，需要 sudo）
    try {
      const result = await clearSystemProxy()
      if (result.success) {
        console.log('[Main] 系统代理已恢复:', result.message)
      } else {
        console.warn('[Main] 恢复系统代理失败:', result.message)
      }
    } catch (e) {
      console.error('[Main] 恢复系统代理异常:', e)
    }

    // 3. 同步清理（容错：即使前面失败也要执行）
    try {
      stopCertServer()
    } catch (e) {
      console.error('[Main] 停止证书服务失败:', e)
    }
    try {
      closeDatabase()
    } catch (e) {
      console.error('[Main] 关闭数据库失败:', e)
    }
    try {
      globalShortcut.unregisterAll()
    } catch (e) {
      console.error('[Main] 注销全局快捷键失败:', e)
    }

    // 4. 停止 SSE 服务器
    try {
      stopSSEServer()
    } catch (e) {
      console.error('[Main] 停止 SSE 服务器失败:', e)
    }
  })()

  // 等待清理完成或超时，取先到达者
  await Promise.race([cleanupPromise, timeoutPromise])

  // app.exit() 不会再次触发 before-quit，可安全调用
  app.exit(0)
}

app.on('before-quit', (event) => {
  isQuitting = true

  // 防止 before-quit 被重复触发（用户多次 Cmd+Q 等）
  if (isCleaningUp) {
    event.preventDefault()
    return
  }
  isCleaningUp = true

  // 阻止默认退出，等异步清理（stopProxy + clearSystemProxy）完成后再退出
  event.preventDefault()

  // 启动异步清理（不 await，before-quit 处理器本身是同步的）
  cleanupBeforeQuit()
})

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
})
