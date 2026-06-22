<template>
  <div class="relative" ref="dropdownRef">
    <!-- 触发按钮 -->
    <button
      class="flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-md transition-all duration-200 border"
      :class="[
        isOpen
          ? 'bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-500'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600/50',
        badgeCount > 0 ? 'relative' : ''
      ]"
      @click="toggle"
    >
      <slot name="icon" />
      <span>{{ label }}</span>
      <svg
        class="w-3 h-3 transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M3 4.5L6 7.5L9 4.5" />
      </svg>
      <span
        v-if="badgeCount > 0"
        class="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] flex items-center justify-center px-1 text-[9px] font-bold rounded-full bg-red-500 text-white"
      >
        {{ badgeCount }}
      </span>
    </button>

    <!-- 下拉菜单 -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 py-1"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  badgeCount?: number
}>(), {
  badgeCount: 0
})

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'close'): void
}>()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    emit('open')
  } else {
    emit('close')
  }
}

function close() {
  if (isOpen.value) {
    isOpen.value = false
    emit('close')
  }
}

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})

// 暴露 close 方法供父组件调用
defineExpose({ close })
</script>

<style scoped>
.dropdown-item {
  @apply flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors duration-150 w-full text-left;
}

.dropdown-item:disabled {
  @apply opacity-50 cursor-not-allowed;
}

.dropdown-divider {
  @apply h-px bg-gray-200 dark:bg-gray-700 my-1;
}
</style>
