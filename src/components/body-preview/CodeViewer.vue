<template>
  <div class="code-viewer">
    <div v-if="loading" class="flex items-center justify-center py-8 text-gray-400 text-sm">
      <svg class="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      语法高亮加载中...
    </div>
    <div v-else-if="truncated" class="text-xs">
      <div class="flex items-center justify-between mb-2">
        <span class="text-gray-400">内容过大，已截断显示（{{ formatSize(content.length) }}）</span>
        <button
          class="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
          @click="showFull"
        >
          加载完整内容
        </button>
      </div>
      <div class="code-container" v-html="highlightedHtml" />
    </div>
    <div v-else class="code-container" v-html="highlightedHtml" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { createHighlighter, type HighlighterGeneric } from 'shiki'

const props = defineProps<{
  content: string
  lang: 'xml' | 'css' | 'javascript' | 'html' | 'text'
}>()

const loading = ref(true)
const highlightedHtml = ref('')
const truncated = ref(false)
const showTruncated = ref(true)

const TRUNCATE_THRESHOLD = 50 * 1024 // 50KB

// 模块级单例，所有 CodeViewer 实例共享
let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null

function getSharedHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],
      langs: ['xml', 'css', 'javascript', 'html', 'text'],
    })
  }
  return highlighterPromise
}

const LANG_MAP: Record<string, string> = {
  xml: 'xml',
  css: 'css',
  javascript: 'javascript',
  html: 'html',
  text: 'text',
}

function formatSize(len: number): string {
  if (len < 1024) return `${len} B`
  if (len < 1024 * 1024) return `${(len / 1024).toFixed(1)} KB`
  return `${(len / (1024 * 1024)).toFixed(2)} MB`
}

async function highlight(code: string, lang: string) {
  try {
    const hl = await getSharedHighlighter()
    const resolvedLang = LANG_MAP[lang] || 'text'
    const loadedLangs = hl.getLoadedLanguages()
    if (!loadedLangs.includes(resolvedLang)) {
      await hl.loadLanguage(resolvedLang as any)
    }
    highlightedHtml.value = hl.codeToHtml(code, {
      lang: resolvedLang,
      theme: 'github-dark',
    })
  } catch {
    // 降级为纯文本
    highlightedHtml.value = escapeHtml(code)
  } finally {
    loading.value = false
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function doHighlight() {
  const codeToSend = showTruncated.value && props.content.length > TRUNCATE_THRESHOLD
    ? props.content.slice(0, TRUNCATE_THRESHOLD)
    : props.content
  truncated.value = showTruncated.value && props.content.length > TRUNCATE_THRESHOLD
  loading.value = true
  highlightedHtml.value = ''
  highlight(codeToSend, props.lang)
}

function showFull() {
  showTruncated.value = false
  doHighlight()
}

watch(() => [props.content, props.lang], () => {
  showTruncated.value = true
  doHighlight()
})

onMounted(() => {
  doHighlight()
})
</script>

<style scoped>
.code-container {
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
  tab-size: 2;
}

.code-container :deep(pre) {
  margin: 0;
  padding: 0;
  background: transparent !important;
}

.code-container :deep(code) {
  font-family: inherit;
  font-size: inherit;
}
</style>
