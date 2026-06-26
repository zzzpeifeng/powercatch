<template>
  <div class="diff-body">
    <!-- JSON diff -->
    <div v-if="diff?.type === 'json'" class="json-diff">
      <div class="json-header">
        <span class="json-path-header">路径</span>
        <span class="json-change-header">变更</span>
      </div>
      <div v-for="item in diff.delta" :key="item.path" :class="['json-row', item.type]">
        <span class="json-path">{{ item.path }}</span>
        <span class="json-change">
          <template v-if="item.type === 'modified'">
            <span class="old-value">{{ formatValue(item.oldValue) }}</span>
            <span class="arrow">→</span>
            <span class="new-value">{{ formatValue(item.newValue) }}</span>
          </template>
          <template v-else-if="item.type === 'added'">
            <span class="new-value">+ {{ formatValue(item.newValue) }}</span>
          </template>
          <template v-else-if="item.type === 'removed'">
            <span class="old-value">- {{ formatValue(item.oldValue) }}</span>
          </template>
        </span>
      </div>
    </div>

    <!-- Text diff -->
    <div v-else-if="diff?.type === 'text'" class="text-diff">
      <div class="text-header">
        <span class="line-num-header">#</span>
        <span class="line-content-header">内容</span>
      </div>
      <div v-for="(line, index) in diff.changes" :key="index"
           :class="['text-line', { added: line.added, removed: line.removed }]">
        <span class="line-num">{{ index + 1 }}</span>
        <span class="line-content">{{ line.value }}</span>
      </div>
    </div>

    <!-- Binary -->
    <div v-else-if="diff?.type === 'binary'" class="empty-state">
      <div class="empty-icon">📦</div>
      <div class="empty-text">无法对比二进制内容</div>
    </div>

    <!-- Empty -->
    <div v-else class="empty-state">
      <div class="empty-icon">📄</div>
      <div class="empty-text">无内容</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  diff: {
    type: 'json' | 'text' | 'binary' | 'empty'
    delta?: Array<{ path: string; type: 'added' | 'removed' | 'modified'; oldValue?: any; newValue?: any }>
    changes?: Array<{ value: string; added?: boolean; removed?: boolean }>
  } | undefined
}

defineProps<Props>()

// 格式化值
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<style scoped>
.diff-body {
  font-size: 13px;
}

/* JSON diff */
.json-diff {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.json-header {
  display: grid;
  grid-template-columns: 200px 1fr;
  padding: 10px 16px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.json-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
}

.json-row:last-child {
  border-bottom: none;
}

.json-row.added {
  background: rgba(74, 222, 128, 0.08);
}

.json-row.removed {
  background: rgba(248, 113, 113, 0.08);
}

.json-row.modified {
  background: rgba(251, 191, 36, 0.08);
}

.json-path {
  color: var(--color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.json-change {
  display: flex;
  align-items: center;
  gap: 8px;
}

.old-value {
  color: var(--color-danger);
  text-decoration: line-through;
}

.new-value {
  color: var(--color-success);
}

.arrow {
  color: var(--color-text-secondary);
  font-size: 12px;
}

/* Text diff */
.text-diff {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.text-header {
  display: grid;
  grid-template-columns: 50px 1fr;
  padding: 10px 16px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.text-line {
  display: grid;
  grid-template-columns: 50px 1fr;
  padding: 4px 16px;
  border-bottom: 1px solid var(--color-border);
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
}

.text-line:last-child {
  border-bottom: none;
}

.text-line.added {
  background: rgba(74, 222, 128, 0.08);
}

.text-line.removed {
  background: rgba(248, 113, 113, 0.08);
}

.line-num {
  color: var(--color-text-secondary);
  text-align: right;
  padding-right: 12px;
  user-select: none;
}

.line-content {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text);
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--color-text-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
}
</style>
