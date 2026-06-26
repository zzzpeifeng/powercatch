<template>
  <div class="diff-overview">
    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card stat-added">
        <div class="stat-value">+{{ totalAdded }}</div>
        <div class="stat-label">新增</div>
      </div>
      <div class="stat-card stat-removed">
        <div class="stat-value">-{{ totalRemoved }}</div>
        <div class="stat-label">删除</div>
      </div>
      <div class="stat-card stat-changed">
        <div class="stat-value">~{{ totalModified }}</div>
        <div class="stat-label">修改</div>
      </div>
    </div>

    <!-- 差异列表 -->
    <div class="diff-section">
      <div class="section-title">📊 差异概览</div>
      <div class="diff-highlights">
        <div v-for="item in highlights" :key="item.label" class="highlight-item">
          <span :class="['highlight-badge', item.type]">{{ item.badge }}</span>
          <span class="highlight-label">{{ item.label }}</span>
        </div>
        <div v-if="highlights.length === 0" class="no-diff">
          ✅ 两个请求完全相同
        </div>
      </div>
    </div>

    <!-- 相同项 -->
    <div v-if="sameItems.length > 0" class="diff-section">
      <div class="section-title">✅ 相同项</div>
      <div class="same-items">
        <span v-for="item in sameItems" :key="item" class="same-item">{{ item }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDiffStore } from '../stores/diff-store'

const diffStore = useDiffStore()
const { diffResult } = storeToRefs(diffStore)

// 总计统计
const totalAdded = computed(() => {
  if (!diffResult.value) return 0
  const stats = diffResult.value.overview.stats
  return stats.requestHeaders.added + stats.responseHeaders.added
})

const totalRemoved = computed(() => {
  if (!diffResult.value) return 0
  const stats = diffResult.value.overview.stats
  return stats.requestHeaders.removed + stats.responseHeaders.removed
})

const totalModified = computed(() => {
  if (!diffResult.value) return 0
  const stats = diffResult.value.overview.stats
  return stats.requestHeaders.modified + stats.responseHeaders.modified
})

// 差异列表
const highlights = computed(() => {
  if (!diffResult.value) return []
  const items: Array<{ type: string; badge: string; label: string }> = []
  const stats = diffResult.value.overview.stats

  // 请求头差异
  if (stats.requestHeaders.added > 0) {
    items.push({ type: 'added', badge: '新增', label: `请求头新增 ${stats.requestHeaders.added} 项` })
  }
  if (stats.requestHeaders.removed > 0) {
    items.push({ type: 'removed', badge: '删除', label: `请求头删除 ${stats.requestHeaders.removed} 项` })
  }
  if (stats.requestHeaders.modified > 0) {
    items.push({ type: 'changed', badge: '修改', label: `请求头修改 ${stats.requestHeaders.modified} 项` })
  }

  // 请求体差异
  if (stats.requestBody.changes > 0) {
    items.push({ type: 'changed', badge: '修改', label: `请求体有 ${stats.requestBody.changes} 处差异` })
  }

  // 响应头差异
  if (stats.responseHeaders.added > 0) {
    items.push({ type: 'added', badge: '新增', label: `响应头新增 ${stats.responseHeaders.added} 项` })
  }
  if (stats.responseHeaders.removed > 0) {
    items.push({ type: 'removed', badge: '删除', label: `响应头删除 ${stats.responseHeaders.removed} 项` })
  }
  if (stats.responseHeaders.modified > 0) {
    items.push({ type: 'changed', badge: '修改', label: `响应头修改 ${stats.responseHeaders.modified} 项` })
  }

  // 响应体差异
  if (stats.responseBody.changes > 0) {
    items.push({ type: 'changed', badge: '修改', label: `响应体有 ${stats.responseBody.changes} 处差异` })
  }

  return items
})

// 相同项
const sameItems = computed(() => {
  if (!diffResult.value) return []
  return diffResult.value.overview.same
})
</script>

<style scoped>
.diff-overview {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stats-row {
  display: flex;
  gap: 16px;
}

.stat-card {
  flex: 1;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.stat-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 6px;
}

.stat-added .stat-value {
  color: var(--color-success);
}

.stat-removed .stat-value {
  color: var(--color-danger);
}

.stat-changed .stat-value {
  color: var(--color-warning);
}

.diff-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.diff-highlights {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.highlight-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
}

.highlight-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.highlight-badge.added {
  background: rgba(74, 222, 128, 0.2);
  color: var(--color-success);
}

.highlight-badge.removed {
  background: rgba(248, 113, 113, 0.2);
  color: var(--color-danger);
}

.highlight-badge.changed {
  background: rgba(251, 191, 36, 0.2);
  color: var(--color-warning);
}

.highlight-label {
  color: var(--color-text);
}

.no-diff {
  padding: 16px;
  text-align: center;
  color: var(--color-success);
  font-size: 14px;
}

.same-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.same-item {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(74, 222, 128, 0.1);
  color: var(--color-success);
  border: 1px solid rgba(74, 222, 128, 0.2);
}
</style>
