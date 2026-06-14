/**
 * 配置服务器模块
 * 启动本地 HTTP 服务器，用于分发 .mobileconfig 描述文件
 */
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let server: any = null
let serverPort = 3000
let serverUrl = ''

/**
 * 启动配置服务器
 * @param port 监听端口
 * @returns 服务器 URL
 */
export function startConfigServer(port: number = 3000): string {
  if (server) {
    stopConfigServer()
  }

  serverPort = port
  const localIp = getLocalIP()

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/'

    // CORS 支持
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    // 路由处理
    if (url === '/' || url === '/index.html') {
      // 返回配置页面
      const html = generateConfigPage(localIp, port)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    // 下载 .mobileconfig 文件
    if (url.startsWith('/config/')) {
      const fileName = url.replace('/config/', '').split('?')[0]
      const userDataPath = app.getPath('userData')
      const filePath = join(userDataPath, fileName)

      if (existsSync(filePath)) {
        const fileContent = readFileSync(filePath)
        res.writeHead(200, {
          'Content-Type': 'application/x-apple-aspen-config',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        })
        res.end(fileContent)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('File not found')
      }
      return
    }

    // 生成 QR 码内容（标准 WiFi QR）
    if (url.startsWith('/wifi-qr/')) {
      const params = new URL(`http://localhost${url}`).searchParams
      const ssid = params.get('ssid') || ''
      const password = params.get('password') || ''
      const encryption = params.get('encryption') || 'WPA'
      
      const qrContent = `WIFI:T:${encryption};S:${ssid};P:${password};;`
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(qrContent)
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`[ConfigServer] 启动成功，监听端口 ${port}`)
  })

  serverUrl = `http://${localIp}:${port}`
  return serverUrl
}

/**
 * 停止配置服务器
 */
export function stopConfigServer(): void {
  if (server) {
    server.close()
    server = null
    console.log('[ConfigServer] 已停止')
  }
}

/**
 * 获取服务器 URL
 */
export function getConfigServerUrl(): string {
  return serverUrl
}

/**
 * 获取本机 IP 地址
 */
function getLocalIP(): string {
  const { networkInterfaces } = require('os')
  const nets = networkInterfaces()
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // 跳过内部 IP 和非 IPv4 地址
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
    
  return '127.0.0.1'
}

/**
 * 生成配置页面 HTML
 * 包含 iOS 和 Android 的配置指引
 */
function generateConfigPage(localIp: string, port: number): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WiFi 自动配置</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f7; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin-bottom: 10px; color: #1d1d1f; }
    .subtitle { color: #86868b; margin-bottom: 30px; font-size: 14px; }
    .section { margin-bottom: 30px; }
    .section-title { font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #1d1d1f; }
    .platform-tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab { flex: 1; padding: 12px; border: 2px solid #e5e5ea; border-radius: 8px; text-align: center; cursor: pointer; transition: all 0.2s; }
    .tab.active { border-color: #0071e3; background: #f5f5ff; }
    .tab-title { font-weight: 600; margin-bottom: 5px; }
    .tab-desc { font-size: 12px; color: #86868b; }
    .step { display: flex; gap: 15px; margin-bottom: 20px; }
    .step-number { width: 32px; height: 32px; background: #0071e3; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-content { flex: 1; }
    .step-title { font-weight: 600; margin-bottom: 5px; }
    .step-desc { font-size: 14px; color: #515154; line-height: 1.5; }
    .ios-steps { display: block; }
    .android-steps { display: none; }
    .show-android .ios-steps { display: none; }
    .show-android .android-steps { display: block; }
    .note { background: #fff9e6; border-left: 4px solid #ffcc02; padding: 15px; border-radius: 8px; margin-top: 20px; }
    .note-title { font-weight: 600; margin-bottom: 8px; color: #333; }
    .note-text { font-size: 14px; color: #666; line-height: 1.5; }
    .btn { display: inline-block; padding: 12px 24px; background: #0071e3; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 15px; }
    .btn:hover { background: #0077ed; }
  </style>
  <script>
    function switchTab(platform) {
      document.body.classList.remove('show-ios', 'show-android');
      document.body.classList.add('show-' + platform);
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + platform).classList.add('active');
    }
  </script>
</head>
<body>
  <div class="container">
    <h1>📶 WiFi 自动配置</h1>
    <p class="subtitle">扫描二维码或访问此页面，自动配置手机 WiFi 和代理</p>
    
    <div class="platform-tabs">
      <div id="tab-ios" class="tab active" onclick="switchTab('ios')">
        <div class="tab-title">🍎 iOS</div>
        <div class="tab-desc">自动配置 WiFi + 代理</div>
      </div>
      <div id="tab-android" class="tab" onclick="switchTab('android')">
        <div class="tab-title">🤖 Android</div>
        <div class="tab-desc">仅配置 WiFi</div>
      </div>
    </div>
    
    <div class="section ios-steps">
      <div class="section-title">iOS 设备配置步骤</div>
      
      <div class="step">
        <div class="step-number">1</div>
        <div class="step-content">
          <div class="step-title">扫描二维码</div>
          <div class="step-desc">使用 iPhone 相机或微信扫描电脑上的二维码</div>
        </div>
      </div>
      
      <div class="step">
        <div class="step-number">2</div>
        <div class="step-content">
          <div class="step-title">打开描述文件</div>
          <div class="step-desc">扫码后会跳转到 Safari，提示"此网站正在尝试下载配置配置文件"</div>
        </div>
      </div>
      
      <div class="step">
        <div class="step-number">3</div>
        <div class="step-content">
          <div class="step-title">安装描述文件</div>
          <div class="step-desc">前往"设置" → "已下载的描述文件" → 点击"安装"</div>
        </div>
      </div>
      
      <div class="step">
        <div class="step-number">4</div>
        <div class="step-content">
          <div class="step-title">完成</div>
          <div class="step-desc">WiFi 会自动连接，代理已设置为 ${localIp}:${port}</div>
        </div>
      </div>
      
      <a href="/config/wifi-config.mobileconfig" class="btn">点击下载描述文件</a>
    </div>
    
    <div class="section android-steps">
      <div class="section-title">Android 设备配置步骤</div>
      
      <div class="step">
        <div class="step-number">1</div>
        <div class="step-content">
          <div class="step-title">扫描 WiFi QR 码</div>
          <div class="step-desc">使用 Android 手机相机扫描标准 WiFi QR 码（会在电脑上显示）</div>
        </div>
      </div>
      
      <div class="step">
        <div class="step-number">2</div>
        <div class="step-content">
          <div class="step-title">连接 WiFi</div>
          <div class="step-desc">Android 10+ 会自动识别 QR 码并连接 WiFi</div>
        </div>
      </div>
      
      <div class="step">
        <div class="step-number">3</div>
        <div class="step-content">
          <div class="step-title">手动设置代理</div>
          <div class="step-desc">
            前往"设置" → "WLAN" → 点击已连接的 WiFi → "代理" → 设置为"手动"<br>
            - 代理服务器主机名: ${localIp}<br>
            - 代理服务器端口: ${port}
          </div>
        </div>
      </div>
    </div>
    
    <div class="note">
      <div class="note-title">⚠️ 注意事项</div>
      <div class="note-text">
        <p>1. iOS 设备需要安装描述文件才能自动配置代理</p>
        <p>2. Android 设备目前无法自动配置代理，需手动设置</p>
        <p>3. 确保手机和电脑在同一局域网内</p>
      </div>
    </div>
  </div>
</body>
</html>`
}
