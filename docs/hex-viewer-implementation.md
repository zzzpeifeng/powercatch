# Hex 查看器 - 实现方案

> **目标**: 提供类似 Wireshark 的 Hex 查看器，支持大文件（虚拟滚动）  
> **工作量评估**: 小（约 0.5 人天）  
> **依赖**: 无  

---

## 1. 功能概述

### 1.1 核心能力

**Hex 查看器**允许以十六进制 + ASCII 方式查看二进制数据，包括：
- Hex dump（16 字节/行，显示偏移量 + Hex 值）
- ASCII 显示（不可打印字符显示为 `.`）
- 支持大文件（虚拟滚动，只渲染可见区域）
- 支持复制选中的字节

### 1.2 典型使用场景

1. **二进制消息分析**
   - 查看 WebSocket 二进制消息的原始字节
   - 分析二进制协议格式
   - 调试二进制数据

2. **性能优化**
   - 虚拟滚动，只渲染可见区域
   - 支持大文件（>1MB）不卡顿

---

## 2. 技术方案

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   Hex 查看器架构                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐      ┌──────────────┐             │
│  │  HexViewer   │      │  虚拟滚动    │             │
│  │  (组件)      │ ───► │  (性能优化)  │             │
│  └──────────────┘      └──────────────┘             │
│         │                      │                          │
│         ▼                      ▼                          │
│  ┌──────────────┐      ┌──────────────┐             │
│  │  Hex Dump    │      │   ASCII      │             │
│  │  (左侧)      │      │   (右侧)     │             │
│  └──────────────┘      └──────────────┘             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 HexViewer 组件

**文件**: `src/components/HexViewer.vue`（新增）

```vue
<template>
  <div class="hex-viewer" ref="containerRef">
    <!-- 虚拟滚动容器 -->
    <div class="hex-container" :style="{ height: totalHeight + 'px' }">
      <!-- 可见区域的行 -->
      <div
        v-for="row in visibleRows"
        :key="row.offset"
        class="hex-row"
        :style="{ transform: `translateY(${row.top}px)` }"
      >
        <!-- 偏移量 -->
        <span class="hex-offset">{{ row.offset.toString(16).padStart(8, '0') }}</span>
        
        <!-- Hex 值 -->
        <span class="hex-bytes">
          <span
            v-for="(byte, index) in row.bytes"
            :key="index"
            class="hex-byte"
            :class="{ 'hex-byte-selected': isSelected(row.offset + index) }"
            @click="selectByte(row.offset + index)"
          >
            {{ byte.toString(16).padStart(2, '0') }}
          </span>
        </span>
        
        <!-- ASCII -->
        <span class="hex-ascii">
          <span
            v-for="(byte, index) in row.bytes"
            :key="index"
            class="ascii-char"
            :class="{ 'ascii-char-selected': isSelected(row.offset + index) }"
            @click="selectByte(row.offset + index)"
          >
            {{ byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.' }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Props
const props = defineProps<{
  data: Uint8Array  // 二进制数据
  bytesPerRow?: number  // 每行字节数（默认 16）
}>()

// State
const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(0)
const selectedBytes = ref<Set<number>>(new Set())

// 计算属性
const bytesPerRow = props.bytesPerRow || 16
const totalRows = Math.ceil(props.data.length / bytesPerRow)
const rowHeight = 20  // 每行高度（px）
const totalHeight = totalRows * rowHeight

// 可见区域的行（虚拟滚动）
const visibleRows = computed(() => {
  const startRow = Math.floor(scrollTop.value / rowHeight)
  const endRow = Math.min(
    startRow + Math.ceil(containerHeight.value / rowHeight) + 1,
    totalRows
  )
  
  const rows = []
  for (let i = startRow; i < endRow; i++) {
    const offset = i * bytesPerRow
    const bytes = props.data.slice(offset, offset + bytesPerRow)
    rows.push({
      offset,
      bytes: Array.from(bytes),
      top: i * rowHeight,
    })
  }
  
  return rows
})

// 方法
function isSelected(index: number): boolean {
  return selectedBytes.value.has(index)
}

function selectByte(index: number): void {
  if (selectedBytes.value.has(index)) {
    selectedBytes.value.delete(index)
  } else {
    selectedBytes.value.add(index)
  }
}

function copySelectedBytes(): void {
  const bytes = Array.from(selectedBytes.value)
    .sort((a, b) => a - b)
    .map(index => props.data[index])
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ')
  
  navigator.clipboard.writeText(bytes)
}

// 生命周期
onMounted(() => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
    containerRef.value.addEventListener('scroll', (e) => {
      scrollTop.value = (e.target as HTMLElement).scrollTop
    })
  }
})
</script>

<style scoped>
.hex-viewer {
  height: 100%;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.hex-container {
  position: relative;
}

.hex-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 20px;
  display: flex;
  align-items: center;
}

.hex-offset {
  width: 80px;
  color: var(--color-text-secondary);
}

.hex-bytes {
  width: 400px;
  display: flex;
  gap: 4px;
}

.hex-byte {
  width: 24px;
  text-align: center;
  cursor: pointer;
}

.hex-byte-selected {
  background-color: var(--color-primary);
  color: white;
}

.hex-ascii {
  flex: 1;
  display: flex;
  gap: 1px;
}

.ascii-char {
  width: 8px;
  text-align: center;
  cursor: pointer;
}

.ascii-char-selected {
  background-color: var(--color-primary);
  color: white;
}
</style>
```

### 2.3 虚拟滚动实现

**关键设计决策**：
- 使用 `transform: translateY()` 定位每行（避免重排）
- 只渲染可见区域的行（±1 屏缓冲）
- 监听 `scroll` 事件，更新 `scrollTop`
- 计算可见行：`startRow` 到 `endRow`

**性能优化**：
- 使用 `computed` 缓存可见行
- 使用 `Array.from()` 转换 `Uint8Array`（避免重复转换）
- 使用 `Set` 存储选中的字节（O(1) 查找）

---

## 3. 实现任务分解

### T1: HexViewer 组件（0.5 天）

**文件**:
- `src/components/HexViewer.vue`（新增）

**验收标准**:
- ✅ Hex dump 显示正常（偏移量 + Hex 值 + ASCII）
- ✅ 虚拟滚动正常（只渲染可见区域）
- ✅ 选中字节功能正常
- ✅ 复制选中字节功能正常
- ✅ 大文件（>1MB）不卡顿

---

## 4. 测试计划

### 4.1 功能测试

| 测试场景 | 预期结果 |
|---------|---------|
| Hex dump 显示 | 正确显示偏移量 + Hex 值 + ASCII |
| 虚拟滚动 | 滚动流畅，不卡顿 |
| 选中字节 | 点击选中/取消选中正常 |
| 复制选中字节 | 复制的内容正确 |

### 4.2 性能测试

| 测试场景 | 预期结果 |
|---------|---------|
| 大文件（1MB） | 虚拟滚动正常，不卡顿 |
| 大文件（10MB） | 虚拟滚动正常，不卡顿 |
| 快速滚动 | 不卡顿，不闪烁 |

---

## 5. 总结

**Hex 查看器**是一个**小工作量、高价值**的功能，可以：

1. **查看二进制数据**：Hex dump + ASCII 显示
2. **支持大文件**：虚拟滚动，只渲染可见区域
3. **交互功能**：选中字节 + 复制

**预计工作量**：0.5 人天  
**依赖**：无  
**优先级**：P1（中价值 - 必需功能）  

**技术挑战**：
- 虚拟滚动性能优化
- 大文件渲染不卡顿

**差异化价值**：
- 类似 Wireshark 的 Hex 查看器
- 提升二进制消息分析体验
