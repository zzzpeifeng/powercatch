/**
 * Diff 结果导出功能
 * 支持 HTML、Markdown、JSON 三种格式
 */
import type { CaptureRequest, DiffResult } from './types'

/**
 * 格式化值显示
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

/**
 * 导出 Diff 结果为 HTML
 */
export function exportDiffAsHtml(req1: CaptureRequest, req2: CaptureRequest, diff: DiffResult): string {
  const stats = diff.overview.stats
  const totalAdded = stats.requestHeaders.added + stats.responseHeaders.added
  const totalRemoved = stats.requestHeaders.removed + stats.responseHeaders.removed
  const totalModified = stats.requestHeaders.modified + stats.responseHeaders.modified

  // 构建差异列表 HTML
  let highlightsHtml = ''
  const highlights: Array<{ type: string; badge: string; label: string }> = []
  
  if (stats.requestHeaders.added > 0) highlights.push({ type: 'added', badge: '新增', label: `请求头新增 ${stats.requestHeaders.added} 项` })
  if (stats.requestHeaders.removed > 0) highlights.push({ type: 'removed', badge: '删除', label: `请求头删除 ${stats.requestHeaders.removed} 项` })
  if (stats.requestHeaders.modified > 0) highlights.push({ type: 'changed', badge: '修改', label: `请求头修改 ${stats.requestHeaders.modified} 项` })
  if (stats.requestBody.changes > 0) highlights.push({ type: 'changed', badge: '修改', label: `请求体有 ${stats.requestBody.changes} 处差异` })
  if (stats.responseHeaders.added > 0) highlights.push({ type: 'added', badge: '新增', label: `响应头新增 ${stats.responseHeaders.added} 项` })
  if (stats.responseHeaders.removed > 0) highlights.push({ type: 'removed', badge: '删除', label: `响应头删除 ${stats.responseHeaders.removed} 项` })
  if (stats.responseHeaders.modified > 0) highlights.push({ type: 'changed', badge: '修改', label: `响应头修改 ${stats.responseHeaders.modified} 项` })
  if (stats.responseBody.changes > 0) highlights.push({ type: 'changed', badge: '修改', label: `响应体有 ${stats.responseBody.changes} 处差异` })

  for (const item of highlights) {
    const color = item.type === 'added' ? '#4ade80' : item.type === 'removed' ? '#f87171' : '#fbbf24'
    highlightsHtml += `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;background:#2d2d2d;margin-bottom:8px;">
      <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:${color}22;color:${color}">${item.badge}</span>
      <span>${item.label}</span>
    </div>`
  }

  // 构建 Headers 对比 HTML
  function buildHeadersHtml(title: string, headersDiff: DiffResult['requestHeaders']): string {
    if (Object.keys(headersDiff.added).length === 0 && Object.keys(headersDiff.removed).length === 0 && headersDiff.modified.length === 0) {
      return `<h3 style="margin-top:24px;color:#4ade80;">✅ ${title} 完全相同</h3>`
    }

    let rows = ''
    for (const [key, value] of Object.entries(headersDiff.removed)) {
      rows += `<tr style="background:rgba(248,113,113,0.08);">
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #3d3d3d;">${key}</td>
        <td style="padding:8px 12px;color:#f87171;text-decoration:line-through;border-bottom:1px solid #3d3d3d;">${value}</td>
        <td style="padding:8px 12px;color:#666;border-bottom:1px solid #3d3d3d;">—</td>
      </tr>`
    }
    for (const item of headersDiff.modified) {
      rows += `<tr style="background:rgba(251,191,36,0.08);">
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #3d3d3d;">${item.key}</td>
        <td style="padding:8px 12px;color:#f87171;text-decoration:line-through;border-bottom:1px solid #3d3d3d;">${item.old}</td>
        <td style="padding:8px 12px;color:#4ade80;border-bottom:1px solid #3d3d3d;">${item.new}</td>
      </tr>`
    }
    for (const [key, value] of Object.entries(headersDiff.added)) {
      rows += `<tr style="background:rgba(74,222,128,0.08);">
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #3d3d3d;">${key}</td>
        <td style="padding:8px 12px;color:#666;border-bottom:1px solid #3d3d3d;">—</td>
        <td style="padding:8px 12px;color:#4ade80;border-bottom:1px solid #3d3d3d;">${value}</td>
      </tr>`
    }

    return `<h3 style="margin-top:24px;">${title}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#1a1a1a;">
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #3d3d3d;width:200px;">Header Name</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #3d3d3d;">请求 1</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #3d3d3d;">请求 2</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  // 构建 Body 对比 HTML
  function buildBodyHtml(title: string, bodyDiff: DiffResult['requestBody']): string {
    if (bodyDiff.type === 'empty') {
      return `<h3 style="margin-top:24px;">${title}</h3><p style="color:#666;">无内容</p>`
    }
    if (bodyDiff.type === 'binary') {
      return `<h3 style="margin-top:24px;">${title}</h3><p style="color:#666;">无法对比二进制内容</p>`
    }
    if (bodyDiff.type === 'json' && bodyDiff.delta) {
      let rows = ''
      for (const item of bodyDiff.delta) {
        const color = item.type === 'added' ? '#4ade80' : item.type === 'removed' ? '#f87171' : '#fbbf24'
        let changeHtml = ''
        if (item.type === 'modified') {
          changeHtml = `<span style="color:#f87171;text-decoration:line-through;">${formatValue(item.oldValue)}</span> → <span style="color:#4ade80;">${formatValue(item.newValue)}</span>`
        } else if (item.type === 'added') {
          changeHtml = `<span style="color:#4ade80;">+ ${formatValue(item.newValue)}</span>`
        } else {
          changeHtml = `<span style="color:#f87171;">- ${formatValue(item.oldValue)}</span>`
        }
        rows += `<tr style="background:${color}11;">
          <td style="padding:6px 12px;font-family:monospace;color:#60a5fa;border-bottom:1px solid #3d3d3d;">${item.path}</td>
          <td style="padding:6px 12px;font-family:monospace;border-bottom:1px solid #3d3d3d;">${changeHtml}</td>
        </tr>`
      }
      return `<h3 style="margin-top:24px;">${title}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#1a1a1a;">
              <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #3d3d3d;width:200px;">路径</th>
              <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #3d3d3d;">变更</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
    }
    if (bodyDiff.type === 'text' && bodyDiff.changes) {
      let rows = ''
      for (let i = 0; i < bodyDiff.changes.length; i++) {
        const line = bodyDiff.changes[i]
        const bg = line.added ? 'rgba(74,222,128,0.08)' : line.removed ? 'rgba(248,113,113,0.08)' : 'transparent'
        rows += `<tr style="background:${bg};">
          <td style="padding:4px 12px;color:#666;text-align:right;border-bottom:1px solid #3d3d3d;">${i + 1}</td>
          <td style="padding:4px 12px;font-family:monospace;white-space:pre-wrap;border-bottom:1px solid #3d3d3d;">${line.value}</td>
        </tr>`
      }
      return `<h3 style="margin-top:24px;">${title}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tbody>${rows}</tbody>
        </table>`
    }
    return `<h3 style="margin-top:24px;">${title}</h3><p style="color:#666;">无差异</p>`
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Diff Report - ${new Date().toLocaleString()}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;background:#1a1a1a;color:#f0f0f0;padding:24px;max-width:1200px;margin:0 auto;">
  <h1 style="margin-bottom:24px;">Diff 对比报告</h1>
  <p style="color:#999;margin-bottom:24px;">生成时间: ${new Date().toLocaleString()}</p>
  
  <div style="display:flex;gap:16px;margin-bottom:24px;">
    <div style="flex:1;padding:12px 16px;background:#2d2d2d;border-radius:8px;">
      <div style="font-size:11px;color:#999;margin-bottom:4px;">请求 1</div>
      <div style="font-weight:600;">${req1.method} ${req1.path}</div>
      <div style="font-size:12px;color:#999;">${req1.statusCode} · ${req1.duration}ms</div>
    </div>
    <div style="flex:1;padding:12px 16px;background:#2d2d2d;border-radius:8px;">
      <div style="font-size:11px;color:#999;margin-bottom:4px;">请求 2</div>
      <div style="font-weight:600;">${req2.method} ${req2.path}</div>
      <div style="font-size:12px;color:#999;">${req2.statusCode} · ${req2.duration}ms</div>
    </div>
  </div>
  
  <div style="display:flex;gap:16px;margin-bottom:24px;">
    <div style="flex:1;padding:16px;background:#2d2d2d;border-radius:8px;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#4ade80;">+${totalAdded}</div>
      <div style="font-size:12px;color:#999;">新增</div>
    </div>
    <div style="flex:1;padding:16px;background:#2d2d2d;border-radius:8px;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#f87171;">-${totalRemoved}</div>
      <div style="font-size:12px;color:#999;">删除</div>
    </div>
    <div style="flex:1;padding:16px;background:#2d2d2d;border-radius:8px;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#fbbf24;">~${totalModified}</div>
      <div style="font-size:12px;color:#999;">修改</div>
    </div>
  </div>
  
  <div style="background:#2d2d2d;border-radius:8px;padding:16px;margin-bottom:24px;">
    <h3 style="margin-bottom:12px;">📊 差异概览</h3>
    ${highlightsHtml || '<p style="color:#4ade80;">✅ 两个请求完全相同</p>'}
  </div>
  
  ${buildHeadersHtml('📋 请求头对比', diff.requestHeaders)}
  ${buildBodyHtml('📄 请求体对比', diff.requestBody)}
  ${buildHeadersHtml('📋 响应头对比', diff.responseHeaders)}
  ${buildBodyHtml('📄 响应体对比', diff.responseBody)}
</body>
</html>`
}

/**
 * 导出 Diff 结果为 Markdown
 */
export function exportDiffAsMarkdown(req1: CaptureRequest, req2: CaptureRequest, diff: DiffResult): string {
  const stats = diff.overview.stats
  const totalAdded = stats.requestHeaders.added + stats.responseHeaders.added
  const totalRemoved = stats.requestHeaders.removed + stats.responseHeaders.removed
  const totalModified = stats.requestHeaders.modified + stats.responseHeaders.modified

  let md = `# Diff 对比报告\n\n`
  md += `生成时间: ${new Date().toLocaleString()}\n\n`
  md += `## 请求信息\n\n`
  md += `| | 请求 1 | 请求 2 |\n`
  md += `|---|---|---|\n`
  md += `| 方法 | ${req1.method} | ${req2.method} |\n`
  md += `| URL | ${req1.path} | ${req2.path} |\n`
  md += `| 状态码 | ${req1.statusCode} | ${req2.statusCode} |\n`
  md += `| 耗时 | ${req1.duration}ms | ${req2.duration}ms |\n\n`
  md += `## 统计\n\n`
  md += `- 🟢 新增: +${totalAdded}\n`
  md += `- 🔴 删除: -${totalRemoved}\n`
  md += `- 🟡 修改: ~${totalModified}\n\n`

  // Headers 对比
  function buildHeadersMd(title: string, headersDiff: DiffResult['requestHeaders']): string {
    if (Object.keys(headersDiff.added).length === 0 && Object.keys(headersDiff.removed).length === 0 && headersDiff.modified.length === 0) {
      return `### ${title}\n\n✅ 完全相同\n\n`
    }
    let result = `### ${title}\n\n`
    result += `| Header | 请求 1 | 请求 2 | 状态 |\n`
    result += `|---|---|---|---|\n`
    for (const [key, value] of Object.entries(headersDiff.removed)) {
      result += `| ${key} | ${value} | — | 🟢 删除 |\n`
    }
    for (const item of headersDiff.modified) {
      result += `| ${item.key} | ${item.old} | ${item.new} | 🟡 修改 |\n`
    }
    for (const [key, value] of Object.entries(headersDiff.added)) {
      result += `| ${key} | — | ${value} | 🔴 新增 |\n`
    }
    return result + '\n'
  }

  md += buildHeadersMd('请求头对比', diff.requestHeaders)
  md += buildHeadersMd('响应头对比', diff.responseHeaders)

  return md
}

/**
 * 导出 Diff 结果为 JSON
 */
export function exportDiffAsJson(req1: CaptureRequest, req2: CaptureRequest, diff: DiffResult): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    request1: {
      method: req1.method,
      url: req1.url,
      path: req1.path,
      statusCode: req1.statusCode,
      duration: req1.duration,
    },
    request2: {
      method: req2.method,
      url: req2.url,
      path: req2.path,
      statusCode: req2.statusCode,
      duration: req2.duration,
    },
    diff: diff,
  }, null, 2)
}

/**
 * 下载文件
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 导出 Diff 结果
 */
export function exportDiff(
  req1: CaptureRequest, 
  req2: CaptureRequest, 
  diff: DiffResult, 
  format: 'html' | 'markdown' | 'json'
): void {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  const filename = `diff-${timestamp}`
  
  switch (format) {
    case 'html':
      downloadFile(exportDiffAsHtml(req1, req2, diff), `${filename}.html`, 'text/html')
      break
    case 'markdown':
      downloadFile(exportDiffAsMarkdown(req1, req2, diff), `${filename}.md`, 'text/markdown')
      break
    case 'json':
      downloadFile(exportDiffAsJson(req1, req2, diff), `${filename}.json`, 'application/json')
      break
  }
}
