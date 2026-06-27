/**
 * 数据库迁移 - 创建表结构
 */
import Database from 'better-sqlite3'

/**
 * 执行数据库迁移
 * @param db SQLite 数据库实例
 */
export function runMigrations(db: Database.Database): void {
  // 启用 WAL 模式提高并发性能
  db.pragma('journal_mode = WAL')

  // 创建 requests 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      method          TEXT NOT NULL,
      url             TEXT NOT NULL,
      path            TEXT NOT NULL,
      host            TEXT NOT NULL,
      status_code     INTEGER,
      duration        INTEGER,
      request_headers TEXT,
      request_body    TEXT,
      response_headers TEXT,
      response_body   TEXT,
      client_ip       TEXT NOT NULL,
      device_name     TEXT,
      captured_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_recorded     INTEGER DEFAULT 1
    )
  `)

  // 创建 comparisons 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS comparisons (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_a_id  INTEGER NOT NULL,
      request_b_id  INTEGER NOT NULL,
      ai_result     TEXT,
      model_name    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_a_id) REFERENCES requests(id),
      FOREIGN KEY (request_b_id) REFERENCES requests(id)
    )
  `)

  // 创建 settings 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // 创建 sessions 表（会话元数据，引用 requests 表的时间范围）
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      start_time      DATETIME NOT NULL,
      end_time        DATETIME NOT NULL,
      request_count   INTEGER NOT NULL DEFAULT 0,
      filters_json    TEXT,
      view_mode       TEXT DEFAULT 'group',
      domain_filters_json TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 创建 autoResponderRules 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS autoResponderRules (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      url_pattern TEXT NOT NULL,
      methods_json TEXT NOT NULL DEFAULT '[]',
      status_code INTEGER NOT NULL DEFAULT 200,
      headers_json TEXT NOT NULL DEFAULT '{}',
      body TEXT NOT NULL DEFAULT '',
      delay INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // 创建 cookies 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS cookies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      domain TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '/',
      expires TEXT,
      http_only INTEGER NOT NULL DEFAULT 0,
      secure INTEGER NOT NULL DEFAULT 0,
      same_site TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(domain, path, name)
    )
  `)

  // 创建索引以优化查询性能
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_host ON requests(host)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_client_ip ON requests(client_ip)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_captured_at ON requests(captured_at)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_comparisons_created_at ON comparisons(created_at)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cookies_domain ON cookies(domain)
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cookies_expires ON cookies(expires)
  `)

  // 插入默认设置（如果不存在）
  const defaultSettings: Record<string, string> = {
    api_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: 'gpt-4o',
    proxy_port: '8888',
    device_aliases: '{}',
    domain_filters: '[]',
    ai_prompt_template: '',
    local_ip: '',
    ca_cert_generated: 'false',
  }

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  )

  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value)
  }
}
