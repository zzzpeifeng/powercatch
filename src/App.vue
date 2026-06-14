<template>
  <div id="app-root" class="h-screen flex flex-col overflow-hidden">
    <!-- 标题栏 -->
    <TitleBar />
    <!-- 路由视图 -->
    <router-view class="flex-1 overflow-y-auto" />
    <!-- 全局 Toast -->
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import ToastContainer from './components/ToastContainer.vue'
import { useSettingsStore } from './stores/settings-store'
import { useRequestStore } from './stores/request-store'
import { ipc } from './services/ipc'

const settingsStore = useSettingsStore()
const requestStore = useRequestStore()

let unsubNewRequests: (() => void) | null = null
let unsubStream: (() => void) | null = null

onMounted(async () => {
  // 加载设置
  await settingsStore.loadSettings()

  // 应用主题设置
  settingsStore.applyTheme()

  // 同步域名过滤列表到请求 store 和主进程
  requestStore.domainFilters = [...settingsStore.domainFilters]
  await ipc.proxy.setDomainFilters(settingsStore.domainFilters)

  // 加载代理状态
  await requestStore.loadProxyStatus()

  // 加载设备别名
  await requestStore.loadDeviceAliases()

  // 订阅新请求事件
  unsubNewRequests = requestStore.subscribeToNewRequests()

  // 订阅流式对比事件
  unsubStream = requestStore.subscribeToStreamEvents()
})

onUnmounted(() => {
  unsubNewRequests?.()
  unsubStream?.()
})
</script>
