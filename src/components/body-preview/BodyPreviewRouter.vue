<template>
  <div class="body-preview-router">
    <!-- 空内容 -->
    <div v-if="!body" class="text-xs text-gray-400 dark:text-gray-500 py-2">
      {{ direction === 'request' ? '（空请求体）' : '（空响应）' }}
    </div>

    <!-- 路由到对应预览组件 -->
    <template v-else>
      <!-- JSON 模式 -->
      <JsonViewer v-if="parsed.mode === 'json'" :data="jsonParsedData" :raw="body" />

      <!-- HTML 模式 -->
      <HtmlViewer v-else-if="parsed.mode === 'html'" :content="body" />

      <!-- 图片模式 -->
      <ImageViewer
        v-else-if="parsed.mode === 'image' && parsed.meta?.dataUrl"
        :data-url="parsed.meta.dataUrl"
        :base64-data="parsed.content"
        :meta="parsed.meta"
      />

      <!-- Hex 模式 -->
      <HexViewer v-else-if="parsed.mode === 'hex'" :base64-data="parsed.content" />

      <!-- 语法高亮模式（XML / CSS / JS / Text） -->
      <CodeViewer
        v-else-if="parsed.mode === 'xml' || parsed.mode === 'css' || parsed.mode === 'js' || parsed.mode === 'text'"
        :content="parsed.content"
        :lang="shikiLang"
      />

      <!-- Binary Info（无法预览） -->
      <div v-else-if="parsed.mode === 'binary-info'" class="text-xs text-gray-500 dark:text-gray-400 py-4 text-center">
        <div class="text-gray-400 mb-1">{{ parsed.content }}</div>
        <div class="text-[10px] text-gray-400">此二进制数据无法预览</div>
      </div>

      <!-- 兜底 -->
      <pre v-else class="text-xs leading-relaxed whitespace-pre-wrap break-all font-mono">{{ body }}</pre>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { parseBody, type PreviewMode } from '../../utils/body-preview-parser'
import { tryParseJson } from '../../utils/json-formatter'
import JsonViewer from './JsonViewer.vue'
import HtmlViewer from './HtmlViewer.vue'
import ImageViewer from './ImageViewer.vue'
import HexViewer from './HexViewer.vue'
import CodeViewer from './CodeViewer.vue'

const props = defineProps<{
  body: string
  contentType: string
  direction: 'request' | 'response'
  /** 手动指定预览模式（可选，覆盖自动检测） */
  forcedMode?: PreviewMode
}>()

const parsed = computed(() => {
  const result = parseBody(props.body, props.contentType)
  if (props.forcedMode) {
    result.mode = props.forcedMode
  }
  return result
})

const jsonParsedData = computed(() => {
  if (parsed.value.mode !== 'json') return null
  const result = tryParseJson(props.body)
  return result.isJson ? result.data : null
})

const shikiLang = computed(() => {
  const mode = parsed.value.mode
  if (mode === 'xml') return 'xml' as const
  if (mode === 'css') return 'css' as const
  if (mode === 'js') return 'javascript' as const
  return 'text' as const
})
</script>
