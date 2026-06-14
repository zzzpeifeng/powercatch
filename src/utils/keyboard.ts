/**
 * 键盘快捷键管理
 * 支持 Cmd+R、Cmd+Enter、Cmd+E、Cmd+,、Cmd+F 等快捷键
 */
import { onMounted, onUnmounted } from 'vue'

/** 快捷键配置 */
export interface KeyboardShortcut {
  key: string
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  action: () => void
  description: string
}

/**
 * 注册全局键盘快捷键
 * @param shortcuts 快捷键配置列表
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  function handleKeyDown(event: KeyboardEvent): void {
    // 如果焦点在输入框/文本框中，不处理快捷键（除了 Escape）
    const target = event.target as HTMLElement
    const tagName = target.tagName.toLowerCase()
    const isInputFocused = tagName === 'input' || tagName === 'textarea' || target.isContentEditable

    // Escape 始终处理
    if (event.key === 'Escape') {
      const escShortcut = shortcuts.find((s) => s.key === 'Escape')
      if (escShortcut) {
        event.preventDefault()
        escShortcut.action()
      }
      return
    }

    // 输入框中不处理其他快捷键
    if (isInputFocused) return

    for (const shortcut of shortcuts) {
      if (shortcut.key === 'Escape') continue // 已单独处理

      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase() ||
        event.code.toLowerCase() === shortcut.key.toLowerCase()
      const metaMatch = shortcut.meta ? (event.metaKey || event.ctrlKey) : true
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
      const altMatch = shortcut.alt ? event.altKey : !event.altKey

      // 对于非修饰键组合，确保修饰键状态正确
      const noExtraModifiers = !shortcut.meta && !shortcut.ctrl
        ? !event.metaKey && !event.ctrlKey && !event.altKey
        : true

      if (keyMatch && metaMatch && shiftMatch && altMatch) {
        event.preventDefault()
        shortcut.action()
        return
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}

/**
 * 创建主界面快捷键配置
 */
export function createMainShortcuts(handlers: {
  toggleRecord: () => void
  compare: () => void
  exportResult: () => void
  openSettings: () => void
  focusDomainFilter: () => void
  cancel: () => void
  navigateUp: () => void
  navigateDown: () => void
  toggleSelect: () => void
}): KeyboardShortcut[] {
  return [
    {
      key: 'r',
      meta: true,
      action: handlers.toggleRecord,
      description: 'Cmd+R 开始/停止录制',
    },
    {
      key: 'Enter',
      meta: true,
      action: handlers.compare,
      description: 'Cmd+Enter 执行 AI 对比',
    },
    {
      key: 'e',
      meta: true,
      action: handlers.exportResult,
      description: 'Cmd+E 导出',
    },
    {
      key: ',',
      meta: true,
      action: handlers.openSettings,
      description: 'Cmd+, 打开设置',
    },
    {
      key: 'f',
      meta: true,
      action: handlers.focusDomainFilter,
      description: 'Cmd+F 聚焦域名过滤',
    },
    {
      key: 'Escape',
      action: handlers.cancel,
      description: 'Escape 取消操作',
    },
    {
      key: 'ArrowUp',
      action: handlers.navigateUp,
      description: '↑ 选中上一个请求',
    },
    {
      key: 'ArrowDown',
      action: handlers.navigateDown,
      description: '↓ 选中下一个请求',
    },
    {
      key: ' ',
      action: handlers.toggleSelect,
      description: 'Space 切换当前请求勾选状态',
    },
  ]
}
