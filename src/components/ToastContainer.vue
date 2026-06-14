<template>
  <div class="fixed top-14 right-4 z-50 flex flex-col gap-2 max-w-sm">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="px-4 py-3 rounded-lg shadow-lg text-sm animate-slide-up flex items-start gap-2"
        :class="toastClass(toast.type)"
        @click="remove(toast.id)"
      >
        <span class="flex-shrink-0 mt-0.5">{{ toastIcon(toast.type) }}</span>
        <span>{{ toast.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '../composables/useToast'
import type { ToastType } from '../services/types'

const { toasts, remove } = useToast()

function toastClass(type: ToastType): string {
  const classes: Record<ToastType, string> = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    warning: 'bg-yellow-500 text-white',
    info: 'bg-blue-600 text-white',
  }
  return classes[type]
}

function toastIcon(type: ToastType): string {
  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  }
  return icons[type]
}
</script>
