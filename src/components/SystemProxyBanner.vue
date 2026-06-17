<template>
  <div
    class="flex items-center gap-2 px-3 py-2 text-xs border-b border-yellow-200 dark:border-yellow-900"
    style="background: linear-gradient(to right, #fef9c3, #fde68a); color: #78350f;"
  >
    <span class="text-base shrink-0">⚠️</span>
    <div class="flex-1 min-w-0">
      <div class="font-medium">
        本机代理已开启 ({{ portText }})
      </div>
      <div v-if="activeServices.length" class="text-[10px] opacity-80 truncate">
        活跃网卡：{{ activeServices.join('、') }}
      </div>
    </div>

    <div class="flex items-center gap-1 shrink-0">
      <!-- 关闭本机代理 -->
      <button
        class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors border"
        style="background: transparent; border-color: #78350f; color: #78350f;"
        title="关闭本机系统代理"
        @click="$emit('disable')"
      >
        关闭代理
      </button>

      <!-- 隐藏提示条 -->
      <button
        v-if="!hidden"
        class="px-1.5 py-0.5 text-[10px] opacity-60 hover:opacity-100"
        title="隐藏此提示"
        @click="$emit('hide')"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  activeServices: string[]
  port: number
  hidden: boolean
}>()

defineEmits<{
  (e: 'hide'): void
  (e: 'disable'): void
}>()

const portText = computed(() => `127.0.0.1:${props.port}`)
</script>
