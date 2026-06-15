/**
 * 导出服务 - 支持 JSON / HTML / TXT 格式导出
 */
import { dialog } from 'electron'
import { writeFileSync } from 'fs'
import type { CompareResult, CaptureRequest, ExportFormat } from '../../src/services/types'

/**
 * 生成 JSON 格式导出内容
 */
function generateJson(
  compareResult: CompareResult,
  requestA: CaptureRequest,
  requestB: CaptureRequest
): string {
  const data = {
    exportedAt: new Date().toISOString(),
    comparison: {
      path: compareResult.path,
      model: compareResult.modelName,
      deviceA: compareResult.deviceA,
      deviceB: compareResult.deviceB,
      analysis: compareResult.analysis,
    },
    requestA: {
      method: requestA.method,
      url: requestA.url,
      statusCode: requestA.statusCode,
      duration: requestA.duration,
      device: requestA.deviceName,
      clientIp: requestA.clientIp,
      requestHeaders: requestA.requestHeaders,
      requestBody: requestA.requestBody,
      responseHeaders: requestA.responseHeaders,
      responseBody: requestA.responseBody,
    },
    requestB: {
      method: requestB.method,
      url: requestB.url,
      statusCode: requestB.statusCode,
      duration: requestB.duration,
      device: requestB.deviceName,
      clientIp: requestB.clientIp,
      requestHeaders: requestB.requestHeaders,
      requestBody: requestB.requestBody,
      responseHeaders: requestB.responseHeaders,
      responseBody: requestB.responseBody,
    },
  }
  return JSON.stringify(data, null, 2)
}

/**
 * 生成 HTML 格式导出内容
 */
function generateHtml(
  compareResult: CompareResult,
  requestA: CaptureRequest,
  requestB: CaptureRequest
): string {
  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const analysisHtml = escapeHtml(compareResult.analysis).replace(/\n/g, '<br>')

  // 尝试格式化 JSON
  let bodyA = requestA.responseBody
  let bodyB = requestB.responseBody
  try { bodyA = JSON.stringify(JSON.parse(bodyA), null, 2) } catch { /* keep original */ }
  try { bodyB = JSON.stringify(JSON.parse(bodyB), null, 2) } catch { /* keep original */ }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>接口对比报告 - ${escapeHtml(compareResult.path)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: white; padding: 24px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header h1 { font-size: 20px; margin-bottom: 8px; }
    .header .meta { color: #666; font-size: 14px; }
    .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h2 { font-size: 16px; margin-bottom: 12px; color: #1a1a1a; border-bottom: 1px solid #eee; padding-bottom: 8px; }
    .analysis { line-height: 1.8; font-size: 14px; }
    .flex { display: flex; gap: 16px; }
    .flex > .card { flex: 1; }
    pre { background: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 4px; }
    .tag-method { background: #dbeafe; color: #1d4ed8; }
    .tag-status { background: #dcfce7; color: #166534; }
    .tag-device { background: #fef3c7; color: #92400e; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>接口对比报告</h1>
      <div class="meta">
        <span class="tag tag-method">${escapeHtml(requestA.method)}</span>
        <span class="tag">${escapeHtml(compareResult.path)}</span>
        <span class="tag tag-device">设备A: ${escapeHtml(compareResult.deviceA.name)}</span>
        <span class="tag tag-device">设备B: ${escapeHtml(compareResult.deviceB.name)}</span>
        <br><br>
        模型: ${escapeHtml(compareResult.modelName)} · 导出时间: ${new Date().toLocaleString('zh-CN')}
      </div>
    </div>

    <div class="card">
      <h2>AI 对比分析结果</h2>
      <div class="analysis">${analysisHtml}</div>
    </div>

    <div class="flex">
      <div class="card">
        <h2>设备 A 响应 - ${escapeHtml(compareResult.deviceA.name)}</h2>
        <p><span class="tag tag-status">${requestA.statusCode || '-'}</span> ${requestA.duration || 0}ms</p>
        <pre>${escapeHtml(bodyA)}</pre>
      </div>
      <div class="card">
        <h2>设备 B 响应 - ${escapeHtml(compareResult.deviceB.name)}</h2>
        <p><span class="tag tag-status">${requestB.statusCode || '-'}</span> ${requestB.duration || 0}ms</p>
        <pre>${escapeHtml(bodyB)}</pre>
      </div>
    </div>

    <div class="footer">PowerCatch · 导出时间 ${new Date().toLocaleString('zh-CN')}</div>
  </div>
</body>
</html>`
}

/**
 * 生成 TXT 格式导出内容
 */
function generateTxt(
  compareResult: CompareResult,
  requestA: CaptureRequest,
  requestB: CaptureRequest
): string {
  const separator = '='.repeat(60)
  const subSeparator = '-'.repeat(40)

  let bodyA = requestA.responseBody
  let bodyB = requestB.responseBody
  try { bodyA = JSON.stringify(JSON.parse(bodyA), null, 2) } catch { /* keep original */ }
  try { bodyB = JSON.stringify(JSON.parse(bodyB), null, 2) } catch { /* keep original */ }

  return `${separator}
接口对比报告
${separator}

请求路径: ${compareResult.path}
请求方法: ${requestA.method}
对比模型: ${compareResult.modelName}
导出时间: ${new Date().toLocaleString('zh-CN')}

${subSeparator}
设备 A: ${compareResult.deviceA.name} (${compareResult.deviceA.ip})
设备 B: ${compareResult.deviceB.name} (${compareResult.deviceB.ip})
${subSeparator}

${separator}
AI 对比分析结果
${separator}

${compareResult.analysis}

${separator}
设备 A 响应内容
${separator}
状态码: ${requestA.statusCode || '-'}
耗时: ${requestA.duration || 0}ms

${bodyA}

${separator}
设备 B 响应内容
${separator}
状态码: ${requestB.statusCode || '-'}
耗时: ${requestB.duration || 0}ms

${bodyB}

${separator}
报告结束
${separator}
`
}

/**
 * 导出对比结果
 * @param format 导出格式
 * @param compareResult AI 对比结果
 * @param requestA 请求 A
 * @param requestB 请求 B
 * @returns 导出是否成功
 */
export async function exportCompareResult(
  format: ExportFormat,
  compareResult: CompareResult,
  requestA: CaptureRequest,
  requestB: CaptureRequest
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    let content: string
    let defaultFilename: string
    let filters: Electron.FileFilter[]

    switch (format) {
      case 'json':
        content = generateJson(compareResult, requestA, requestB)
        defaultFilename = `compare-${Date.now()}.json`
        filters = [{ name: 'JSON', extensions: ['json'] }]
        break
      case 'html':
        content = generateHtml(compareResult, requestA, requestB)
        defaultFilename = `compare-${Date.now()}.html`
        filters = [{ name: 'HTML', extensions: ['html'] }]
        break
      case 'txt':
        content = generateTxt(compareResult, requestA, requestB)
        defaultFilename = `compare-${Date.now()}.txt`
        filters = [{ name: 'Text', extensions: ['txt'] }]
        break
      default:
        return { success: false, error: `不支持的格式: ${format}` }
    }

    const { filePath } = await dialog.showSaveDialog({
      title: '导出对比结果',
      defaultPath: defaultFilename,
      filters,
    })

    if (!filePath) {
      return { success: false, error: '用户取消导出' }
    }

    writeFileSync(filePath, content, 'utf-8')
    return { success: true, filePath }
  } catch (error: any) {
    return { success: false, error: error.message || '导出失败' }
  }
}
