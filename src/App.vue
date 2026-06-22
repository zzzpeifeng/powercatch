<template>
  <div id="app-root" class="h-screen flex flex-col overflow-hidden">
    <!-- 标题栏 -->
    <TitleBar />
    <!-- 路由视图 -->
    <router-view class="flex-1 overflow-y-auto" />
    <!-- 全局 Toast -->
    <ToastContainer />
    <!-- 断点编辑弹窗 -->
    <BreakpointDialog />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import ToastContainer from './components/ToastContainer.vue'
import BreakpointDialog from './components/BreakpointDialog.vue'
import { useSettingsStore } from './stores/settings-store'
import { useRequestStore } from './stores/request-store'
import { useBreakpointStore } from './stores/breakpoint-store'
import { ipc } from './services/ipc'

const settingsStore = useSettingsStore()
const requestStore = useRequestStore()
const breakpointStore = useBreakpointStore()

let unsubStream: (() => void) | null = null
let unsubBreakpoint: (() => void) | null = null

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

  // 加载断点规则
  await breakpointStore.loadRules()

  // 订阅断点拦截事件
  unsubBreakpoint = ipc.breakpoint.onIntercepted((session) => {
    breakpointStore.addSession(session)
  })

  // 订阅流式对比事件（新请求事件已在 store 初始化时订阅，无需重复）
  unsubStream = requestStore.subscribeToStreamEvents()
})

onUnmounted(() => {
  // 新请求订阅由 store 内部管理，此处只清理流式对比
  unsubStream?.()
  unsubBreakpoint?.()
})
</script>
