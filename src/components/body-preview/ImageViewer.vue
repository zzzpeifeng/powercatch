<template>
  <div class="image-viewer">
    <div v-if="!dataUrl" class="text-center py-8 text-gray-400 text-sm">
      无法加载图片
    </div>
    <template v-else>
      <!-- 图片预览 -->
      <div class="flex items-center justify-center border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-white dark:bg-gray-900" style="max-height: 50vh; overflow: auto;">
        <img
          ref="imgRef"
          :src="dataUrl"
          :alt="meta?.contentType || 'image'"
          class="max-w-full max-h-[45vh] object-contain"
          @load="onImageLoad"
          @error="onImageError"
        />
      </div>

      <!-- 元信息面板 -->
      <div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div class="text-[11px] px-2 py-1.5 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-800">
          <span class="text-gray-400">类型</span>
          <span class="ml-1 text-gray-700 dark:text-gray-300">{{ meta?.contentType || 'unknown' }}</span>
        </div>
        <div class="text-[11px] px-2 py-1.5 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-800">
          <span class="text-gray-400">大小</span>
          <span class="ml-1 text-gray-700 dark:text-gray-300">{{ formattedSize }}</span>
        </div>
        <div v-if="imageWidth > 0" class="text-[11px] px-2 py-1.5 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-800">
          <span class="text-gray-400">尺寸</span>
          <span class="ml-1 text-gray-700 dark:text-gray-300">{{ imageWidth }} x {{ imageHeight }}</span>
        </div>
        <div class="text-[11px] px-2 py-1.5 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-800">
          <span class="text-gray-400">Base64</span>
          <span class="ml-1 text-gray-700 dark:text-gray-300">{{ formattedBase64Len }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatFileSize } from '../../utils/body-preview-parser'

const props = defineProps<{
  dataUrl: string
  base64Data: string
  meta?: {
    contentType?: string
    size?: number
    isBinary?: boolean
    dataUrl?: string
  }
}>()

const imgRef = ref<HTMLImageElement | null>(null)
const imageWidth = ref(0)
const imageHeight = ref(0)

const formattedSize = computed(() => {
  if (props.meta?.size) return formatFileSize(props.meta.size)
  return 'unknown'
})

const formattedBase64Len = computed(() => {
  const len = props.base64Data?.length || 0
  if (len < 1024) return `${len} 字符`
  if (len < 1024 * 1024) return `${(len / 1024).toFixed(1)}K 字符`
  return `${(len / (1024 * 1024)).toFixed(1)}M 字符`
})

function onImageLoad() {
  if (imgRef.value) {
    imageWidth.value = imgRef.value.naturalWidth
    imageHeight.value = imgRef.value.naturalHeight
  }
}

function onImageError() {
  imageWidth.value = 0
  imageHeight.value = 0
}
</script>
