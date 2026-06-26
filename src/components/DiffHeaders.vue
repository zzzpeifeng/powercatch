<template>
  <div class="diff-headers">
    <div v-if="!diff || (Object.keys(diff.added).length === 0 && Object.keys(diff.removed).length === 0 && diff.modified.length === 0)" class="no-diff">
      ✅ Headers 完全相同
    </div>
    <div v-else class="headers-table">
      <!-- 表头 -->
      <div class="table-header">
        <div class="col-name">Header Name</div>
        <div class="col-value">请求 1</div>
        <div class="col-value">请求 2</div>
      </div>

      <!-- 差异行 -->
      <div v-for="row in rows" :key="row.key"
           :class="['table-row', row.type]"
           @click="highlightRow(row.key)">
        <div class="col-name">{{ row.key }}</div>
        <div class="col-value" :class="{ 'diff-removed': row.type === 'removed' }">
          {{ row.oldValue || '—' }}
        </div>
        <div class="col-value" :class="{ 'diff-added': row.type === 'added' }">
          {{ row.newValue || '—' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  diff: {
    added: Record<string, string>
    removed: Record<string, string>
    modified: Array<{ key: string; old: string; new: string }>
  } | undefined
}

const props = defineProps<Props>()
const highlightedRow = ref<string | null>(null)

// 构建行数据
const rows = computed(() => {
  if (!props.diff) return []
  const result: Array<{ key: string; type: string; oldValue?: string; newValue?: string }> = []

  // Removed 行
  for (const [key, value] of Object.entries(props.diff.removed)) {
    result.push({ key, type: 'removed', oldValue: value })
  }

  // Modified 行
  for (const item of props.diff.modified) {
    result.push({ key: item.key, type: 'modified', oldValue: item.old, newValue: item.new })
  }

  // Added 行
  for (const [key, value] of Object.entries(props.diff.added)) {
    result.push({ key, type: 'added', newValue: value })
  }

  return result
})

// 高亮行
function highlightRow(key: string) {
  highlightedRow.value = highlightedRow.value === key ? null : key
}
</script>

<style scoped>
.diff-headers {
  font-size: 13px;
}

.no-diff {
  padding: 24px;
  text-align: center;
  color: var(--color-success);
  font-size: 14px;
}

.headers-table {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 200px 1fr 1fr;
  padding: 10px 16px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.table-row {
  display: grid;
  grid-template-columns: 200px 1fr 1fr;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.15s;
  cursor: pointer;
}

.table-row:last-child {
  border-bottom: none;
}

.table-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.table-row.added {
  background: rgba(74, 222, 128, 0.08);
}

.table-row.removed {
  background: rgba(248, 113, 113, 0.08);
}

.table-row.modified {
  background: rgba(251, 191, 36, 0.08);
}

.col-name {
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-value {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  color: var(--color-text-secondary);
}

.diff-added {
  color: var(--color-success) !important;
}

.diff-removed {
  color: var(--color-danger) !important;
  text-decoration: line-through;
}
</style>
