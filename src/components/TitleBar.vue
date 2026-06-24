<template>
  <div
    class="h-10 flex items-center justify-between bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 select-none"
    style="-webkit-app-region: drag; padding-left: 80px; padding-right: 16px;"
  >
    <!-- 左侧：标题（留出 macOS 红绿灯按钮空间） -->
    <div class="flex items-center gap-2">
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ titleMap[route.path] || 'PowerCatch' }}
      </span>
    </div>

    <!-- 右侧：导航 -->
    <div class="flex items-center justify-center gap-1" style="-webkit-app-region: no-drag">
      <button
        class="px-3 py-1 text-xs rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors leading-none"
        @click="router.push('/')"
        :class="{ 'text-primary-600 dark:text-primary-400 bg-blue-50 dark:bg-blue-900': route.path === '/' }"
      >
        主页
      </button>
      <button
        class="px-3 py-1 text-xs rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors leading-none"
        @click="router.push('/settings')"
        :class="{ 'text-primary-600 dark:text-primary-400 bg-blue-50 dark:bg-blue-900': route.path === '/settings' || route.path === '/cert-guide' }"
      >
        ⚙ 设置
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const titleMap: Record<string, string> = {
  '/': 'PowerCatch',
  '/ai-analysis': 'AI 代码分析',
  '/settings': '设置',
  '/ssl-errors': 'SSL 错误',
}
</script>
