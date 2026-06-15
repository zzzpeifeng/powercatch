/**
 * 证书下载 HTTP 服务
 * 提供 CA 证书的下载页面，方便平板设备安装
 */
import http from 'http'
import { getCACert } from './ca-cert'

let certServer: http.Server | null = null
let certServerPort: number = 0

/**
 * 启动证书下载服务
 * @param port 服务端口（默认 8889）
 * @returns 服务端口
 */
export function startCertServer(port: number = 8889): Promise<number> {
  return new Promise((resolve, reject) => {
    if (certServer) {
      resolve(certServerPort)
      return
    }

    certServer = http.createServer((req, res) => {
      const cert = getCACert()

      if (!cert) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('CA 证书尚未生成，请先在设置页面生成证书。')
        return
      }

      // 证书下载页面
      if (req.url === '/' || req.url === '/cert') {
        const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>安装 CA 证书 - PowerCatch</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin: 16px 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { font-size: 20px; color: #1a1a1a; }
    h2 { font-size: 16px; color: #555; margin-top: 20px; }
    .step {
      display: flex;
      align-items: flex-start;
      margin: 12px 0;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .step-num {
      background: #3b82f6;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .download-btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: #3b82f6;
      color: white;
      text-align: center;
      border-radius: 8px;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
      margin: 20px 0;
    }
    .download-btn:hover { background: #2563eb; }
    .platform-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .tab {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #ddd;
      cursor: pointer;
      background: white;
    }
    .tab.active { background: #3b82f6; color: white; border-color: #3b82f6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔒 安装 CA 证书</h1>
    <p>安装此证书后，抓包工具可以解密 HTTPS 流量。</p>

    <a href="/download-cert" class="download-btn">📥 下载 CA 证书</a>

    <div class="platform-tabs">
      <div class="tab active" onclick="showAndroid()">Android</div>
      <div class="tab" onclick="showIOS()">iOS</div>
    </div>

    <div id="android-steps">
      <h2>Android 安装步骤</h2>
      <div class="step"><span class="step-num">1</span><span>点击上方按钮下载 CA 证书文件</span></div>
      <div class="step"><span class="step-num">2</span><span>进入 设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书</span></div>
      <div class="step"><span class="step-num">3</span><span>选择下载的 NodeMITMProxyCA.pem 文件并安装</span></div>
      <div class="step"><span class="step-num">4</span><span>配置 Wi-Fi 代理：服务器 = 本机 IP，端口 = 8888</span></div>
    </div>

    <div id="ios-steps" style="display:none">
      <h2>iOS 安装步骤</h2>
      <div class="step"><span class="step-num">1</span><span>点击上方按钮下载 CA 证书</span></div>
      <div class="step"><span class="step-num">2</span><span>进入 设置 → 已下载的描述文件 → 安装证书</span></div>
      <div class="step"><span class="step-num">3</span><span>进入 设置 → 通用 → 关于本机 → 证书信任设置 → 启用信任</span></div>
      <div class="step"><span class="step-num">4</span><span>配置 Wi-Fi 代理：服务器 = 本机 IP，端口 = 8888</span></div>
    </div>
  </div>

  <script>
    function showAndroid() {
      document.getElementById('android-steps').style.display = 'block';
      document.getElementById('ios-steps').style.display = 'none';
      document.querySelectorAll('.tab')[0].classList.add('active');
      document.querySelectorAll('.tab')[1].classList.remove('active');
    }
    function showIOS() {
      document.getElementById('android-steps').style.display = 'none';
      document.getElementById('ios-steps').style.display = 'block';
      document.querySelectorAll('.tab')[0].classList.remove('active');
      document.querySelectorAll('.tab')[1].classList.add('active');
    }
  </script>
</body>
</html>`
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }

      // 证书文件下载
      if (req.url === '/download-cert') {
        res.writeHead(200, {
          'Content-Type': 'application/x-pem-file',
          'Content-Disposition': 'attachment; filename="NodeMITMProxyCA.pem"',
          'Content-Length': Buffer.byteLength(cert),
        })
        res.end(cert)
        return
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    })

    certServer.listen(port, '0.0.0.0', () => {
      certServerPort = port
      resolve(port)
    })

    certServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // 端口被占用，尝试下一个端口
        certServer?.close()
        certServer = null
        startCertServer(port + 1).then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })
  })
}

/**
 * 停止证书下载服务
 */
export function stopCertServer(): void {
  if (certServer) {
    certServer.close()
    certServer = null
    certServerPort = 0
  }
}

/**
 * 获取证书服务端口
 */
export function getCertServerPort(): number {
  return certServerPort
}
