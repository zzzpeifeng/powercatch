/**
 * 多格式导出服务
 * 支持 cURL、Postman Collection v2.1、JMeter JMX、fetch、Python requests
 */
import type { CaptureRequest, HttpHeaders } from './types'
import { generateCurl } from '../utils/curl-generator'

// ============================================================
// 工具函数
// ============================================================

/** 下载文件到本地（浏览器方式） */
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

/** 将 headers 对象转为 [{ key, value, description }] 数组 */
function headersToArray(headers: HttpHeaders): Array<{ key: string; value: string; description?: string }> {
  const result: Array<{ key: string; value: string; description?: string }> = []
  if (!headers) return result
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      result.push({ key, value: Array.isArray(value) ? value.join(', ') : String(value) })
    }
  }
  return result
}

/** 解析请求体，尝试解码 Base64 */
function decodeBody(body: string): string {
  if (!body) return ''
  if (body.startsWith('[Base64:')) {
    try {
      const match = body.match(/^\[Base64:([^:]+):(\d+):(.+)\]$/s)
      if (match) {
        const decoded = Buffer.from(match[3], 'base64').toString('utf-8')
        // 检查是否为合法文本
        let controlCount = 0
        for (let i = 0; i < decoded.length; i++) {
          const code = decoded.charCodeAt(i)
          if ((code <= 0x08) || (code >= 0x0B && code <= 0x0C) || (code >= 0x0E && code <= 0x1F) || code === 0x7F) {
            controlCount++
          }
        }
        if (controlCount / decoded.length < 0.1) return decoded
      }
    } catch { /* ignore */ }
  }
  return body
}

/** 获取请求的 Content-Type */
function getContentType(headers: HttpHeaders): string {
  if (!headers) return ''
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type' && value !== undefined) {
      return Array.isArray(value) ? value[0] : String(value)
    }
  }
  return ''
}

/** 转义 XML 特殊字符 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ============================================================
// cURL（复用现有函数）
// ============================================================

export { generateCurl }

// ============================================================
// Postman Collection v2.1
// ============================================================

interface PostmanCollection {
  info: {
    name: string
    description: string
    schema: string
  }
  item: PostmanItem[]
}

interface PostmanItem {
  name: string
  request: {
    method: string
    header: Array<{ key: string; value: string }>
    url: {
      raw: string
      protocol: string
      host: string[]
      path: string[]
      query?: Array<{ key: string; value: string }>
    }
    body?: {
      mode: string
      raw: string
    }
  }
}

/**
 * 生成 Postman Collection v2.1 格式
 * @param requests 请求列表
 * @returns Postman Collection 对象（可直接 JSON.stringify）
 */
export function generatePostmanCollection(requests: CaptureRequest[]): PostmanCollection {
  const items: PostmanItem[] = requests.map((req) => {
    // 解析 URL
    let urlObj: URL
    try {
      urlObj = new URL(req.url)
    } catch {
      // fallback: 构造简单 URL
      urlObj = new URL(`https://${req.host || 'localhost'}${req.path || '/'}`)
    }

    const protocol = urlObj.protocol.replace(':', '')
    const host = urlObj.hostname.split('.')
    const path = urlObj.pathname.split('/').filter(Boolean)
    const query: Array<{ key: string; value: string }> = []
    urlObj.searchParams.forEach((value, key) => {
      query.push({ key, value })
    })

    const item: PostmanItem = {
      name: `${req.method} ${req.path || req.url}`,
      request: {
        method: req.method,
        header: headersToArray(req.requestHeaders).map(h => ({ key: h.key, value: h.value })),
        url: {
          raw: req.url,
          protocol,
          host,
          path,
          ...(query.length > 0 ? { query } : {}),
        },
      },
    }

    // 请求体
    if (req.requestBody) {
      const decoded = decodeBody(req.requestBody)
      item.request.body = {
        mode: 'raw',
        raw: decoded,
      }
    }

    return item
  })

  return {
    info: {
      name: `PowerCatch Export - ${new Date().toLocaleString('zh-CN')}`,
      description: `从 PowerCatch 导出的 ${requests.length} 个请求`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  }
}

/**
 * 导出为 Postman Collection 文件
 */
export function exportPostmanCollection(requests: CaptureRequest[]): void {
  const collection = generatePostmanCollection(requests)
  const json = JSON.stringify(collection, null, 2)
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  downloadFile(json, `powercatch-postman-${timestamp}.json`, 'application/json')
}

// ============================================================
// JMeter 脚本 (JMX)
// ============================================================

/**
 * 生成 JMeter JMX 格式脚本
 * @param requests 请求列表
 * @returns JMX XML 字符串
 */
export function generateJmeterScript(requests: CaptureRequest[]): string {
  const timestamp = Date.now()

  // 生成 HTTP Sampler 元素
  const samplers = requests.map((req, index) => {
    let urlObj: URL
    try {
      urlObj = new URL(req.url)
    } catch {
      urlObj = new URL(`https://${req.host || 'localhost'}${req.path || '/'}`)
    }

    const protocol = urlObj.protocol.replace(':', '')
    const domain = urlObj.hostname
    const port = urlObj.port || (protocol === 'https' ? '443' : '80')
    const path = urlObj.pathname + urlObj.search
    const isHttps = protocol === 'https'

    // 请求头
    const headerEntries = headersToArray(req.requestHeaders)
      .map(h => `            <elementProp name="" elementType="HTTPArgument">
              <boolProp name="HTTPArgument.always_encode">${escapeXml(h.value.includes('&') || h.value.includes('<') ? 'true' : 'false')}</boolProp>
              <stringProp name="Argument.value">${escapeXml(h.value)}</stringProp>
              <stringProp name="Argument.metadata">=</stringProp>
              <stringProp name="Argument.name">${escapeXml(h.key)}</stringProp>
            </elementProp>`)
      .join('\n')

    // 请求体
    let bodyConfig = ''
    if (req.requestBody) {
      const decoded = decodeBody(req.requestBody)
      bodyConfig = `
          <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${escapeXml(decoded)}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`
    }

    return `        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${escapeXml(req.method)} ${escapeXml(req.path)}" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>
          <stringProp name="HTTPSampler.domain">${escapeXml(domain)}</stringProp>
          <stringProp name="HTTPSampler.port">${escapeXml(port)}</stringProp>
          <stringProp name="HTTPSampler.protocol">${escapeXml(protocol)}</stringProp>
          <stringProp name="HTTPSampler.path">${escapeXml(path)}</stringProp>
          <stringProp name="HTTPSampler.method">${escapeXml(req.method)}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
          <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
          <stringProp name="HTTPSampler.implementation">HttpClient4</stringProp>
          <boolProp name="HTTPSampler.DO_POST">${req.requestBody ? 'true' : 'false'}</boolProp>${bodyConfig}
          <stringProp name="HTTPSampler.embedded_url_re"></stringProp>
          <stringProp name="HTTPSampler.connect_timeout"></stringProp>
          <stringProp name="HTTPSampler.response_timeout"></stringProp>
        </HTTPSamplerProxy>
        <hashTree/>
        <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="状态码断言" enabled="true">
          <collectionProp name="Asserion.test_strings">
            <stringProp name="499">200</stringProp>
          </collectionProp>
          <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
          <boolProp name="Assertion.assume_success">false</boolProp>
          <intProp name="Assertion.test_type">8</intProp>
        </ResponseAssertion>
        <hashTree/>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="PowerCatch 导出计划" enabled="true">
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
      <stringProp name="TestPlan.comments">从 PowerCatch 导出，生成时间: ${new Date().toLocaleString('zh-CN')}</stringProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="请求组" enabled="true">
        <intProp name="ThreadGroup.num_threads">1</intProp>
        <intProp name="ThreadGroup.ramp_time">1</intProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
        <stringProp name="ThreadGroup.delay"></stringProp>
        <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">1</stringProp>
        </elementProp>
      </ThreadGroup>
      <hashTree>
${samplers.join('\n')}
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`
}

/**
 * 导出为 JMeter JMX 文件
 */
export function exportJmeterScript(requests: CaptureRequest[]): void {
  const jmx = generateJmeterScript(requests)
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  downloadFile(jmx, `powercatch-jmeter-${timestamp}.jmx`, 'application/xml')
}

// ============================================================
// JavaScript fetch
// ============================================================

/**
 * 生成 JavaScript fetch 代码
 * @param request 单个请求
 * @returns fetch 代码字符串
 */
export function generateFetchCode(request: CaptureRequest): string {
  const parts: string[] = []

  // 构造 options
  const options: Record<string, any> = {}
  if (request.method && request.method !== 'GET') {
    options.method = request.method
  }

  // Headers
  if (request.requestHeaders && Object.keys(request.requestHeaders).length > 0) {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(request.requestHeaders)) {
      if (value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
      }
    }
    if (Object.keys(headers).length > 0) {
      options.headers = headers
    }
  }

  // Body
  if (request.requestBody) {
    const decoded = decodeBody(request.requestBody)
    const contentType = getContentType(request.requestHeaders)
    if (contentType.includes('application/json')) {
      options.body = JSON.stringify(JSON.parse(decoded))
    } else {
      options.body = decoded
    }
  }

  // 生成代码
  const optionsStr = JSON.stringify(options, null, 2)
    .replace(/"([^"]+)":/g, '$1:')  // 移除 key 的引号
    .replace(/"/g, "'")             // 双引号换单引号

  parts.push(`const response = await fetch('${request.url}', ${optionsStr.replace(/\n/g, '\n  ')});`)
  parts.push('')
  parts.push('const data = await response.json();')
  parts.push('console.log(data);')

  return parts.join('\n')
}

/**
 * 导出 fetch 代码（复制到剪贴板）
 */
export async function exportFetchCode(request: CaptureRequest): Promise<boolean> {
  const code = generateFetchCode(request)
  try {
    await navigator.clipboard.writeText(code)
    return true
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = code
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    return true
  }
}

// ============================================================
// Python requests
// ============================================================

/**
 * 生成 Python requests 代码
 * @param request 单个请求
 * @returns Python requests 代码字符串
 */
export function generatePythonRequests(request: CaptureRequest): string {
  const parts: string[] = ['import requests', '']

  // Headers
  const hasHeaders = request.requestHeaders && Object.keys(request.requestHeaders).length > 0
  if (hasHeaders) {
    parts.push('headers = {')
    for (const [key, value] of Object.entries(request.requestHeaders)) {
      if (value !== undefined) {
        const headerValue = Array.isArray(value) ? value.join(', ') : String(value)
        parts.push(`    "${key}": "${headerValue.replace(/"/g, '\\"')}",`)
      }
    }
    parts.push('}')
    parts.push('')
  }

  // Body
  let bodyVar = ''
  if (request.requestBody) {
    const decoded = decodeBody(request.requestBody)
    const contentType = getContentType(request.requestHeaders)

    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(decoded)
        parts.push(`payload = ${JSON.stringify(parsed, null, 4).replace(/null/g, 'None').replace(/true/g, 'True').replace(/false/g, 'False')}`)
      } catch {
        parts.push(`payload = """${decoded}"""`)
      }
      bodyVar = 'json=payload'
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const params = new URLSearchParams(decoded)
        parts.push('data = {')
        params.forEach((v, k) => {
          parts.push(`    "${k}": "${v.replace(/"/g, '\\"')}",`)
        })
        parts.push('}')
      } catch {
        parts.push(`data = """${decoded}"""`)
      }
      bodyVar = 'data=data'
    } else {
      parts.push(`data = """${decoded}"""`)
      bodyVar = 'data=data'
    }
    parts.push('')
  }

  // 方法调用
  const method = request.method.toLowerCase()
  const args: string[] = [`"${request.url}"`]
  if (hasHeaders) args.push('headers=headers')
  if (bodyVar) args.push(bodyVar)

  parts.push(`response = requests.${method}(${args.join(', ')})`)
  parts.push('')
  parts.push('print(response.status_code)')
  parts.push('print(response.json())')

  return parts.join('\n')
}

/**
 * 导出 Python requests 代码（复制到剪贴板）
 */
export async function exportPythonRequests(request: CaptureRequest): Promise<boolean> {
  const code = generatePythonRequests(request)
  try {
    await navigator.clipboard.writeText(code)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = code
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    return true
  }
}
