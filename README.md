# 🐰 Packet Capture App

一款基于 Electron 的 HTTP 抓包调试工具，类似 Charles/Fiddler，支持 HTTP/HTTPS 流量拦截、查看、AI 对比分析。

## ✨ 功能特性

- 🔍 **HTTP/HTTPS 抓包** — 基于 MITM 代理，支持全量流量拦截
- 📱 **移动端抓包** — 支持 WiFi 代理配置，手机连上即可抓包
- 🤖 **AI 对比分析** — 接入 AI 模型，对请求/响应进行智能对比分析
- 🎨 **主题切换** — 支持浅色/深色/跟随系统三种主题
- 📤 **导出功能** — 支持将抓包记录导出为文件
- 🔐 **HTTPS 解密** — 自动生成根证书，解密 HTTPS 流量

## 🛠️ 技术栈

- **框架**: Electron + Vue 3 + Vite
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **代理**: http-mitm-proxy
- **存储**: electron-store + SQLite

## 📦 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/packet-capture-app.git
cd packet-capture-app

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建安装包
npm run build
```

## 🚀 开发

```bash
# 启动开发服务器
npm run dev

# 类型检查
npm run type-check

# 构建
npm run build
```

## ⚙️ 配置

1. 复制环境变量示例文件：
   ```bash
   cp .env.example .env
   ```

2. 在设置页面配置代理端口、AI 模型等参数。

## 📄 License

MIT
