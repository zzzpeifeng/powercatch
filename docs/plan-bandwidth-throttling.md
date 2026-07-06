# #13 带宽限流 / 网络节流 - 技术方案 Plan v1.2

> **功能**: #13 带宽限流 / 网络节流  
> **状态**: Plan v1.2（已修正 - 评审问题已修复）  
> **工作量评估**: 低（约 1-2 人天）  
> **依赖**: 无  
> **优先级**: P1（中价值 - 弱网测试必备）  
> **评审日期**: 2026-07-05  
> **版本说明**: v1.0 仅实现延迟控制 + 预设场景；v1.1 实现带宽限制 + 丢包模拟  
> **修正记录**:  
> - v1.1 → v1.2：修复离线模式预设、补充 IPC 注册代码、明确 onResponse 延迟位置

---

## 1. 功能定义

### 1.1 核心能力（v1.0 范围）

| 能力 | 说明 | 版本 |
|------|------|------|
| **预设场景** | 一键切换 3G / 4G / 5G / 弱网 / 离线 | v1.0 |
| **延迟控制** | 请求/响应延迟（0-10000ms） | v1.0 |
| **按域名过滤** | 仅对指定域名启用节流 | v1.0 |
| 带宽限制 | 下行/上行带宽限制（kbps） | v1.1 |
| 丢包率 | 模拟网络不稳定（0-50%） | v1.1 |

### 1.2 用户场景（v1.0）

| 场景 | 说明 |
|------|------|
| 移动端弱网测试 | 模拟 3G 网络，验证 App 在弱网下的表现 |
| 接口超时测试 | 设置延迟 > 5000ms，验证前端超时处理逻辑 |
| 请求/响应延迟测试 | 分别控制上行/下行延迟，验证客户端重试逻辑 |

### 1.3 用户场景（v1.1 - 后续版本）

| 场景 | 说明 |
|------|------|
| 大文件下载测试 | 限制带宽至 100kbps，验证进度条和断点续传 |
| 不稳定网络测试 | 设置 10% 丢包率，验证重试逻辑 |

---

## 2. 技术方案（v1.0 - 仅延迟控制）

### 2.1 实现策略

**核心思路**：在 `mitm-server.ts` 的代理层拦截中，对匹配的请求注入延迟。

| 策略 | 实现方式 | 版本 |
|------|----------|------|
| **请求延迟（Request Delay）** | 在 `onRequest` 的 `callback()` 前加 `setTimeout` | v1.0 |
| **响应延迟（Response Delay）** | 在 `onResponse` 中加 `setTimeout` | v1.0 |
| 带宽限制（Bandwidth） | 重写 `onResponseData` 中的 chunk 发送，用 `setInterval` 控制发送速率 | v1.1 |
| 丢包（Packet Loss） | 随机延迟加倍（模拟 TCP 重传） | v1.1 |

### 2.2 配置数据结构

```typescript
// src/services/types.ts

/** 网络节流配置（v1.0） */
export interface ThrottleConfig {
  /** 是否启用节流 */
  enabled: boolean
  /** 预设场景（覆盖手动配置） */
  preset: 'off' | '3g' | '4g' | '5g' | 'slow' | 'offline' | 'custom'
  /** 请求延迟 ms（上行） */
  requestDelay: number
  /** 响应延迟 ms（下行） */
  responseDelay: number
  /** 仅对指定域名生效（空=全部） */
  domainFilter: string[]
}

/** 预设场景配置（v1.0） */
export const THROTTLE_PRESETS: Record<string, Partial<ThrottleConfig>> = {
  off:    { requestDelay: 0, responseDelay: 0 },
  '3g':    { requestDelay: 300, responseDelay: 500 },
  '4g':    { requestDelay: 50, responseDelay: 100 },
  '5g':    { requestDelay: 10, responseDelay: 20 },
  slow:   { requestDelay: 1000, responseDelay: 2000 },
  offline: { requestDelay: 0, responseDelay: 0, offlineMode: true },  // 离线模式：丢弃所有请求
  custom: {},
}
```

### 2.3 代理层集成

**文件**: `electron/proxy/mitm-server.ts`（修改）

```typescript
// 在 mitm-server.ts 顶部添加
import type { ThrottleConfig } from '../../src/services/types'
import { matchDomain } from './utils'  // 复用现有的域名匹配函数

let throttleConfig: ThrottleConfig = {
  enabled: false,
  preset: 'off',
  requestDelay: 0,
  responseDelay: 0,
  domainFilter: [],
}

export function setThrottleConfig(config: ThrottleConfig): void {
  throttleConfig = config
  console.log('[Throttle] Config updated:', config)
}

/** 检查是否对指定请求启用节流 */
function shouldThrottle(host: string): boolean {
  if (!throttleConfig.enabled) return false
  return matchDomain(host, throttleConfig.domainFilter)
}

/** 应用请求延迟（上行） */
function applyRequestDelay(callback: () => void): void {
  const delay = throttleConfig.requestDelay
  if (delay <= 0) return callback()
  setTimeout(callback, delay)
}

/** 应用响应延迟（下行） */
function applyResponseDelay(callback: () => void): void {
  const delay = throttleConfig.responseDelay
  if (delay <= 0) return callback()
  setTimeout(callback, delay)
}
```

**集成点**：

```typescript
// 在 mitm-server.ts 中注册 IPC 处理器（新增）
import { ipcMain } from 'electron'

// 在 initProxy() 函数中或文件底部添加：
export function initThrottleIPC(): void {
  ipcMain.handle('throttle:setConfig', async (event, config: ThrottleConfig) => {
    setThrottleConfig(config)
  })
}

// 在 onRequest 中添加请求延迟
proxy.onRequest(async (ctx, callback) => {
  // ... 现有逻辑 ...
  
  const host = ctx.clientToProxyRequest.headers?.host || ''
  if (shouldThrottle(host)) {
    applyRequestDelay(() => callback())
  } else {
    callback()
  }
})

// 在 onResponse 中添加响应延迟（响应头到达时）
proxy.onResponse(async (ctx, callback) => {
  // ... 现有逻辑 ...
  
  const host = ctx.clientToProxyRequest.headers?.host || ''
  if (shouldThrottle(host)) {
    // 离线模式：直接返回 503
    if (throttleConfig.offlineMode) {
      ctx.proxyToClientResponse.writeHead(503, { 'Content-Type': 'text/plain' })
      ctx.proxyToClientResponse.end('Simulated offline mode')
      return
    }
    
    applyResponseDelay(() => callback())
  } else {
    callback()
  }
})
```

### 2.4 状态管理

**文件**: `src/stores/settings-store.ts`（修改，添加 throttle 相关 ref）

**重要**：当前 `settings-store.ts` 使用的是**独立的 `ref()` 变量**，不是统一的 `Settings` 接口。需要遵循现有模式。

```typescript
// src/stores/settings-store.ts

// 在 defineStore 的 setup 函数中添加：
export const useSettingsStore = defineStore('settings', () => {
  // ... 现有 ref 变量 ...
  
  // ===== 网络节流状态（v1.0） =====
  const throttleEnabled = ref<boolean>(false)
  const throttlePreset = ref<'off' | '3g' | '4g' | '5g' | 'slow' | 'offline' | 'custom'>('off')
  const throttleRequestDelay = ref<number>(0)
  const throttleResponseDelay = ref<number>(0)
  const throttleDomainFilter = ref<string[]>([])
  const throttleOfflineMode = ref<boolean>(false)  // 新增：离线模式标志
  
  // ===== 自动保存：节流配置变更时触发防抖保存 =====
  watch(throttleEnabled, () => {
    if (loaded.value) debouncedSave()
  })
  watch(throttlePreset, () => {
    if (loaded.value) debouncedSave()
  })
  watch(throttleRequestDelay, () => {
    if (loaded.value) debouncedSave()
  })
  watch(throttleResponseDelay, () => {
    if (loaded.value) debouncedSave()
  })
  
  // ===== Actions：同步节流配置到代理层 =====
  async function updateThrottleConfig(): Promise<void> {
    const config: ThrottleConfig = {
      enabled: throttleEnabled.value,
      preset: throttlePreset.value,
      requestDelay: throttleRequestDelay.value,
      responseDelay: throttleResponseDelay.value,
      domainFilter: throttleDomainFilter.value,
      offlineMode: throttleOfflineMode.value,
    }
    await ipc.throttle.setConfig(config)
  }
  
  // 当配置变更时，自动同步到代理层
  watch([throttleEnabled, throttlePreset, throttleRequestDelay, throttleResponseDelay, throttleDomainFilter], 
    () => {
      if (loaded.value) updateThrottleConfig()
    }, 
    { deep: true }
  )
  
  return {
    // ... 现有返回值 ...
    // 节流状态
    throttleEnabled,
    throttlePreset,
    throttleRequestDelay,
    throttleResponseDelay,
    throttleDomainFilter,
    throttleOfflineMode,
    // 节流 Actions
    updateThrottleConfig,
  }
})
```

**IPC 定义**（新增）：

```typescript
// src/services/ipc.ts

export const ipc = {
  // ... 现有命名空间 ...
  
  throttle: {
    setConfig: (config: ThrottleConfig) => 
      ipcInvoke('throttle:setConfig', config),
  },
}
```

```typescript
// electron/preload.ts

contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有 API ...
  
  throttle: {
    setConfig: (config: ThrottleConfig) => 
      ipcRenderer.invoke('throttle:setConfig', config),
  },
})
```

### 2.5 UI 组件（v1.0）

**修改文件**: `src/views/SettingsView.vue`

在设置页添加「网络节流」分区，包含：

| 控件 | 类型 | 说明 | 版本 |
|------|------|------|------|
| 启用开关 | Toggle | 全局启用/禁用节流 | v1.0 |
| 预设场景 | Select | off / 3G / 4G / 5G / 弱网 / 离线 / 自定义 | v1.0 |
| 请求延迟 | Range + Number | 0-10000ms | v1.0 |
| 响应延迟 | Range + Number | 0-10000ms | v1.0 |
| 域名过滤 | TagInput | 仅对指定域名生效 | v1.0 |
| 下行带宽 | Select | 不限制 / 100kbps / 500kbps / 1Mbps / 自定义 | v1.1 |
| 上行带宽 | Select | 不限制 / 100kbps / 500kbps / 1Mbps / 自定义 | v1.1 |
| 丢包率 | Range | 0-50% | v1.1 |

---

## 3. 文件变更清单

### 新增文件
无（全部在现有文件上修改）

### 修改文件

| 文件 | 变更说明 | 版本 |
|------|----------|------|
| `src/services/types.ts` | 添加 `ThrottleConfig` 接口 + `THROTTLE_PRESETS` 常量 | v1.0 |
| `electron/proxy/mitm-server.ts` | 添加 `setThrottleConfig()` + 请求/响应延迟逻辑 | v1.0 |
| `src/stores/settings-store.ts` | 添加 `throttleEnabled` 等 ref 状态 + IPC 同步 | v1.0 |
| `src/views/SettingsView.vue` | 添加网络节流 UI 分区（仅延迟控制） | v1.0 |
| `electron/preload.ts` | 添加 `throttle.setConfig` IPC 暴露 | v1.0 |
| `src/services/ipc.ts` | 添加 `throttle` 命名空间 + `setConfig` 调用 | v1.0 |
| `electron/proxy/mitm-server.ts` | 添加带宽限制逻辑（流式发送控制） | v1.1 |
| `src/views/SettingsView.vue` | 添加带宽限制 + 丢包率 UI 控件 | v1.1 |

---

## 4. 实现任务分解（v1.0）

### T1: 数据模型 + IPC（0.5 天）

**文件**:
- `src/services/types.ts`（添加 `ThrottleConfig` 接口 + `THROTTLE_PRESETS`）
- `electron/preload.ts`（添加 `throttle.setConfig` IPC 暴露）
- `src/services/ipc.ts`（添加 `throttle` 命名空间 + `setConfig` 调用）

**验收标准**:
- ✅ `ThrottleConfig` 接口定义正确（仅包含 v1.0 字段）
- ✅ `THROTTLE_PRESETS` 预设值合理
- ✅ IPC 通信正常（`ipc.throttle.setConfig()` 可调用）

---

### T2: 代理层延迟逻辑（0.5 天）

**文件**:
- `electron/proxy/mitm-server.ts`（添加请求/响应延迟）

**实现要点**:
1. 在 `onRequest` 中添加请求延迟（`applyRequestDelay()`）
2. 在 `onResponse` 中添加响应延迟（`applyResponseDelay()`）
3. 复用 `matchDomain()` 实现域名过滤
4. 添加 `setThrottleConfig()` IPC 处理器

**验收标准**:
- ✅ 请求延迟功能正常（`requestDelay > 0` 时延迟转发）
- ✅ 响应延迟功能正常（`responseDelay > 0` 时延迟返回）
- ✅ 域名过滤功能正常（仅对匹配域名生效）
- ✅ 预设场景切换正常（3G/4G/5G/弱网）
- ✅ 未启用时零开销（直接 `callback()`）

---

### T3: 状态管理 + UI（0.5 天）

**文件**:
- `src/stores/settings-store.ts`（添加 `throttleEnabled` 等 ref 状态）
- `src/views/SettingsView.vue`（添加网络节流分区）

**实现要点**:
1. 遵循现有模式：使用独立 `ref()` 变量，不是统一 `Settings` 接口
2. 添加防抖保存（`watch` + `debouncedSave()`）
3. 配置变更时自动同步到代理层（`watch` + `updateThrottleConfig()`）
4. UI 包含：启用开关、预设场景、请求延迟、响应延迟、域名过滤
5. **预设场景切换逻辑**（新增）：
   ```typescript
   // src/views/SettingsView.vue
   // 伪代码：预设场景切换逻辑
   
   function onPresetChange(preset: string): void {
     if (preset === 'custom') {
       // 自定义模式：保持当前输入的值
       return
     }
     
     const presetConfig = THROTTLE_PRESETS[preset]
     if (presetConfig) {
       throttleRequestDelay.value = presetConfig.requestDelay || 0
       throttleResponseDelay.value = presetConfig.responseDelay || 0
       throttleOfflineMode.value = presetConfig.offlineMode || false
     }
   }
   ```

**验收标准**:
- ✅ 设置页 UI 完整（仅 v1.0 控件）
- ✅ 预设场景切换正常（选择 3G → 自动填充延迟值）
- ✅ 自定义模式正常（切换回 custom 时保持手动输入的值）
- ✅ 离线模式 UI 提示（显示"离线模式：所有请求将返回 503"）
- ✅ 配置持久化正常（保存到 `settings.json`）
- ✅ 配置同步正常（UI 变更 → 代理层生效）
- ✅ UI 风格与现有设置页一致

---

### T4: 测试（0.5 天）

**测试文件**:
- `electron/proxy/__tests__/throttle.test.ts`（延迟逻辑单元测试）

**验收标准**:
- ✅ 请求延迟逻辑测试通过
- ✅ 响应延迟逻辑测试通过
- ✅ 预设场景切换测试通过
- ✅ 域名过滤测试通过（`matchDomain()` 复用）
- ✅ 未启用时零开销测试通过

## 5. 风险评估

### v1.0 风险（仅延迟控制）

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 延迟时间过长导致代理超时 | 低 | 中 | 添加最大延迟限制（10000ms） |
| 域名过滤逻辑错误 | 低 | 低 | 复用现有 `matchDomain()` 函数 |
| 配置同步失败（IPC 通信） | 低 | 中 | 添加错误处理 + 日志 |
| 代理性能下降（每个请求都检查节流） | 低 | 低 | 未启用时零开销（直接 `callback()`） |

### v1.1 风险（带宽限制 + 丢包模拟）

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 带宽限制实现复杂（流式发送控制） | 高 | 中 | 使用 `stream` 方式，不缓存完整 body |
| 大响应体 + 带宽限制导致内存问题 | 中 | 高 | 使用流式处理，避免 OOM |
| 丢包模拟不准确 | 低 | 低 | 仅作模拟用途，不保证精确性 |

---

## 6. 总结

#13 带宽限流是一个**低工作量、中价值**的功能（v1.0），可以：

1. **模拟弱网环境**（3G/4G/5G/弱网）
2. **验证超时处理逻辑**（设置请求/响应延迟）
3. **按域名过滤**（仅对指定域名启用节流）

**v1.0 范围**（已确认）:
- ✅ 实现请求延迟（`requestDelay`）
- ✅ 实现响应延迟（`responseDelay`）
- ✅ 预设场景切换（3G/4G/5G/弱网/离线）
- ✅ 域名过滤（复用 `matchDomain()`）
- ❌ 带宽限制 → v1.1
- ❌ 丢包模拟 → v1.1

**预计工作量（v1.0）**：1-2 人天  
**依赖**：无  
**优先级**：P1（中价值 - 弱网测试必备）  
**技术挑战**：
- 需要正确区分请求延迟和响应延迟的实现位置
- 需要复用现有 `matchDomain()` 函数，避免重复造轮子
- 需要遵循现有 `settings-store.ts` 的模式（独立 `ref()` 变量）

**v1.1 后续版本**:
- 带宽限制（需要流式发送控制，避免 OOM）
- 丢包模拟（随机延迟加倍，模拟 TCP 重传）

---
