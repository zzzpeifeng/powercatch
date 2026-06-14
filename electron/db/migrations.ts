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
