# 一键配置本机代理 — 实施计划

> **目标**：在设置页面新增「一键配置本机代理」功能，macOS 用户可通过按钮一键开启/关闭系统代理，并自动还原前状态。
>
> **创建时间**：2026-06-16
> **平台范围**：macOS（代码预留跨平台扩展点）

---

## 1. 背景与目标

### 1.1 当前痛点

用户现在要抓包，需要手动操作：

1. 打开「系统设置 → 网络 → 当前网卡 → 代理」
2. 手动开启「网页代理(HTTP)」和「安全网页代理(HTTPS)」
3. 填入 `127.0.0.1` 和抓包端口（默认 8888）
4. 停止抓包后，再手动回去关闭

**问题**：步骤繁琐、容易忘记还原、多个网卡要分别设置。

### 1.2 功能目标

在「设置 → 基本设置」Tab 中新增一个卡片区域：

- **开启代理**按钮：自动将所有活跃网卡的 HTTP/HTTPS 代理设为 `127.0.0.1:PORT`，并记住原始状态
- **关闭代理**按钮：将代理恢复为开启前的原始状态
- 状态指示：显示当前系统代理是否已指向本应用
- 端口联动：代理端口与「代理端口」设置项联动，修改后实时生效

---

## 2. 用户故事

| # | 角色 | 故事 |
|---|------|------|
| US1 | macOS 用户 | 点击「开启代理」，所有活跃网卡的网页代理和安全网页代理自动设为 `127.0.0.1:8888`，无需手动操作 |
| US2 | macOS 用户 | 点击「关闭代理」，系统代理恢复为开启前的原始状态，不会残留配置 |
| US3 | macOS 用户 | 在设置中修改代理端口后，点击「开启代理」使用新端口；若代理已开启，端口修改后自动更新系统代理 |
| US4 | macOS 用户 | 能看到当前系统代理状态（已开启/已关闭/异常），避免状态不一致 |
| US5 | 开发者 | 未来可以低成本扩展 Windows 平台（注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`） |

---

## 3. 技术方案

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    SettingsView.vue                 │
│  [开启代理] [关闭代理]  状态：已开启(127.0.0.1:8888) │
└──────────┬──────────────────────────┬──────────────┘
           │ IPC invoke               │ 状态查询
           ▼                          ▼
┌──────────────────────┐   ┌────────────────────────┐
│     ipc.ts           │   │   settings-store.ts    │
│  (前端 IPC 封装)    │   │  (代理状态响应式缓存)  │
└──────────┬──────────┘   └──────────┬─────────────┘
           │ ipcRenderer.invoke
           ▼
┌──────────────────────┐
│     preload.ts        │  (上下文桥接，暴露新 API)
└──────────┬──────────┘
           │ ipcMain.handle
           ▼
┌─────────────────────────────────────────────────────┐
│                  electron/ipc.ts                   │
│        新增 handler: proxy.setSystemProxy           │
│                     proxy.getSystemProxyStatus       │
│                     proxy.clearSystemProxy           │
└──────────┬────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│              electron/proxy/system-proxy.ts          │
│           (新增文件 — 核心逻辑)                     │
│  setProxy(port): 读取原始状态 → 执行 networksetup  │
│  clearProxy(): 读取保存的原始状态 → 执行 networksetup │
│  getStatus(): 执行 scutil --proxy 查询当前状态      │
└─────────────────────────────────────────────────────┘
```

### 3.2 核心模块：`system-proxy.ts`

#### 3.2.1 接口设计

```typescript
// electron/proxy/system-proxy.ts

export interface NetworkService {
  name: string      // 如 "Wi-Fi", "Ethernet", "USB 10/100/1000 LAN"
  device: string    // 如 "en0", "en1"
  isActive: boolean // 是否处于活跃状态（已连接）
}

export interface ProxyState {
  http?: { host: string; port: number }
  https?: { host: string; port: number }
  // 未来可扩展 SOCKS, FTP 等
}

export interface SystemProxySnapshot {
  services: NetworkService[]
  proxies: Record<string, ProxyState>  // key = service.name
  savedAt: number  // Date.now()
}

export interface ProxyOperationResult {
  success: boolean
  message: string
  details?: string[]
}
```

#### 3.2.2 关键函数

| 函数 | 功能 | 实现方式 |
|------|------|----------|
| `getActiveNetworkServices()` | 获取所有活跃网卡 | `networksetup -listallnetworkservices | tail -n +2`（过滤 `*` 开头的非活跃项） |
| `getProxyState(serviceName)` | 读取某网卡的当前代理状态 | `scutil --proxy` → 解析 `HTTPProxy`/`HTTPSProxy`/`HTTPPort`/`HTTPSPort` |
| `saveProxySnapshot()` | 保存当前所有网卡代理状态到文件 | 写入 `~/Library/Application Support/powercatch/system-proxy-snapshot.json` |
| `loadProxySnapshot()` | 读取已保存的快照 | 从 `system-proxy-snapshot.json` 读取 |
| `setSystemProxy(port)` | 开启系统代理 | 1. `saveProxySnapshot()` 2. 遍历活跃网卡，`networksetup -setwebproxy` + `-setsecurewebproxy` |
| `clearSystemProxy()` | 关闭系统代理（还原） | 1. `loadProxySnapshot()` 2. 遍历快照，`networksetup -setwebproxystate off` 或还原原始 host:port |
| `getSystemProxyStatus(port)` | 查询当前代理是否已指向本应用 | `scutil --proxy` 检查所有活跃网卡的 HTTP/HTTPS 代理 |

#### 3.2.3 网络命令详解

**读取当前代理状态**：
```bash
# 方式一：scutil --proxy（推荐，输出结构化）
scutil --proxy
# 输出示例：
# <dictionary> {
#   HTTPProxy : 127.0.0.1
#   HTTPPort : 8888
#   HTTPEnabled : YES
#   HTTPSProxy : 127.0.0.1
#   HTTPSPort : 8888
#   HTTPSEnabled : YES
# }

# 方式二：networksetup（按网卡查询）
networksetup -getwebproxy Wi-Fi
networksetup -getsecurewebproxy Wi-Fi
```

**设置代理**：
```bash
# 设置 HTTP 代理
sudo networksetup -setwebproxy Wi-Fi 127.0.0.1 8888
sudo networksetup -setwebproxystate Wi-Fi on

# 设置 HTTPS 代理
sudo networksetup -setsecurewebproxy Wi-Fi 127.0.0.1 8888
sudo networksetup -setsecurewebproxystate Wi-Fi on
```

**关闭代理**：
```bash
# 方式一：直接关闭（不还原原始值）
sudo networksetup -setwebproxystate Wi-Fi off
sudo networksetup -setsecurewebproxystate Wi-Fi off

# 方式二：还原原始值（我们的方案）
# 从快照读取原始 host:port，用 -setwebproxy 写回去
# 若原始状态是 off，则 -setwebproxystate off
```

#### 3.2.4 权限方案

`networksetup` 修改系统代理**需要 sudo 权限**。

**方案：使用 `sudo-prompt`**

```bash
npm install sudo-prompt
```

- 首次点击「开启代理」时，macOS 弹出系统授权框（和安装软件时一样）
- 用户输入密码后，操作执行
- macOS 会记住授权一段时间，后续操作不再弹框
- 比要求用户手动 `sudo` 友好得多

**`sudo-prompt` 调用示例**：

```typescript
import sudo from 'sudo-prompt'

function runWithSudo(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      name: 'PowerCatch',
      icns: '/Applications/PowerCatch.app/Contents/Resources/icon.icns', // 可选
    }
    sudo.exec(command, options, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}
```

> ⚠️ `sudo-prompt` 在 Electron 主进程中使用，不在渲染进程中。

#### 3.2.5 快照文件格式

路径：`~/Library/Application Support/powercatch/system-proxy-snapshot.json`

```json
{
  "version": 1,
  "savedAt": 1718544000000,
  "services": [
    { "name": "Wi-Fi", "device": "en0", "isActive": true },
    { "name": "Ethernet", "device": "en1", "isActive": false }
  ],
  "proxies": {
    "Wi-Fi": {
      "http": { "host": "", "port": 0, "enabled": false },
      "https": { "host": "", "port": 0, "enabled": false }
    }
  }
}
```

- 每次「开启代理」前保存快照
- 「关闭代理」时读取快照并还原
- 若快照不存在（如用户手动删了），则直接关闭代理（降级处理）

---

### 3.3 前端集成

#### 3.3.1 新增 IPC 通道

在 `src/services/types.ts` 的 `IPCChannels` 中新增：

```typescript
proxy: {
  // ... 现有方法
  setSystemProxy: (port: number) => Promise<ProxyOperationResult>
  clearSystemProxy: () => Promise<ProxyOperationResult>
  getSystemProxyStatus: (port: number) => Promise<{
    isActive: boolean
    details: { serviceName: string; http: string; https: string }[]
  }>
}
```

#### 3.3.2 设置页面 UI 设计

在「基本设置」Tab 的「代理配置」卡片中，**在代理端口设置下方**新增：

```
┌─────────────────────────────────────────────┐
│ 代理配置                                   │
├─────────────────────────────────────────────┤
│ 代理端口       [8888        ]              │
├─────────────────────────────────────────────┤
│ 本机代理设置                                │
│                                             │
│ 状态：● 已开启 (127.0.0.1:8888)         │
│ 活跃网卡：Wi-Fi ✓  Ethernet ✗            │
│                                             │
│ [🟢 开启本机代理]  [🔴 关闭本机代理]    │
│                                             │
│ ⚠️ 开启本机代理需要输入系统密码             │
│ 代理将自动配置所有活跃网络接口               │
└─────────────────────────────────────────────┘
```

**状态指示逻辑**：

| 系统状态 | 显示 |
|----------|------|
| 所有活跃网卡的 HTTP/HTTPS 代理都指向 `127.0.0.1:PORT` | ● 已开启 (`127.0.0.1:PORT`) |
| 所有活跃网卡代理都已关闭 | ○ 已关闭 |
| 部分网卡开启、部分关闭（状态不一致） | ⚠️ 状态异常，建议重新开启 |

#### 3.3.3 响应式状态刷新

- 打开设置页时，自动调用 `getSystemProxyStatus()` 刷新状态
- 开启/关闭代理后，刷新状态
- 可考虑用 `setInterval` 每 3 秒轮询一次（低开销）

---

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron/proxy/system-proxy.ts` | **新增** | 核心逻辑：set/clear/getStatus + 快照读写 |
| `electron/ipc.ts` | 修改 | 新增 3 个 IPC handler，调用 system-proxy |
| `electron/preload.ts` | 修改 | 在 `ipcChannels` 中暴露新方法给渲染进程 |
| `src/services/types.ts` | 修改 | `IPCChannels.proxy` 新增 3 个方法类型 |
| `src/services/ipc.ts` | 修改 | 实现 3 个新方法（调用 ipcRenderer.invoke） |
| `src/views/SettingsView.vue` | 修改 | 新增「本机代理设置」UI 区块 |
| `src/stores/settings-store.ts` | 修改（可选） | 缓存代理状态，减少 IPC 调用 |
| `package.json` | 修改 | 新增 `sudo-prompt` 依赖 |

---

## 5. 实施步骤（有序）

### 步骤 1：创建 `system-proxy.ts`（Electron 主进程）

- [ ] 定义接口（`NetworkService`, `ProxyState`, `SystemProxySnapshot`）
- [ ] 实现 `getActiveNetworkServices()` — 解析 `networksetup -listallnetworkservices`
- [ ] 实现 `getProxyState(serviceName)` — 解析 `scutil --proxy` 输出
- [ ] 实现 `saveProxySnapshot(snapshot)` — 写入 JSON 文件
- [ ] 实现 `loadProxySnapshot()` — 读取 JSON 文件
- [ ] 实现 `setSystemProxy(port)` — 保存快照 + 执行 `networksetup` 设置代理
- [ ] 实现 `clearSystemProxy()` — 读取快照 + 执行 `networksetup` 还原代理
- [ ] 实现 `getSystemProxyStatus(port)` — 检查当前代理状态
- [ ] 单元测试（mock `exec` 调用）

### 步骤 2：注册 IPC Handler

- [ ] 在 `electron/ipc.ts` 中引入 `system-proxy.ts`
- [ ] 注册 `IPC_CHANNELS.PROXY_SET_SYSTEM_PROXY` handler
- [ ] 注册 `IPC_CHANNELS.PROXY_CLEAR_SYSTEM_PROXY` handler
- [ ] 注册 `IPC_CHANNELS.PROXY_GET_SYSTEM_PROXY_STATUS` handler

### 步骤 3：更新 Preload 桥接

- [ ] 在 `electron/preload.ts` 的 `ipcChannels` 中新增 3 个方法的实现
- [ ] 确保上下文隔离正确（`ipcRenderer.invoke`）

### 步骤 4：更新前端类型与 IPC 封装

- [ ] `src/services/types.ts` 新增方法签名
- [ ] `src/services/ipc.ts` 新增 3 个方法实现

### 步骤 5：设置页面 UI

- [ ] 在 `SettingsView.vue` 的「代理配置」卡片中新增 UI
- [ ] 实现开启/关闭按钮逻辑
- [ ] 实现状态指示（颜色 + 文字）
- [ ] 实现加载状态（按钮 disabled + spinner）
- [ ] 实现错误提示（Toast）

### 步骤 6：联调测试

- [ ] 功能测试：开启 → 检查系统设置中的代理 → 关闭 → 检查是否还原
- [ ] 快照测试：开启后手动修改某个网卡代理 → 关闭 → 验证是否还原到快照值
- [ ] 多网卡测试：USB 网卡 + Wi-Fi 同时活跃，验证两者都被设置
- [ ] 端口联动测试：修改代理端口 → 重新开启 → 验证使用新端口
- [ ] 异常处理测试：`sudo` 取消授权 → 快照文件损坏 → 网卡名称含空格

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 点击「开启代理」，所有活跃网卡的 HTTP 和 HTTPS 代理被设为 `127.0.0.1:PORT`
- [ ] 点击「关闭代理」，所有网卡代理还原为开启前的状态
- [ ] 开启代理后，设置页状态指示器显示「已开启」
- [ ] 手动在系统设置中关闭代理后，设置页状态指示器在 3 秒内更新为「已关闭」
- [ ] 修改代理端口后重新开启，使用新端口（不需要重启应用）
- [ ] 首次开启时弹出系统授权框，后续操作不再弹出（macOS 记住授权）

### 6.2 异常验收

- [ ] 用户取消 sudo 授权 → 显示友好错误提示，不崩溃
- [ ] 快照文件不存在 → 降级为直接关闭代理，并显示提示
- [ ] 网卡名称含空格（如 `USB 10/100/1000 LAN`）→ 命令参数正确引用，不报错
- [ ] 端口号为空/非法 → 按钮禁用，提示用户输入有效端口

### 6.3 代码质量

- [ ] `system-proxy.ts` 有完整 TypeScript 类型
- [ ] 核心函数有单元测试（mock child_process.exec）
- [ ] `sudo-prompt` 调用在主进程，不在渲染进程
- [ ] 代码符合项目现有规范（ESLint 通过）

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `sudo-prompt` 在 macOS 上弹框体验不佳 | 用户体验 | 首次操作后 macOS 会记住授权；文档中说明 |
| 多网卡环境，某个网卡设置失败 | 部分流量不走代理 | 逐个网卡执行，收集失败列表，最后统一提示用户 |
| 快照文件被手动删除/篡改 | 关闭时无法还原 | `loadProxySnapshot()` 返回 null 时降级为直接关闭；提示用户 |
| macOS 版本差异导致 `networksetup` 输出格式变化 | 解析失败 | 使用正则匹配关键字段，不过度依赖格式；加 try/catch |
| 未来扩展 Windows 时逻辑差异大 | 维护成本 | 用 `interface SystemProxyStrategy` + `process.platform` 分支，隔离平台差异 |

---

## 8. 未来扩展（保留设计空间）

### 8.1 Windows 平台

Windows 代理设置存储在注册表：

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
  ProxyEnable (REG_DWORD): 0 或 1
  ProxyServer (REG_SZ): "127.0.0.1:8888"
  ProxyOverride (REG_SZ): 绕过地址列表
```

实现方式：新增 `WinSystemProxyStrategy` 实现 `SystemProxyStrategy` 接口，使用 `reg query` / `reg add` 命令。

### 8.2 自动检测代理状态变化

当前方案是轮询（每 3 秒）。未来可优化为：

- 监听 macOS `configd` 的分布式通知（`CFNotification`）
- 或用 `kqueue` 监听 `/Library/Preferences/SystemConfiguration/preferences.plist` 的变化

---

## 9. 附录：关键命令参考

```bash
# 列出所有网络服务（含非活跃）
networksetup -listallnetworkservices

# 列出活跃服务（带 * 的是非活跃）
networksetup -listallnetworkservices | tail -n +2 | grep -v " *.*"

# 获取 HTTP 代理
networksetup -getwebproxy "Wi-Fi"

# 获取 HTTPS 代理
networksetup -getsecurewebproxy "Wi-Fi"

# 设置 HTTP 代理
sudo networksetup -setwebproxy "Wi-Fi" 127.0.0.1 8888

# 设置 HTTPS 代理
sudo networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 8888

# 关闭 HTTP 代理
sudo networksetup -setwebproxystate "Wi-Fi" off

# 关闭 HTTPS 代理
sudo networksetup -setsecurewebproxystate "Wi-Fi" off

# 查询当前代理状态（系统全局）
scutil --proxy
```

---

*Plan 版本：v1.0 | 最后更新：2026-06-16*
