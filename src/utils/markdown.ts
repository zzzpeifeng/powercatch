import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

/**
 * 渲染 Markdown 为安全的 HTML
 */
export function renderMarkdown(text: string): string {
  if (!text) return ''
  let html = md.render(text)
  // 给表格加横向滚动容器
  html = html.replace(/<table>/g, '<div class="md-table-wrapper"><table class="md-table">')
  html = html.replace(/<\/table>/g, '</table></div>')
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled', 'class'],
  })
}

/**
 * 渲染行内 Markdown
 */
export function renderInlineMarkdown(text: string): string {
  if (!text) return ''
  const html = md.renderInline(text)
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled', 'class'],
  })
}
