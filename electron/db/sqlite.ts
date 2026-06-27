/**
 * SQLite 数据库操作封装
 * 使用 better-sqlite3 同步 API，天然串行，无锁竞争
 */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations } from './migrations'
import type { DbRequest, CaptureRequest, ComparisonRecord, AppSettings, CaptureSession, AutoResponderRule, Cookie, CookieJar } from '../../src/services/types'
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
 * 批量持久化多个请求（复用 prepare 语句，事务内批量执行）
 * @param requests 请求列表
 * @returns 插入的记录 ID 列表
 */
export function persistRequests(requests: CaptureRequest[]): number[] {
  const db = getDatabase()
  const ids: number[] = []

  const stmt = db.prepare(`
    INSERT INTO requests (method, url, path, host, status_code, duration,
      request_headers, request_body, response_headers, response_body,
      client_ip, device_name, captured_at, is_recorded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    for (const request of requests) {
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
      ids.push(result.lastInsertRowid as number)
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
    mapRemoteRules: JSON.parse(settingsMap.map_remote_rules || '[]'),
    aiCodeAnalysisConfig: settingsMap.ai_code_analysis_config
      ? JSON.parse(settingsMap.ai_code_analysis_config)
      : undefined,
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
  if (settings.mapRemoteRules !== undefined) mapping.map_remote_rules = JSON.stringify(settings.mapRemoteRules)
  if (settings.aiCodeAnalysisConfig !== undefined) mapping.ai_code_analysis_config = JSON.stringify(settings.aiCodeAnalysisConfig)

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

// ===== 会话管理 =====

/**
 * 保存当前会话元数据
 * @param session 会话数据（不含 id 和 createdAt）
 * @returns 插入的记录 ID
 */
export function saveSession(session: Omit<CaptureSession, 'id' | 'createdAt'>): number {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO sessions (name, start_time, end_time, request_count, filters_json, view_mode, domain_filters_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    session.name,
    session.startTime,
    session.endTime,
    session.requestCount,
    session.filtersJson ?? null,
    session.viewMode,
    session.domainFiltersJson ?? null
  )
  return result.lastInsertRowid as number
}

/**
 * 获取所有会话列表（按创建时间倒序）
 * @returns 会话列表
 */
export function listSessions(): CaptureSession[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC')
  const rows = stmt.all() as Array<{
    id: number
    name: string
    start_time: string
    end_time: string
    request_count: number
    filters_json: string | null
    view_mode: string
    domain_filters_json: string | null
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    requestCount: row.request_count,
    filtersJson: row.filters_json ?? undefined,
    viewMode: (row.view_mode as 'list' | 'group') || 'group',
    domainFiltersJson: row.domain_filters_json ?? undefined,
    createdAt: row.created_at,
  }))
}

/**
 * 加载单个会话的请求数据（根据时间范围查询 requests 表）
 * @param sessionId 会话 ID
 * @returns 请求列表（按 captured_at 升序）
 */
export function loadSessionRequests(sessionId: number): CaptureRequest[] {
  const db = getDatabase()

  // 先获取会话的时间范围
  const sessionStmt = db.prepare('SELECT start_time, end_time FROM sessions WHERE id = ?')
  const session = sessionStmt.get(sessionId) as { start_time: string; end_time: string } | undefined
  if (!session) return []

  // 根据时间范围查询请求
  const requestStmt = db.prepare(
    'SELECT * FROM requests WHERE captured_at >= ? AND captured_at <= ? ORDER BY captured_at ASC'
  )
  const dbRequests = requestStmt.all(session.start_time, session.end_time) as DbRequest[]

  return dbRequests.map((row) => ({
    id: String(row.id),
    method: row.method as CaptureRequest['method'],
    url: row.url,
    path: row.path,
    host: row.host,
    statusCode: row.status_code,
    duration: row.duration,
    requestHeaders: row.request_headers ? JSON.parse(row.request_headers) : {},
    requestBody: row.request_body ?? '',
    responseHeaders: row.response_headers ? JSON.parse(row.response_headers) : {},
    responseBody: row.response_body ?? '',
    clientIp: row.client_ip,
    deviceName: row.device_name ?? '',
    capturedAt: row.captured_at,
    isRecorded: !!row.is_recorded,
    selected: false,
    checked: false,
  }))
}

/**
 * 删除会话（仅删除元数据，不删除 requests 表数据）
 * @param sessionId 会话 ID
 */
export function deleteSession(sessionId: number): void {
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?')
  stmt.run(sessionId)
}

/**
 * 重命名会话
 * @param sessionId 会话 ID
 * @param newName 新名称
 */
export function renameSession(sessionId: number, newName: string): void {
  const db = getDatabase()
  const stmt = db.prepare('UPDATE sessions SET name = ? WHERE id = ?')
  stmt.run(newName, sessionId)
}

// ===== Auto Responder 规则管理 =====

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `auto_responder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 获取所有 Auto Responder 规则
 * @returns 规则列表
 */
export function listAutoResponderRules(): AutoResponderRule[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM autoResponderRules ORDER BY created_at DESC')
  const rows = stmt.all() as Array<{
    id: string
    enabled: number
    name: string
    url_pattern: string
    methods_json: string
    status_code: number
    headers_json: string
    body: string
    delay: number
    created_at: string
  }>

  return rows.map(row => ({
    id: row.id,
    enabled: Boolean(row.enabled),
    name: row.name,
    match: {
      urlPattern: row.url_pattern,
      methods: JSON.parse(row.methods_json),
    },
    response: {
      statusCode: row.status_code,
      headers: JSON.parse(row.headers_json),
      body: row.body,
      delay: row.delay,
    },
    createdAt: row.created_at,
  }))
}

/**
 * 创建 Auto Responder 规则
 * @param rule 规则数据（不含 id 和 createdAt）
 * @returns 创建的规则
 */
export function createAutoResponderRule(rule: Omit<AutoResponderRule, 'id' | 'createdAt'>): AutoResponderRule {
  const db = getDatabase()
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO autoResponderRules (id, enabled, name, url_pattern, methods_json, status_code, headers_json, body, delay)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    id,
    rule.enabled ? 1 : 0,
    rule.name,
    rule.match.urlPattern,
    JSON.stringify(rule.match.methods),
    rule.response.statusCode,
    JSON.stringify(rule.response.headers),
    rule.response.body,
    rule.response.delay
  )
  return { ...rule, id, createdAt: new Date().toISOString() }
}

/**
 * 更新 Auto Responder 规则
 * @param id 规则 ID
 * @param updates 更新数据
 */
export function updateAutoResponderRule(id: string, updates: Partial<AutoResponderRule>): void {
  const db = getDatabase()

  // 动态构建 UPDATE 语句
  const setClauses: string[] = []
  const values: any[] = []

  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?')
    values.push(updates.enabled ? 1 : 0)
  }
  if (updates.name !== undefined) {
    setClauses.push('name = ?')
    values.push(updates.name)
  }
  if (updates.match?.urlPattern !== undefined) {
    setClauses.push('url_pattern = ?')
    values.push(updates.match.urlPattern)
  }
  if (updates.match?.methods !== undefined) {
    setClauses.push('methods_json = ?')
    values.push(JSON.stringify(updates.match.methods))
  }
  if (updates.response?.statusCode !== undefined) {
    setClauses.push('status_code = ?')
    values.push(updates.response.statusCode)
  }
  if (updates.response?.headers !== undefined) {
    setClauses.push('headers_json = ?')
    values.push(JSON.stringify(updates.response.headers))
  }
  if (updates.response?.body !== undefined) {
    setClauses.push('body = ?')
    values.push(updates.response.body)
  }
  if (updates.response?.delay !== undefined) {
    setClauses.push('delay = ?')
    values.push(updates.response.delay)
  }

  if (setClauses.length === 0) return

  values.push(id)
  const sql = `UPDATE autoResponderRules SET ${setClauses.join(', ')} WHERE id = ?`
  const stmt = db.prepare(sql)
  stmt.run(...values)
}

/**
 * 删除 Auto Responder 规则
 * @param id 规则 ID
 */
export function deleteAutoResponderRule(id: string): void {
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM autoResponderRules WHERE id = ?')
  stmt.run(id)
}

// ===== Cookie 管理 =====

/**
 * 获取所有 Cookie
 * @returns Cookie 列表
 */
export function getAllCookies(): Cookie[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM cookies ORDER BY domain, name')
  const rows = stmt.all() as Array<{
    name: string
    value: string
    domain: string
    path: string
    expires: string | null
    http_only: number
    secure: number
    same_site: string | null
    created_at: string
  }>

  return rows.map(row => ({
    name: row.name,
    value: row.value,
    domain: row.domain,
    path: row.path,
    expires: row.expires || undefined,
    httpOnly: Boolean(row.http_only),
    secure: Boolean(row.secure),
    sameSite: (row.same_site as Cookie['sameSite']) || undefined,
    createdAt: row.created_at,
  }))
}

/**
 * 添加或更新 Cookie（使用 UNIQUE 约束的 upsert）
 * @param cookie Cookie 数据
 */
export function addCookie(cookie: Cookie): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO cookies (name, value, domain, path, expires, http_only, secure, same_site, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(domain, path, name) DO UPDATE SET
      value = excluded.value,
      expires = excluded.expires,
      http_only = excluded.http_only,
      secure = excluded.secure,
      same_site = excluded.same_site,
      updated_at = datetime('now')
  `)
  stmt.run(
    cookie.name,
    cookie.value,
    cookie.domain,
    cookie.path,
    cookie.expires || null,
    cookie.httpOnly ? 1 : 0,
    cookie.secure ? 1 : 0,
    cookie.sameSite || null,
    cookie.createdAt,
  )
}

/**
 * 更新 Cookie
 * @param domain 域名
 * @param path 路径
 * @param name 名称
 * @param updates 更新数据
 */
export function updateCookie(domain: string, path: string, name: string, updates: Partial<Cookie>): void {
  const db = getDatabase()

  const setClauses: string[] = []
  const values: any[] = []

  if (updates.value !== undefined) {
    setClauses.push('value = ?')
    values.push(updates.value)
  }
  if (updates.expires !== undefined) {
    setClauses.push('expires = ?')
    values.push(updates.expires || null)
  }
  if (updates.httpOnly !== undefined) {
    setClauses.push('http_only = ?')
    values.push(updates.httpOnly ? 1 : 0)
  }
  if (updates.secure !== undefined) {
    setClauses.push('secure = ?')
    values.push(updates.secure ? 1 : 0)
  }
  if (updates.sameSite !== undefined) {
    setClauses.push('same_site = ?')
    values.push(updates.sameSite || null)
  }

  if (setClauses.length === 0) return

  setClauses.push("updated_at = datetime('now')")
  values.push(domain, path, name)

  const sql = `UPDATE cookies SET ${setClauses.join(', ')} WHERE domain = ? AND path = ? AND name = ?`
  const stmt = db.prepare(sql)
  stmt.run(...values)
}

/**
 * 删除单个 Cookie
 * @param domain 域名
 * @param path 路径
 * @param name 名称
 */
export function deleteCookie(domain: string, path: string, name: string): void {
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM cookies WHERE domain = ? AND path = ? AND name = ?')
  stmt.run(domain, path, name)
}

/**
 * 清空某个域名下的所有 Cookie
 * @param domain 域名
 */
export function clearDomainCookies(domain: string): void {
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM cookies WHERE domain = ?')
  stmt.run(domain)
}

/**
 * 清空所有 Cookie
 */
export function clearAllCookies(): void {
  const db = getDatabase()
  db.exec('DELETE FROM cookies')
}

/**
 * 批量导入 Cookie（事务内执行）
 * @param cookies Cookie 列表
 */
export function importCookies(cookies: Cookie[]): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO cookies (name, value, domain, path, expires, http_only, secure, same_site, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(domain, path, name) DO UPDATE SET
      value = excluded.value,
      expires = excluded.expires,
      http_only = excluded.http_only,
      secure = excluded.secure,
      same_site = excluded.same_site,
      updated_at = datetime('now')
  `)

  const transaction = db.transaction(() => {
    for (const cookie of cookies) {
      stmt.run(
        cookie.name,
        cookie.value,
        cookie.domain,
        cookie.path,
        cookie.expires || null,
        cookie.httpOnly ? 1 : 0,
        cookie.secure ? 1 : 0,
        cookie.sameSite || null,
        cookie.createdAt,
      )
    }
  })

  transaction()
}

/**
 * 清理过期 Cookie
 */
export function cleanExpiredCookies(): void {
  const db = getDatabase()
  const stmt = db.prepare("DELETE FROM cookies WHERE expires IS NOT NULL AND expires < datetime('now')")
  stmt.run()
}
