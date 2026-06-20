<template>
  <div class="hex-viewer">
    <div v-if="!decodedBytes.length" class="text-center py-8 text-gray-400 text-sm">
      无数据
    </div>
    <template v-else>
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[11px] text-gray-400">{{ decodedBytes.length }} 字节</span>
        <span v-if="truncated" class="text-[11px] text-yellow-500">（仅显示前 {{ MAX_DISPLAY }} 字节）</span>
      </div>
      <div class="hex-container border border-gray-200 dark:border-gray-700 rounded-md overflow-auto font-mono text-xs" style="max-height: 50vh;">
        <table class="w-full">
          <tbody>
            <tr v-for="(row, rowIdx) in displayRows" :key="rowIdx" class="hover:bg-gray-50 dark:hover:bg-gray-800">
              <!-- 偏移量 -->
              <td class="hex-offset px-2 py-0.5 text-gray-400 select-none whitespace-nowrap">{{ formatOffset(rowIdx) }}</td>
              <!-- Hex -->
              <td class="hex-bytes px-2 py-0.5 whitespace-pre">
                <span
                  v-for="(byte, byteIdx) in row"
                  :key="byteIdx"
                  :class="byteClass(byte)"
                  class="inline-block w-[1.8em] text-center"
                >{{ formatHex(byte) }}</span>
              </td>
              <!-- ASCII -->
              <td class="hex-ascii px-2 py-0.5 whitespace-pre text-gray-500 dark:text-gray-400">
                <span
                  v-for="(byte, byteIdx) in row"
                  :key="byteIdx"
                  :class="asciiClass(byte)"
                >{{ formatAscii(byte) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** base64 编码的数据 */
  base64Data: string
}>()

const BYTES_PER_ROW = 16
const MAX_DISPLAY = 100 * 1024 // 100KB

const decodedBytes = computed(() => {
  try {
    const binary = atob(props.base64Data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return new Uint8Array(0)
  }
})

const truncated = computed(() => decodedBytes.value.length > MAX_DISPLAY)

const displayBytes = computed(() => {
  return truncated.value ? decodedBytes.value.slice(0, MAX_DISPLAY) : decodedBytes.value
})

const displayRows = computed(() => {
  const rows: Uint8Array[] = []
  const bytes = displayBytes.value
  for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
    rows.push(bytes.slice(i, i + BYTES_PER_ROW))
  }
  return rows
})

function formatOffset(rowIdx: number): string {
  return (rowIdx * BYTES_PER_ROW).toString(16).padStart(8, '0')
}

function formatHex(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase()
}

function formatAscii(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
}

function byteClass(byte: number): string {
  if (byte === 0) return 'text-gray-300 dark:text-gray-600' // null
  if (byte >= 0x20 && byte <= 0x7e) return 'text-green-600 dark:text-green-400' // printable ASCII
  return ''
}

function asciiClass(byte: number): string {
  if (byte === 0) return 'text-gray-300 dark:text-gray-600'
  if (byte >= 0x20 && byte <= 0x7e) return 'text-gray-700 dark:text-gray-300'
  return 'text-gray-400 dark:text-gray-500'
}
</script>

<style scoped>
.hex-container {
  background: var(--color-bg, #fff);
}

:root.dark .hex-container {
  background: var(--color-bg, #1f2937);
}
</style>
