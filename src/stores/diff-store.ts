/**
 * Diff 对比状态管理
 * 管理两个请求的对比状态、结果和 UI 状态
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { CaptureRequest, DiffResult } from '../services/types'
import { computeDiff } from '../services/diff-engine'

/** sessionStorage key */
const SESSION_KEY = 'powercatch:diff-state'

/** Diff Tab 类型 */
export type DiffTab = 'overview' | 'requestHeaders' | 'requestBody' | 'responseHeaders' | 'responseBody'

export const useDiffStore = defineStore('diff', () => {
  // ===== State =====

  /** 对比请求 A */
  const request1 = ref<CaptureRequest | null>(null)

  /** 对比请求 B */
  const request2 = ref<CaptureRequest | null>(null)

  /** Diff 对比结果 */
  const diffResult = ref<DiffResult | null>(null)

  /** 当前激活的 Tab */
  const activeTab = ref<DiffTab>('overview')

  /** 各容器的滚动位置（key 为容器 ID） */
  const scrollPositions = ref<Record<string, number>>({})

  // ===== Getters =====

  /** 是否有有效的 diff 结果 */
  const hasDiff = computed(() => request1.value !== null && request2.value !== null && diffResult.value !== null)

  // ===== Actions =====

  /**
   * 设置对比请求并自动计算 diff
   */
  function setRequests(req1: CaptureRequest, req2: CaptureRequest): void {
    request1.value = req1
    request2.value = req2
    diffResult.value = computeDiff(req1, req2)
  }

  /**
   * 手动设置 diff 结果（用于外部计算的结果）
   */
  function setDiffResult(result: DiffResult): void {
    diffResult.value = result
  }

  /**
   * 设置当前激活的 Tab
   */
  function setActiveTab(tab: DiffTab): void {
    activeTab.value = tab
  }

  /**
   * 交换两个请求的位置并重新计算 diff
   */
  function swapRequests(): void {
    if (!request1.value || !request2.value) return
    const tmp = request1.value
    request1.value = request2.value
    request2.value = tmp
    // 重新计算 diff
    if (request1.value && request2.value) {
      diffResult.value = computeDiff(request1.value, request2.value)
    }
  }

  /**
   * 清空所有 diff 状态
   */
  function clear(): void {
    request1.value = null
    request2.value = null
    diffResult.value = null
    activeTab.value = 'overview'
    scrollPositions.value = {}
    saveToSession()
  }

  /**
   * 保存某个容器的滚动位置
   */
  function saveScrollPosition(containerId: string, position: number): void {
    scrollPositions.value = { ...scrollPositions.value, [containerId]: position }
  }

  /**
   * 获取某个容器的滚动位置
   */
  function getScrollPosition(containerId: string): number {
    return scrollPositions.value[containerId] ?? 0
  }

  /**
   * 从 sessionStorage 恢复状态
   */
  function restoreFromSession(): void {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY)
      if (!stored) return
      const data = JSON.parse(stored)
      if (data.request1) request1.value = data.request1
      if (data.request2) request2.value = data.request2
      if (data.diffResult) diffResult.value = data.diffResult
      if (data.activeTab) activeTab.value = data.activeTab
      if (data.scrollPositions) scrollPositions.value = data.scrollPositions
    } catch (e) {
      console.warn('[DiffStore] 恢复 session 状态失败:', e)
    }
  }

  /**
   * 保存状态到 sessionStorage
   */
  function saveToSession(): void {
    try {
      const data = {
        request1: request1.value,
        request2: request2.value,
        diffResult: diffResult.value,
        activeTab: activeTab.value,
        scrollPositions: scrollPositions.value,
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data))
    } catch (e) {
      console.warn('[DiffStore] 保存 session 状态失败:', e)
    }
  }

  // ===== 自动保存到 sessionStorage =====
  watch([request1, request2, diffResult, activeTab], () => saveToSession(), { deep: true })

  // ===== 初始化：尝试从 session 恢复 =====
  restoreFromSession()

  return {
    // State
    request1,
    request2,
    diffResult,
    activeTab,
    scrollPositions,
    // Getters
    hasDiff,
    // Actions
    setRequests,
    setDiffResult,
    setActiveTab,
    swapRequests,
    clear,
    saveScrollPosition,
    getScrollPosition,
    restoreFromSession,
  }
})
