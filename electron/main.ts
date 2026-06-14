/**
 * Electron 主进程入口
 * 负责窗口管理、IPC 注册、服务初始化
 */
import { app, BrowserWindow, Menu, nativeImage, nativeTheme } from 'electron'
import { join } from 'path'
import { initDatabase, closeDatabase, getAllSettings, saveAllSettings } from './db/sqlite'
import { registerIpcHandlers } from './ipc'
import { setDomainFilters, setDeviceAliases, getLocalIP } from './proxy/mitm-server'
import { startCertServer, stopCertServer } from './proxy/cert-server'
import { preGenerateCA, cleanupOldCACerts } from './proxy/ca-cert'

let mainWindow: BrowserWindow | null = null

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
function createAndInitWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '抓包对比工具 v1.0',
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

  // 注册 IPC 处理器（在页面加载之前，避免渲染进程调用时 handler 未就绪）
  registerIpcHandlers(mainWindow)

  // 初始化数据库
  initDatabase()

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

  mainWindow.on('closed', () => {
    mainWindow = null
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

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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

app.on('before-quit', () => {
  // 清理资源
  stopCertServer()
  closeDatabase()
})

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
})
