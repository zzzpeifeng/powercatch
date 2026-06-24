<template>
  <div class="flex flex-col items-center justify-center py-16 px-4">
    <!-- 图标 -->
    <div class="text-6xl mb-6">⚠️</div>

    <!-- 标题 -->
    <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-3">
      Git 未安装
    </h2>

    <!-- 描述 -->
    <p class="text-sm text-gray-500 dark:text-gray-400 text-center max-w-md mb-6 leading-relaxed">
      AI 代码分析功能需要 Git 来克隆代码仓库。请先在您的系统上安装 Git，然后点击下方按钮重新检测。
    </p>

    <!-- 检测信息 -->
    <div
      v-if="error"
      class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-6 max-w-md"
    >
      <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center gap-3">
      <button
        class="btn btn-primary"
        :disabled="checking"
        @click="$emit('recheck')"
      >
        <span v-if="checking" class="spinner spinner-dark mr-2"></span>
        {{ checking ? '检测中...' : '重新检测' }}
      </button>

      <a
        href="https://git-scm.com/downloads"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-secondary"
      >
        下载 Git
      </a>
    </div>

    <!-- 安装提示 -->
    <div class="mt-8 text-xs text-gray-400 dark:text-gray-500 text-center max-w-md">
      <p class="mb-1">macOS: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">brew install git</code></p>
      <p class="mb-1">Windows: 从 <a href="https://git-scm.com/downloads" target="_blank" class="text-blue-500 hover:underline">git-scm.com</a> 下载安装</p>
      <p>Linux: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">sudo apt install git</code> 或 <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">sudo yum install git</code></p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  error?: string
  checking?: boolean
}>()

defineEmits<{
  (e: 'recheck'): void
}>()
</script>
