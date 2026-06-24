<template>
  <div class="curl-assertion-panel w-full">
    <!-- 面板 Header -->
    <div class="flex items-center justify-between px-4 py-2 bg-[#2d2d44] rounded-t-lg">
      <h3 class="text-sm font-semibold text-gray-300">场景 {{ scenarioIndex + 1 }}: {{ scenarioName }}</h3>
    </div>

    <!-- 左右分栏 -->
    <div class="flex gap-0 bg-[#1a1a2e]" style="height: 200px;">
      <!-- 左栏：curl 命令 -->
      <div class="flex-1 flex flex-col border-r border-gray-700/50">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#2d2d44] border-b border-gray-700/50">
          <span class="text-xs font-semibold text-gray-400">cURL 命令</span>
          <button
            class="btn btn-xs btn-secondary"
            @click="copyCurl"
          >
            复制
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3">
          <pre class="text-xs text-green-400 font-mono whitespace-pre-wrap">{{ curlCommand }}</pre>
        </div>
      </div>

      <!-- 右栏：Python 断言 -->
      <div class="flex-1 flex flex-col">
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#2d2d44] border-b border-gray-700/50">
          <span class="text-xs font-semibold text-gray-400">Python 断言</span>
          <button
            class="btn btn-xs btn-secondary"
            @click="copyPython"
          >
            复制
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3">
          <pre class="text-xs text-blue-400 font-mono whitespace-pre-wrap">{{ pythonAssertion }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  scenarioIndex: number
  scenarioName: string
  curlCommand: string
  pythonAssertion: string
}>()

const emit = defineEmits<{
  (e: 'copy', type: 'curl' | 'python'): void
}>()

async function copyCurl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.curlCommand)
    emit('copy', 'curl')
  } catch (err) {
    console.error('复制 curl 失败:', err)
  }
}

async function copyPython(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.pythonAssertion)
    emit('copy', 'python')
  } catch (err) {
    console.error('复制 Python 失败:', err)
  }
}
</script>

<style scoped>
.btn-xs {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
}

pre {
  margin: 0;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  line-height: 1.5;
}
</style>
