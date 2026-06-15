<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ipc } from '../services/ipc'
import { useSettingsStore } from '../stores/settings-store'
import { useRequestStore } from '../stores/request-store'
import type { AppSettings } from '../services/types'
import { useToast } from '../composables/useToast'

const settingsStore = useSettingsStore()
const requestStore = useRequestStore()
const toast = useToast()

// Tab 状态
const activeTab = ref<'settings' | 'certificate'>('settings')

// 设置相关
const localSettings = ref<AppSettings>({
  theme: 'light',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelName: 'gpt-4',
  aiPromptTemplate: '',
  domainFilters: [],
  deviceAliases: {},
  localIp: '127.0.0.1',
  caCertGenerated: false,
  proxyPort: 8888,
})
const savedStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveTimer: ReturnType<typeof setTimeout> | null = null
const newDomain = ref('')
const showApiKey = ref(false)

// 证书安装相关
const certStep = ref(1)
const certDevice = ref<'ios' | 'android' | 'desktop'>('ios')
const isGenerating = ref(false)
const serverRunning = ref(false)
const serverUrl = ref('')
const qrCode = ref('')
const certQrCode = ref('')
const certDownloadUrl = ref('')
const wifiName = ref('')
const wifiPassword = ref('')
const encryptionType = ref<'WPA2' | 'WPA' | 'WEP' | 'None'>('WPA2')
const proxyPortCert = ref(8080)
const showPassword = ref(false)
const certPort = ref(8889)

// 主题选项（含图标）
interface ThemeOption {
  value: string
  label: string
  icon: string
}
const themeOptions: ThemeOption[] = [
  { value: 'light', label: '浅色主题', icon: '☀️' },
  { value: 'dark', label: '深色主题', icon: '🌙' },
  { value: 'auto', label: '跟随系统', icon: '🖥️' },
]

// 切换主题（立即生效）
function handleThemeChange(theme: string) {
  localSettings.value.theme = theme as 'light' | 'dark' | 'system'
  settingsStore.setTheme(theme as 'light' | 'dark' | 'system')
}

// 加密类型选项
const encryptionOptions = [
  { value: 'WPA2', label: 'WPA2/WPA3（推荐）' },
  { value: 'WPA', label: 'WPA' },
  { value: 'WEP', label: 'WEP（不推荐）' },
  { value: 'None', label: '无加密（不推荐）' },
]

// 添加域名
function addDomain() {
  if (newDomain.value && !localSettings.value.domainFilters.includes(newDomain.value)) {
    localSettings.value.domainFilters.push(newDomain.value)
    newDomain.value = ''
  }
}

// 删除域名
function removeDomain(index: number) {
  localSettings.value.domainFilters.splice(index, 1)
}

// 生成证书下载页二维码
async function generateCertQrCode() {
  const url = certDownloadUrl.value || `http://${localSettings.value.localIp}:8889/cert`
  try {
    const result = await ipc.wifi.getQRCode(url)
    if (result.success && result.dataUrl) {
      certQrCode.value = result.dataUrl
    }
  } catch (e) {
    // 忽略生成失败
  }
}

// 加载设置
onMounted(async () => {
  await settingsStore.loadSettings()
  localSettings.value.theme = settingsStore.theme
  localSettings.value.apiUrl = settingsStore.apiUrl
  localSettings.value.apiKey = settingsStore.apiKey
  localSettings.value.modelName = settingsStore.modelName
  localSettings.value.proxyPort = settingsStore.proxyPort
  localSettings.value.deviceAliases = { ...settingsStore.deviceAliases }
  localSettings.value.aiPromptTemplate = settingsStore.aiPromptTemplate
  localSettings.value.domainFilters = [...settingsStore.domainFilters]
  localSettings.value.localIp = settingsStore.localIp
  localSettings.value.caCertGenerated = settingsStore.caCertGenerated

  // ⚠️ 关键：重新从磁盘检查 CA 证书是否真的存在
  // 数据库里的 caCertGenerated 可能过期（证书已生成但 DB 标志位未更新）
  await settingsStore.loadCAStatus()
  localSettings.value.caCertGenerated = settingsStore.caCertGenerated

  const status = await ipc.proxy.status()
  if (status.certUrl) {
    certDownloadUrl.value = status.certUrl
  } else {
    certDownloadUrl.value = `http://${localSettings.value.localIp}:8889/cert`
  }
  proxyPortCert.value = status.port || localSettings.value.proxyPort

  if (settingsStore.caCertGenerated) {
    certStep.value = 2
  }

  await generateCertQrCode()
})

// 监听步骤/设备类型/IP端口变化，重新生成证书下载二维码
watch([certStep, certDevice, () => localSettings.value.localIp, () => localSettings.value.proxyPort], async () => {
  if (certStep.value >= 2 && certDevice.value !== 'desktop') {
    await generateCertQrCode()
  }
})

// 保存设置
async function handleSave() {
  savedStatus.value = 'saving'
  
  try {
    // ⚠️ 关键：先将 localSettings 同步到 settingsStore
    settingsStore.apiUrl = localSettings.value.apiUrl
    settingsStore.apiKey = localSettings.value.apiKey
    settingsStore.modelName = localSettings.value.modelName
    settingsStore.proxyPort = localSettings.value.proxyPort
    settingsStore.domainFilters = [...localSettings.value.domainFilters]
    settingsStore.aiPromptTemplate = localSettings.value.aiPromptTemplate
    settingsStore.localIp = localSettings.value.localIp
    settingsStore.caCertGenerated = localSettings.value.caCertGenerated
    
    // 保存
    await settingsStore.saveSettings()
    
    savedStatus.value = 'saved'
    
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      savedStatus.value = 'idle'
    }, 2000)
  } catch (error: any) {
    savedStatus.value = 'error'
    toast.error('保存失败：' + error.message)
  }
}

// 测试连接
async function handleTestConnection() {
  const result = await ipc.ai.testConnection(
    localSettings.value.apiUrl,
    localSettings.value.apiKey,
    localSettings.value.modelName,
  )

  if (result.success) {
    toast.success('连接成功！' + (result.message || ''))
  } else {
    toast.error('连接失败：' + (result.message || '未知错误'))
  }
}

// 导出数据
async function handleExportData() {
  toast.info('导出功能开发中...')
}

// 清除数据
async function handleClearData() {
  if (!confirm('确定要清除所有抓包数据吗？此操作不可恢复。')) {
    return
  }
  toast.info('清除功能开发中...')
}

// 打开证书文件夹
async function handleOpenCertFolder() {
  const path = await ipc.ca.getPath()
  if (path) {
    await ipc.system.openPath(path)
  }
}

// ===== 证书安装相关函数 =====

// 生成 CA 证书
async function handleGenerateCert() {
  isGenerating.value = true

  try {
    const result = await ipc.ca.generate()

    if (result.success) {
      toast.success('CA 证书已生成！')
      nextStep()
    } else {
      toast.error('生成失败：' + result.error)
    }
  } catch (error: any) {
    toast.error('生成失败：' + error.message)
  } finally {
    isGenerating.value = false
  }
}

// 启动配置服务
async function handleStartServer() {
  try {
    const result = await ipc.wifi.startServer(proxyPortCert.value)
    if (result.success && result.url) {
      serverRunning.value = true
      serverUrl.value = result.url
      toast.success('配置服务已启动')

      const qrResult = await ipc.wifi.getQRCode(result.url)
      if (qrResult.success && qrResult.dataUrl) {
        qrCode.value = qrResult.dataUrl
      }
    } else {
      toast.error('启动失败：' + (result.error || '未知错误'))
    }
  } catch (error: any) {
    toast.error('启动失败：' + error.message)
  }
}

// 停止配置服务
async function handleStopServer() {
  try {
    const result = await ipc.wifi.stopServer()
    if (result.success) {
      serverRunning.value = false
      serverUrl.value = ''
      qrCode.value = ''
      toast.success('配置服务已停止')
    } else {
      toast.error('停止失败：' + result.error)
    }
  } catch (error: any) {
    toast.error('停止失败：' + error.message)
  }
}

// 生成配置文件
async function handleGenerateConfig() {
  if (!wifiName.value) {
    toast.error('请输入 WiFi 名称')
    return
  }

  isGenerating.value = true

  try {
    const result = await ipc.wifi.generateConfig({
      ssid: wifiName.value,
      password: wifiPassword.value,
      encryptionType: encryptionType.value,
      proxyHost: 'PROXY_HOST',
      proxyPort: proxyPortCert.value,
    })

    if (result.success) {
      toast.success('配置文件已生成！')
    } else {
      toast.error('生成失败：' + result.error)
    }
  } catch (error: any) {
    toast.error('生成失败：' + error.message)
  } finally {
    isGenerating.value = false
  }
}

// 下一步
function nextStep() {
  if (certStep.value < 4) {
    certStep.value++
  }
}

// 上一步
function prevStep() {
  if (certStep.value > 1) {
    certStep.value--
  }
}
</script>

<template>
  <div class="settings-view flex flex-col h-full overflow-y-auto bg-[var(--color-bg)]">
    <!-- Tab 导航（使用全局 .tab-bar / .tab-item） -->
    <div class="tab-bar px-4">
      <div
        :class="['tab-item', { active: activeTab === 'settings' }]"
        @click="activeTab = 'settings'"
      >
        ⚙ 基本设置
      </div>
      <div
        :class="['tab-item', { active: activeTab === 'certificate' }]"
        @click="activeTab = 'certificate'"
      >
        🔒 证书安装
      </div>
    </div>

    <!-- 基本设置 Tab -->
    <div v-if="activeTab === 'settings'" class="p-4 overflow-y-auto flex-1">
      <div class="max-w-2xl mx-auto flex flex-col gap-4">

        <!-- 代理配置 -->
        <div class="card p-4">
          <h3 class="text-sm font-semibold mb-3 text-[var(--color-text)]">代理配置</h3>
          <div class="flex items-center gap-3 mb-3">
            <label class="label w-24 shrink-0">代理端口</label>
            <input
              v-model.number="localSettings.proxyPort"
              type="number"
              class="input input-sm w-36"
              min="1024"
              max="65535"
            />
          </div>
        </div>

        <!-- 域名过滤 -->
        <div class="card p-4">
          <h3 class="text-sm font-semibold mb-3 text-[var(--color-text)]">域名过滤</h3>
          <label class="label mb-2">过滤域名</label>
          <div class="tag-input-container">
            <div v-for="(domain, index) in localSettings.domainFilters" :key="domain" class="tag-item">
              <span>{{ domain }}</span>
              <span class="tag-remove" @click="removeDomain(index)">×</span>
            </div>
            <input
              v-model="newDomain"
              @keyup.enter="addDomain"
              placeholder="输入域名后回车添加"
              class="input input-sm flex-1 min-w-[120px] border-none bg-transparent p-0 focus:ring-0 text-sm"
            />
          </div>
        </div>

        <!-- AI 配置 -->
        <div class="card p-4">
          <h3 class="text-sm font-semibold mb-3 text-[var(--color-text)]">AI 配置</h3>
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <label class="label w-24 shrink-0">API 地址</label>
              <input
                v-model="localSettings.apiUrl"
                type="text"
                class="input input-sm flex-1"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div class="flex items-center gap-3">
              <label class="label w-24 shrink-0">API Key</label>
              <div class="flex items-center gap-2 flex-1">
                <input
                  v-model="localSettings.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  class="input input-sm flex-1"
                  placeholder="sk-..."
                />
                <button class="btn btn-secondary btn-sm" @click="showApiKey = !showApiKey">
                  {{ showApiKey ? '隐藏' : '显示' }}
                </button>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <label class="label w-24 shrink-0">模型名称</label>
              <input
                v-model="localSettings.modelName"
                type="text"
                class="input input-sm flex-1"
                placeholder="gpt-4"
              />
            </div>
            <div class="flex items-center gap-3">
              <span class="w-24 shrink-0"></span>
              <button class="btn btn-secondary btn-sm" @click="handleTestConnection">
                测试连接
              </button>
            </div>
          </div>
        </div>

        <!-- 显示设置 -->
        <div class="card p-4">
          <h3 class="text-sm font-semibold mb-3 text-[var(--color-text)]">显示设置</h3>
          <div class="flex flex-col gap-1.5">
            <label
              v-for="option in themeOptions"
              :key="option.value"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 border-2"
              :class="[
                settingsStore.theme === option.value
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                  : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50',
              ]"
              @click="handleThemeChange(option.value)"
            >
              <!-- 单选圆圈 -->
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                :class="[
                  settingsStore.theme === option.value
                    ? 'border-[var(--color-primary)]'
                    : 'border-gray-300 dark:border-gray-500',
                ]"
              >
                <span
                  v-if="settingsStore.theme === option.value"
                  class="w-2 h-2 rounded-full bg-[var(--color-primary)]"
                ></span>
              </span>
              <!-- 图标 -->
              <span class="text-base w-5 text-center">{{ option.icon }}</span>
              <!-- 标签 -->
              <span class="text-xs font-medium text-[var(--color-text)]">{{ option.label }}</span>
            </label>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-3 pt-2">
          <button
            class="btn btn-primary btn-sm"
            :disabled="savedStatus === 'saving'"
            @click="handleSave"
          >
            {{ savedStatus === 'saving' ? '保存中...' : '保存设置' }}
          </button>
          <button class="btn btn-secondary btn-sm" @click="handleExportData">
            导出数据
          </button>
          <button class="btn btn-danger btn-sm" @click="handleClearData">
            清除数据
          </button>
          <span v-if="savedStatus === 'saved'" class="text-sm text-green-600 dark:text-green-400 ml-2">
            ✓ 已保存
          </span>
        </div>
      </div>
    </div>

    <!-- 证书安装 Tab -->
    <div v-if="activeTab === 'certificate'" class="p-4 overflow-y-auto flex-1">
      <div class="max-w-2xl mx-auto flex flex-col gap-4">

        <!-- 步骤指示器 -->
        <div class="flex items-center gap-2">
          <div
            v-for="(step, idx) in ['生成证书', '安装证书', '配置代理', '开始抓包']"
            :key="idx"
            class="flex items-center gap-2 flex-1"
          >
            <div
              class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
              :class="[
                certStep === idx + 1
                  ? 'bg-[var(--color-primary)] text-white'
                  : certStep > idx + 1
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
              ]"
            >
              {{ idx + 1 }}
            </div>
            <span
              class="text-xs hidden sm:inline"
              :class="[
                certStep === idx + 1
                  ? 'text-[var(--color-primary)] font-medium'
                  : 'text-gray-500 dark:text-gray-400',
              ]"
            >{{ step }}</span>
            <div v-if="idx < 3" class="flex-1 h-px bg-gray-200 dark:bg-gray-700 hidden sm:block"></div>
          </div>
        </div>

        <!-- 步骤 1: 生成证书 -->
        <div v-if="certStep === 1" class="card p-4">
          <h3 class="text-sm font-semibold mb-2 text-[var(--color-text)]">步骤 1：生成 CA 证书</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            首先需要生成 CA 根证书，用于 HTTPS 请求的拦截和解密。
          </p>
          <button
            class="btn btn-primary btn-sm"
            :disabled="isGenerating"
            @click="handleGenerateCert"
          >
            {{ isGenerating ? '生成中...' : '生成 CA 证书' }}
          </button>
        </div>

        <!-- 步骤 2: 安装证书 -->
        <div v-if="certStep === 2" class="flex flex-col gap-4">
          <div class="card p-4">
            <h3 class="text-sm font-semibold mb-2 text-[var(--color-text)]">步骤 2：安装 CA 证书</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              将 CA 证书安装到你的设备上，HTTPS 抓包必须这一步。
            </p>

            <!-- 设备选择 Tab（使用全局 .tab-bar / .tab-item，缩小版） -->
            <div class="flex gap-2 mb-4">
              <button
                :class="['px-3 py-1.5 text-xs rounded-md font-medium transition-colors', certDevice === 'ios' ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600']"
                @click="certDevice = 'ios'"
              >📱 iOS / iPad</button>
              <button
                :class="['px-3 py-1.5 text-xs rounded-md font-medium transition-colors', certDevice === 'android' ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600']"
                @click="certDevice = 'android'"
              >🤖 Android</button>
              <button
                :class="['px-3 py-1.5 text-xs rounded-md font-medium transition-colors', certDevice === 'desktop' ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600']"
                @click="certDevice = 'desktop'"
              >💻 电脑端</button>
            </div>

            <!-- iOS 指引 -->
            <div v-if="certDevice === 'ios'" class="flex flex-col gap-3">
              <div class="card p-3">
                <h4 class="text-xs font-semibold mb-2">方式一：Safari 下载安装（推荐）</h4>
                <ol class="text-xs text-gray-600 dark:text-gray-400 flex flex-col gap-1 pl-4 list-decimal">
                  <li>确保手机和本机在同一 WiFi 下</li>
                  <li>在手机 Safari 打开：<code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ certDownloadUrl }}</code></li>
                  <li>下载描述文件，前往「设置 → 已下载描述文件」安装</li>
                  <li>安装完成后，前往「设置 → 通用 → 关于本机 → 证书信任设置」，开启本证书的信任</li>
                </ol>
              </div>
              <div class="card p-3">
                <h4 class="text-xs font-semibold mb-2">方式二：AirDrop 发送</h4>
                <ol class="text-xs text-gray-600 dark:text-gray-400 flex flex-col gap-1 pl-4 list-decimal">
                  <li>点击下方「打开证书文件夹」</li>
                  <li>找到 <code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">ca.pem</code>，右键分享 → AirDrop 发送到 iPhone</li>
                  <li>在 iPhone 上接收并安装，然后开启证书信任（同上）</li>
                </ol>
              </div>
              <div class="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-xs">
                ⚠️ iOS 安装后必须手动开启证书信任，否则 HTTPS 请求会失败！
              </div>
              <!-- 证书下载二维码 -->
              <div class="card p-3 flex flex-col items-center">
                <p class="text-xs text-gray-600 dark:text-gray-400 mb-2">📱 手机扫描下方二维码，直接访问证书下载页：</p>
                <div v-if="certQrCode" class="p-2 bg-white rounded-md">
                  <img :src="certQrCode" alt="证书下载二维码" class="w-[160px] h-[160px]" />
                </div>
                <p v-else class="text-xs text-gray-400 py-4">二维码生成中...</p>
              </div>
            </div>

            <!-- Android 指引 -->
            <div v-if="certDevice === 'android'" class="flex flex-col gap-3">
              <div class="card p-3">
                <h4 class="text-xs font-semibold mb-2">方式一：浏览器下载</h4>
                <ol class="text-xs text-gray-600 dark:text-gray-400 flex flex-col gap-1 pl-4 list-decimal">
                  <li>确保手机和本机在同一 WiFi 下</li>
                  <li>在手机浏览器打开：<code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ certDownloadUrl }}</code></li>
                  <li>下载 <code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">ca.pem</code></li>
                  <li>前往「设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书」，选择下载的文件</li>
                  <li>确认安装（可能需要设置锁屏密码）</li>
                </ol>
              </div>
              <div class="card p-3">
                <h4 class="text-xs font-semibold mb-2">方式二：WiFi 代理 + 手动安装</h4>
                <ol class="text-xs text-gray-600 dark:text-gray-400 flex flex-col gap-1 pl-4 list-decimal">
                  <li>在 WiFi 设置中将代理设为「手动」</li>
                  <li>服务器填本机 IP：<code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ localSettings.localIp }}</code>，端口：<code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ localSettings.proxyPort }}</code></li>
                  <li>浏览器访问 <code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">http://mitm.it</code> 下载证书</li>
                  <li>按系统提示安装 CA 证书</li>
                </ol>
              </div>
              <div class="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-xs">
                ⚠️ 部分 Android 应用（如微信）会忽略用户证书，需要 root 后才能抓包！
              </div>
              <div class="card p-3 flex flex-col items-center">
                <p class="text-xs text-gray-600 dark:text-gray-400 mb-2">🤖 手机扫描下方二维码，直接访问证书下载页：</p>
                <div v-if="certQrCode" class="p-2 bg-white rounded-md">
                  <img :src="certQrCode" alt="证书下载二维码" class="w-[160px] h-[160px]" />
                </div>
                <p v-else class="text-xs text-gray-400 py-4">二维码生成中...</p>
              </div>
            </div>

            <!-- 电脑端指引 -->
            <div v-if="certDevice === 'desktop'" class="flex flex-col gap-3">
              <div class="card p-3">
                <h4 class="text-xs font-semibold mb-2">macOS</h4>
                <ol class="text-xs text-gray-600 dark:text-gray-400 flex flex-col gap-1 pl-4 list-decimal">
                  <li>点击下方「打开证书文件夹」</li>
                  <li>双击 <code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">ca.pem</code>，添加到「系统」钥匙串</li>
                  <li>在「钥匙串访问」中找到 <code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">NodeMITMProxyCA</code> 证书</li>
                  <li>右键 → 显示简介 → 展开「信任」→ 改为「始终信任」</li>
                </ol>
              </div>
              <div class="card p-3">
                <h4 class="text-xs font-semibold mb-2">Windows</h4>
                <ol class="text-xs text-gray-600 dark:text-gray-400 flex flex-col gap-1 pl-4 list-decimal">
                  <li>点击下方「打开证书文件夹」</li>
                  <li>双击 <code class="text-[var(--color-danger)] bg-gray-100 dark:bg-gray-800 px-1 rounded">ca.pem</code>，选择「安装证书」</li>
                  <li>存储位置选「当前用户」，下一步</li>
                  <li>选择「将所有的证书都放入下列存储」，浏览 → 选择「受信任的根证书颁发机构」</li>
                  <li>完成导入</li>
                </ol>
              </div>
            </div>

            <button class="btn btn-secondary btn-sm self-start" @click="handleOpenCertFolder">
              打开证书文件夹
            </button>
          </div>
        </div>

        <!-- 步骤 3: 配置代理 -->
        <div v-if="certStep === 3" class="card p-4 flex flex-col gap-4">
          <h3 class="text-sm font-semibold text-[var(--color-text)]">步骤 3：配置代理</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            配置你的设备使用本机作为代理服务器。
          </p>

          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <label class="label w-28 shrink-0">WiFi 名称</label>
              <input v-model="wifiName" type="text" class="input input-sm flex-1" placeholder="请输入 WiFi 名称" />
            </div>
            <div class="flex items-center gap-3">
              <label class="label w-28 shrink-0">WiFi 密码</label>
              <input v-model="wifiPassword" :type="showPassword ? 'text' : 'password'" class="input input-sm flex-1" placeholder="请输入 WiFi 密码" />
            </div>
            <div class="flex items-center gap-3">
              <label class="label w-28 shrink-0">加密类型</label>
              <select v-model="encryptionType" class="input input-sm flex-1">
                <option v-for="option in encryptionOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <div class="flex items-center gap-3">
              <label class="label w-28 shrink-0">代理端口</label>
              <input v-model.number="proxyPortCert" type="number" class="input input-sm w-36" min="1024" max="65535" />
            </div>
            <div class="flex items-center gap-3">
              <span class="w-28 shrink-0"></span>
              <button
                class="btn btn-primary btn-sm"
                :disabled="isGenerating"
                @click="handleGenerateConfig"
              >
                {{ isGenerating ? '生成中...' : '生成配置文件' }}
              </button>
            </div>
          </div>

          <div v-if="serverRunning" class="p-3 rounded-md bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200">
            <p class="text-xs mb-2">配置服务已启动：{{ serverUrl }}</p>
            <div v-if="qrCode" class="flex justify-center">
              <img :src="qrCode" alt="QR Code" class="w-[160px] h-[160px] bg-white p-2 rounded-md" />
            </div>
            <button class="btn btn-danger btn-sm mt-2" @click="handleStopServer">停止服务</button>
          </div>

          <button v-else class="btn btn-primary btn-sm self-start" @click="handleStartServer">
            启动配置服务
          </button>
        </div>

        <!-- 步骤 4: 开始抓包 -->
        <div v-if="certStep === 4" class="card p-4">
          <h3 class="text-sm font-semibold mb-2 text-[var(--color-text)]">步骤 4：开始抓包</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            一切准备就绪，现在可以开始抓包了！
          </p>
          <div class="flex flex-col gap-1 text-sm text-green-700 dark:text-green-400">
            <p>✅ CA 证书已生成</p>
            <p>✅ CA 证书已安装</p>
            <p>✅ 代理已配置</p>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-4">
            现在可以切换到"抓包列表"标签页，开始抓包！
          </p>
        </div>

        <!-- 导航按钮 -->
        <div class="flex items-center justify-between pt-2">
          <button
            class="btn btn-secondary btn-sm"
            :disabled="certStep === 1"
            @click="prevStep"
          >
            上一步
          </button>
          <button
            v-if="certStep < 4"
            class="btn btn-primary btn-sm"
            @click="nextStep"
          >
            下一步
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
