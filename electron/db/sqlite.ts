/**
 * SQLite 数据库操作封装
 * 使用 better-sqlite3 同步 API，天然串行，无锁竞争
 */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations } from './migrations'
import type { DbRequest, CaptureRequest, ComparisonRecord, AppSettings } from '../../src/services/types'
import { DEFAULT_PROMPT_V1 } from '../../src/services/types'

let db: Database.Database | null = null

/**
 * 初始化数据库连接
 * @returns SQLite 数据库实例
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'packet-capture.db')
  db = new Database(dbPath)
  runMigrations(db)
  return db
}

/**
 * 获取数据库实例
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * 持久化请求数据到数据库
 * @param request 抓包请求数据
 * @returns 插入的记录 ID
 */
export function persistRequest(request: CaptureRequest): number {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO requests (method, url, path, host, status_code, duration,
      request_headers, request_body, response_headers, response_body,
      client_ip, device_name, captured_at, is_recorded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    request.method,
    request.url,
    request.path,
    request.host,
    request.statusCode,
    request.duration,
    JSON.stringify(request.requestHeaders),
    request.requestBody,
    JSON.stringify(request.responseHeaders),
    request.responseBody,
    request.clientIp,
    request.deviceName,
    request.capturedAt,
    request.isRecorded ? 1 : 0
  )

  return result.lastInsertRowid as number
}

/**
 * 批量持久化多个请求
 * @param requests 请求列表
 * @returns 插入的记录 ID 列表
 */
export function persistRequests(requests: CaptureRequest[]): number[] {
  const db = getDatabase()
  const ids: number[] = []

  const transaction = db.transaction(() => {
    for (const request of requests) {
      ids.push(persistRequest(request))
    }
  })

  transaction()
  return ids
}

/**
 * 获取所有持久化的请求
 * @param limit 限制条数
 * @param offset 偏移量
 * @returns 请求列表
 */
export function getAllRequests(limit: number = 100, offset: number = 0): DbRequest[] {
  const db = getDatabase()
  const stmt = db.prepare(
    'SELECT * FROM requests ORDER BY captured_at DESC LIMIT ? OFFSET ?'
  )
  return stmt.all(limit, offset) as DbRequest[]
}

/**
 * 根据 ID 获取请求
 */
export function getRequestById(id: number): DbRequest | undefined {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM requests WHERE id = ?')
  return stmt.get(id) as DbRequest | undefined
}

/**
 * 保存对比记录
 * @param requestIdA 请求 A ID
 * @param requestIdB 请求 B ID
 * @param aiResult AI 对比结果
 * @param modelName 模型名称
 * @returns 插入的记录 ID
 */
export function saveComparison(
  requestIdA: number,
  requestIdB: number,
  aiResult: string,
  modelName: string
): number {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO comparisons (request_a_id, request_b_id, ai_result, model_name)
    VALUES (?, ?, ?, ?)
  `)
  const result = stmt.run(requestIdA, requestIdB, aiResult, modelName)
  return result.lastInsertRowid as number
}

/**
 * 获取对比历史
 * @param limit 限制条数
 * @returns 对比记录列表
 */
export function getComparisonHistory(limit: number = 50): ComparisonRecord[] {
  const db = getDatabase()
  const stmt = db.prepare(
    'SELECT * FROM comparisons ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(limit) as ComparisonRecord[]
}

/**
 * 获取设置值
 * @param key 设置键名
 * @returns 设置值
 */
export function getSetting(key: string): string | null {
  const db = getDatabase()
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const row = stmt.get(key) as { value: string } | undefined
  return row ? row.value : null
}

/**
 * 设置值
 * @param key 设置键名
 * @param value 设置值
 */
export function setSetting(key: string, value: string): void {
  const db = getDatabase()
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  )
  stmt.run(key, value)
}

/**
 * 获取所有设置
 * @returns 设置对象
 */
export function getAllSettings(): AppSettings {
  const db = getDatabase()
  const stmt = db.prepare('SELECT key, value FROM settings')
  const rows = stmt.all() as Array<{ key: string; value: string }>

  const settingsMap: Record<string, string> = {}
  for (const row of rows) {
    settingsMap[row.key] = row.value
  }

  return {
    apiUrl: settingsMap.api_url || 'https://api.openai.com/v1',
    apiKey: settingsMap.api_key || '',
    modelName: settingsMap.model_name || 'gpt-4o',
    proxyPort: parseInt(settingsMap.proxy_port || '8888', 10),
    deviceAliases: JSON.parse(settingsMap.device_aliases || '{}'),
    aiPromptTemplate: settingsMap.ai_prompt_template || DEFAULT_PROMPT_V1,
    domainFilters: JSON.parse(settingsMap.domain_filters || '[]'),
    localIp: settingsMap.local_ip || '',
    caCertGenerated: settingsMap.ca_cert_generated === 'true',
    theme: settingsMap.theme || 'system',
    breakpointRules: JSON.parse(settingsMap.breakpoint_rules || '[]'),
    mapLocalRules: JSON.parse(settingsMap.map_local_rules || '[]'),
  }
}

/**
 * 批量保存设置
 * @param settings 设置对象
 */
export function saveAllSettings(settings: Partial<AppSettings>): void {
  const db = getDatabase()

  const mapping: Record<string, string> = {}
  if (settings.apiUrl !== undefined) mapping.api_url = settings.apiUrl
  if (settings.apiKey !== undefined) mapping.api_key = settings.apiKey
  if (settings.modelName !== undefined) mapping.model_name = settings.modelName
  if (settings.proxyPort !== undefined) mapping.proxy_port = String(settings.proxyPort)
  if (settings.deviceAliases !== undefined) mapping.device_aliases = JSON.stringify(settings.deviceAliases)
  if (settings.aiPromptTemplate !== undefined) mapping.ai_prompt_template = settings.aiPromptTemplate
  if (settings.domainFilters !== undefined) mapping.domain_filters = JSON.stringify(settings.domainFilters)
  if (settings.localIp !== undefined) mapping.local_ip = settings.localIp
  if (settings.caCertGenerated !== undefined) mapping.ca_cert_generated = String(settings.caCertGenerated)
  if (settings.theme !== undefined) mapping.theme = settings.theme
  if (settings.breakpointRules !== undefined) mapping.breakpoint_rules = JSON.stringify(settings.breakpointRules)
  if (settings.mapLocalRules !== undefined) mapping.map_local_rules = JSON.stringify(settings.mapLocalRules)

  const transaction = db.transaction(() => {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    )
    for (const [key, value] of Object.entries(mapping)) {
      stmt.run(key, value)
    }
  })

  transaction()
}

/**
 * 清空所有请求数据
 */
export function clearAllRequests(): void {
  const db = getDatabase()
  db.exec('DELETE FROM requests')
}

/**
 * 清空所有对比记录
 */
export function clearAllComparisons(): void {
  const db = getDatabase()
  db.exec('DELETE FROM comparisons')
}
