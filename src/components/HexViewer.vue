<template>
  <div class="hex-viewer h-full overflow-auto font-mono text-xs" @scroll="onScroll">
    <div v-if="lines.length === 0" class="p-3 text-[var(--color-text-secondary)]">
      暂无数据
    </div>
    <table v-else class="w-full">
      <tbody>
        <tr v-for="line in visibleLines" :key="line.offset" class="hover:bg-[var(--color-surface)]">
          <td class="px-2 py-0.5 text-[var(--color-text-secondary)] select-none w-20">{{ formatOffset(line.offset) }}</td>
          <td class="px-2 py-0.5 select-none w-72">
            <span v-for="(byte, idx) in line.hex" :key="idx" class="inline-block w-6">{{ byte }} </span>
          </td>
          <td class="px-2 py-0.5 text-[var(--color-text)]">
            {{ line.ascii }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{
  data: string  // Base64 编码的二进制数据
}>()

const lines = ref<Array<{ offset: number; hex: string[]; ascii: string }>>([])
const scrollTop = ref(0)
const containerHeight = ref(0)

// 每行显示 16 字节
const BYTES_PER_LINE = 16
// 行高（像素）
const LINE_HEIGHT = 20

// 计算可见行
const visibleLines = computed(() => {
  if (lines.value.length === 0) return []

  const startIdx = Math.floor(scrollTop.value / LINE_HEIGHT)
  const visibleCount = Math.ceil(containerHeight.value / LINE_HEIGHT) + 2
  const endIdx = Math.min(startIdx + visibleCount, lines.value.length)

  return lines.value.slice(startIdx, endIdx)
})

onMounted(() => {
  parseData()
})

// 解析 Base64 数据
function parseData(): void {
  try {
    const binaryStr = atob(props.data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }

    const result: Array<{ offset: number; hex: string[]; ascii: string }> = []
    for (let i = 0; i < bytes.length; i += BYTES_PER_LINE) {
      const chunk = bytes.slice(i, i + BYTES_PER_LINE)
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0').toUpperCase())
      // 补齐 16 字节的 hex 显示
      while (hex.length < BYTES_PER_LINE) {
        hex.push('  ')
      }

      const ascii = Array.from(chunk)
        .map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.')
        .join('')

      result.push({
        offset: i,
        hex,
        ascii,
      })
    }

    lines.value = result
  } catch (e) {
    console.error('HexViewer: 解析数据失败', e)
  }
}

function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, '0')
}

function onScroll(e: Event): void {
  const target = e.target as HTMLElement
  scrollTop.value = target.scrollTop
}

// 监听容器大小变化
onMounted(() => {
  const container = document.querySelector('.hex-viewer') as HTMLElement
  if (container) {
    containerHeight.value = container.clientHeight

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(container)
  }
})
</script>
