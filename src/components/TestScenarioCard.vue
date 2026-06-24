<template>
  <div class="scenario-card card p-4 mb-3">
    <!-- 场景标题 -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span
          class="badge"
          :class="badgeClass"
        >
          {{ scenario.type }}
        </span>
        <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
          {{ scenario.title }}
        </span>
      </div>
      <button
        class="btn btn-sm btn-ghost text-xs"
        @click="copyAll"
      >
        📋 复制全部
      </button>
    </div>

    <!-- 场景描述 -->
    <p
      v-if="scenario.description"
      class="text-xs text-gray-500 dark:text-gray-400 mb-3"
    >
      {{ scenario.description }}
    </p>

    <!-- 上下布局：curl | Python 断言 -->
    <div class="flex flex-col gap-3">
      <!-- curl -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-gray-500 dark:text-gray-400">cURL</span>
          <button
            class="btn btn-sm btn-ghost text-xs"
            @click="copyCurl"
          >
            📋 复制
          </button>
        </div>
        <pre class="code-block text-xs overflow-x-auto p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 min-h-[100px]"><code class="font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{{ scenario.curl }}</code></pre>
      </div>

      <!-- Python 断言 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Python 断言</span>
          <button
            class="btn btn-sm btn-ghost text-xs"
            @click="copyPython"
          >
            📋 复制
          </button>
        </div>
        <pre class="code-block text-xs overflow-x-auto p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 min-h-[100px]"><code class="font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{{ scenario.pythonAssertion }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TestScenario } from '../services/types'

const props = defineProps<{
  scenario: TestScenario
}>()

const emit = defineEmits<{
  (e: 'toast', message: string, type: string): void
}>()

const badgeClass = computed(() => {
  switch (props.scenario.type) {
    case '正常':
      return 'badge-success'
    case '边界值':
      return 'badge-warning'
    case '异常':
      return 'badge-error'
    default:
      return 'badge-info'
  }
})

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    emit('toast', `${label} 已复制`, 'success')
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    emit('toast', `${label} 已复制`, 'success')
  }
}

function copyCurl(): void {
  copyToClipboard(props.scenario.curl, 'curl 命令')
}

function copyPython(): void {
  copyToClipboard(props.scenario.pythonAssertion, 'Python 断言')
}

function copyAll(): void {
  const content = `# ${props.scenario.title}\n# 场景类型: ${props.scenario.type}\n\n# cURL\n${props.scenario.curl}\n\n# Python 断言\n${props.scenario.pythonAssertion}`
  copyToClipboard(content, '全部用例')
}
</script>
