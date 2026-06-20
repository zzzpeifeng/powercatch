<template>
  <div class="html-viewer">
    <!-- Tab 切换 -->
    <div class="flex items-center gap-1 mb-2">
      <button
        class="text-[11px] px-2 py-1 rounded-t border-b-2"
        :class="activeTab === 'render' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
        @click="activeTab = 'render'"
      >
        渲染预览
      </button>
      <button
        class="text-[11px] px-2 py-1 rounded-t border-b-2"
        :class="activeTab === 'source' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
        @click="activeTab = 'source'"
      >
        源码
      </button>
    </div>

    <!-- 渲染预览 -->
    <div v-if="activeTab === 'render'" class="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      <iframe
        ref="iframeRef"
        :srcdoc="sanitizedHtml"
        sandbox="allow-same-origin"
        class="w-full bg-white"
        style="min-height: 300px; height: 50vh;"
        @load="onIframeLoad"
      />
    </div>

    <!-- 源码 -->
    <div v-else>
      <CodeViewer :content="content" lang="html" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import DOMPurify from 'dompurify'
import CodeViewer from './CodeViewer.vue'

const props = defineProps<{
  content: string
}>()

const activeTab = ref<'render' | 'source'>('render')
const iframeRef = ref<HTMLIFrameElement | null>(null)

const sanitizedHtml = computed(() => {
  // DOMPurify 清洗，允许基本的 HTML/CSS 但禁止脚本
  return DOMPurify.sanitize(props.content, {
    ALLOWED_TAGS: [
      'html', 'head', 'body', 'title', 'meta', 'link', 'style',
      'div', 'span', 'p', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'form', 'input', 'button', 'select', 'option', 'textarea',
      'header', 'footer', 'nav', 'main', 'section', 'article', 'aside',
      'br', 'hr', 'pre', 'code', 'blockquote', 'strong', 'em', 'b', 'i', 'u',
      'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    ],
    ALLOWED_ATTR: [
      'class', 'id', 'style', 'href', 'src', 'alt', 'title', 'type',
      'value', 'placeholder', 'name', 'width', 'height', 'viewBox',
      'fill', 'stroke', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
      'colspan', 'rowspan', 'cellspacing', 'cellpadding', 'border',
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'applet'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
  })
})

function onIframeLoad() {
  // iframe 加载完成，调整高度
  if (iframeRef.value?.contentDocument?.body) {
    const body = iframeRef.value.contentDocument.body
    const height = body.scrollHeight
    if (height > 200) {
      iframeRef.value.style.height = `${Math.min(height + 20, 600)}px`
    }
  }
}
</script>

<style scoped>
:deep(iframe) {
  border: none;
}
</style>
