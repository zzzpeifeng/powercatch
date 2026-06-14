/**
 * Toast 提示 composable
 * 全局 Toast 管理，支持多种类型和自动消失
 */
import { ref } from 'vue'
import type { Toast, ToastType } from '../services/types'

/** 全局 Toast 列表（单例） */
const toasts = ref<Toast[]>([])
let toastIdCounter = 0

/**
 * Toast composable
 */
export function useToast() {
  /**
   * 显示 Toast
   * @param type Toast 类型
   * @param message 消息内容
   * @param duration 持续时间（ms），默认 3000
   */
  function show(type: ToastType, message: string, duration: number = 3000): void {
    const id = ++toastIdCounter
    toasts.value.push({ id, type, message, duration })

    // 自动移除
    if (duration > 0) {
      setTimeout(() => remove(id), duration)
    }
  }

  /**
   * 移除指定 Toast
   */
  function remove(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /**
   * 清空所有 Toast
   */
  function clear(): void {
    toasts.value = []
  }

  /** 快捷方法 */
  const success = (message: string, duration?: number) => show('success', message, duration)
  const error = (message: string, duration?: number) => show('error', message, duration)
  const warning = (message: string, duration?: number) => show('warning', message, duration)
  const info = (message: string, duration?: number) => show('info', message, duration)

  return {
    toasts,
    show,
    remove,
    clear,
    success,
    error,
    warning,
    info,
  }
}
