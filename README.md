# 🐰 PowerCatch

一款基于 Electron 的 HTTP/HTTPS 抓包调试工具，类似 Charles/Fiddler，支持流量拦截、查看、AI 智能对比分析。

## ✨ 功能特性

- 🔍 **HTTP/HTTPS 抓包** — 基于 MITM 代理，支持全量流量拦截与解密
- 📱 **移动端抓包** — 支持 WiFi 代理配置，手机连接同一网络即可抓包
- 🤖 **AI 对比分析** — 接入 OpenAI 兼容接口，对请求/响应进行智能对比分析
- 🎨 **主题切换** — 支持浅色/深色/跟随系统三种主题，即时生效
- 📋 **请求详情** — 请求头/请求体/响应头/响应体分 Tab 展示，支持 JSON 高亮
- 📤 **导出功能** — 支持将抓包记录导出为文件
- 🔐 **HTTPS 解密** — 自动生成根证书，一键安装即可解密 HTTPS 流量
- 📊 **Markdown 渲染** — AI 对比结果支持完整 Markdown 渲染（表格、代码块、列表等）
- 🗑️ **数据管理** — 支持按域名过滤、清空抓包记录

## 🛠️ 技术栈

- **框架**: Electron 28 + Vue 3 + Vite 5
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **状态管理**: Pinia
- **代理引擎**: http-mitm-proxy
- **数据存储**: better-sqlite3 (SQLite)
- **Markdown**: markdown-it + DOMPurify
- **代码高亮**: Shiki / highlight.js
- **其他**: canvas、qrcode、selfsigned、sudo-prompt

## 📦 安装

### 方式一：下载安装包（推荐）

前往 [Releases](https://github.com/zzzpeifeng/powercatch/releases) 页面下载对应平台的安装包：

- **macOS**: 下载 `.dmg` 文件，打开后拖拽到「应用程序」文件夹

### 方式二：从源码构建

```bash
# 克隆仓库
git clone https://github.com/zzzpeifeng/powercatch.git
cd powercatch

# 安装依赖
npm install

# 开发模式（热更新）
npm run electron:dev

# 构建安装包
npm run electron:build
```

> ⚠️ 注意：`electron:build` 需要网络以下载 Electron 二进制文件，如遇下载缓慢可配置镜像：
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> ```

## 🚀 开发

```bash
# 仅启动前端开发服务器（调试 UI）
npm run dev

# 启动完整 Electron 开发模式（热更新）
npm run electron:dev

# 类型检查
npx vue-tsc --noEmit

# 构建前端 + Electron 主进程
npm run build

# 完整打包（构建 + electron-builder）
npm run electron:build
```

### 项目结构

```
powercatch/
├── electron/              # Electron 主进程
│   ├── main.ts           # 入口文件
│   ├── ipc.ts            # IPC 通信处理
│   ├── preload.ts        # 预加载脚本
│   ├── proxy/            # MITM 代理服务
│   └── db/              # SQLite 数据库
├── src/                  # 渲染进程（Vue 3）
│   ├── components/       # 组件
│   ├── views/           # 页面视图
│   ├── stores/          # Pinia 状态管理
│   └── styles/          # 全局样式
├── resources/            # 图标、证书等资源
└── release/             # 构建产物输出目录
```

## ⚙️ 配置

所有配置均在应用内 **设置页面** 完成，无需手动编辑配置文件：

1. 打开应用 → 点击左下角「设置」图标
2. 配置代理端口（默认 `8888`）
3. 配置 AI 模型 API 地址、Key、模型名称
4. 设置域名过滤规则、主题等偏好

配置数据持久化存储在本地，重装应用后需重新配置（或手动迁移 `~/Library/Application Support/PowerCatch/` 目录）。

## 📄 License

MIT License — 详见 [LICENSE](./LICENSE) 文件

## 👤 作者

Peifeng Zhang — [zzzpeifeng@163.com](mailto:zzzpeifeng@163.com)

---

> 💡 如遇问题或有功能建议，欢迎提交 [Issue](https://github.com/zzzpeifeng/powercatch/issues)。
