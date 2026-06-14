/**
 * SSL错误日志记录器
 * 
 * 功能：
 * 1. 记录所有SSL错误到内存和文件
 * 2. 提供查询和统计接口
 * 3. 自动识别证书固定域名
 * 4. 生成诊断报告
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { SSLErrorDetail, SSLErrorStats, SSLErrorType, SSLErrorClassifier } from './ssl-error-handler'

// 日志级别
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string
  domain?: string
  errorDetail?: SSLErrorDetail
}

/**
 * SSL错误日志记录器
 */
export class SSLErrorLogger {
  private static instance: SSLErrorLogger
  private logDir: string
  private logFile: string
  private errorStats: Map<string, SSLErrorStats> = new Map()
  private recentErrors: SSLErrorDetail[] = []
  private maxRecentErrors = 100
  private maxLogFileSize = 10 * 1024 * 1024  // 10MB
  
  private constructor() {
    // 日志目录：~/Library/Logs/packet-capture-app/
    this.logDir = path.join(app.getPath('logs'), 'packet-capture-app')
    this.logFile = path.join(this.logDir, 'ssl-errors.log')
    
    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }
  }
  
  static getInstance(): SSLErrorLogger {
    if (!SSLErrorLogger.instance) {
      SSLErrorLogger.instance = new SSLErrorLogger()
    }
    return SSLErrorLogger.instance
  }
  
  /**
   * 记录SSL错误
   */
  logError(detail: SSLErrorDetail): void {
    // 1. 写入内存
    this.recentErrors.push(detail)
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift()
    }
    
    // 2. 更新统计
    this.updateStats(detail)
    
    // 3. 写入文件（异步，不阻塞）
    this.writeToFile(detail)
    
    // 4. 控制台输出（根据严重程度）
    if (detail.severity === 'ERROR' || detail.severity === 'FATAL') {
      console.error(SSLErrorFormatter.format(detail))
    } else if (detail.severity === 'WARNING') {
      console.warn(SSLErrorFormatter.formatShort(detail))
    } else {
      console.log(SSLErrorFormatter.formatShort(detail))
    }
  }
  
  /**
   * 记录一般日志
   */
  log(level: LogLevel, message: string, domain?: string): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      domain,
    }
    
    const logLine = `[${new Date().toISOString()}] [${level}] ${domain ? `[${domain}] ` : ''}${message}\n`
    this.appendToFile(logLine)
  }
  
  /**
   * 更新错误统计
   */
  private updateStats(detail: SSLErrorDetail): void {
    const domain = detail.domain
    let stats = this.errorStats.get(domain)
    
    if (!stats) {
      stats = {
        domain,
        totalErrors: 0,
        errorsByType: {},
        lastErrorTime: detail.timestamp,
        firstErrorTime: detail.timestamp,
        isPinnedDomain: SSLErrorClassifier.isPinnedDomain(domain),
      }
      this.errorStats.set(domain, stats)
    }
    
    stats.totalErrors++
    stats.lastErrorTime = detail.timestamp
    stats.errorsByType[detail.type] = (stats.errorsByType[detail.type] || 0) + 1
  }
  
  /**
   * 写入错误到文件
   */
  private writeToFile(detail: SSLErrorDetail): void {
    const logLine = [
      `[${new Date(detail.timestamp).toISOString()}] [${detail.severity}]`,
      `Domain: ${detail.domain}`,
      `Type: ${detail.type}`,
      `Code: ${detail.code || 'N/A'}`,
      `Alert: ${detail.alertNumber || 'N/A'}`,
      `Message: ${detail.message}`,
      `CanRetry: ${detail.canRetry}`,
      `UserAction: ${detail.userActionRequired || 'N/A'}`,
      '---',
    ].join('\n') + '\n'
    
    this.appendToFile(logLine)
  }
  
  /**
   * 追加内容到日志文件
   */
  private appendToFile(content: string): void {
    try {
      // 检查文件大小，超过限制则轮转
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile)
        if (stats.size > this.maxLogFileSize) {
          const backupFile = this.logFile + '.1'
          if (fs.existsSync(backupFile)) {
            fs.unlinkSync(backupFile)
          }
          fs.renameSync(this.logFile, backupFile)
        }
      }
      
      fs.appendFileSync(this.logFile, content, 'utf8')
    } catch (err) {
      console.error('Failed to write SSL error log:', err)
    }
  }
  
  /**
   * 获取最近的错误列表
   */
  getRecentErrors(limit = 50): SSLErrorDetail[] {
    return this.recentErrors.slice(-limit)
  }
  
  /**
   * 获取指定域名的错误统计
   */
  getDomainStats(domain: string): SSLErrorStats | undefined {
    return this.errorStats.get(domain)
  }
  
  /**
   * 获取所有域名的错误统计
   */
  getAllStats(): SSLErrorStats[] {
    return Array.from(this.errorStats.values())
      .sort((a, b) => b.totalErrors - a.totalErrors)
  }
  
  /**
   * 获取错误摘要（用于UI显示）
   */
  getErrorSummary(): {
    totalErrors: number
    uniqueDomains: number
    topErrorDomains: Array<{ domain: string; count: number }>
    errorsByType: Partial<Record<SSLErrorType, number>>
    pinnedDomainErrors: number  // 证书固定域名的错误数（可忽略）
  } {
    const allStats = this.getAllStats()
    const errorsByType: Partial<Record<SSLErrorType, number>> = {}
    let pinnedDomainErrors = 0
    
    allStats.forEach(stats => {
      Object.entries(stats.errorsByType).forEach(([type, count]) => {
        errorsByType[type as SSLErrorType] = (errorsByType[type as SSLErrorType] || 0) + count
      })
      if (stats.isPinnedDomain) {
        pinnedDomainErrors += stats.totalErrors
      }
    })
    
    return {
      totalErrors: this.recentErrors.length,
      uniqueDomains: allStats.length,
      topErrorDomains: allStats.slice(0, 10).map(s => ({
        domain: s.domain,
        count: s.totalErrors,
      })),
      errorsByType,
      pinnedDomainErrors,
    }
  }
  
  /**
   * 生成诊断报告
   */
  generateDiagnosticReport(): string {
    const lines: string[] = [
      '========================================',
      'SSL错误诊断报告',
      `生成时间: ${new Date().toLocaleString()}`,
      '========================================',
      '',
    ]
    
    const summary = this.getErrorSummary()
    lines.push('## 总览')
    lines.push(`- 总错误数: ${summary.totalErrors}`)
    lines.push(`- 涉及域名数: ${summary.uniqueDomains}`)
    lines.push(`- 证书固定域名错误数（可忽略）: ${summary.pinnedDomainErrors}`)
    lines.push('')
    
    lines.push('## 错误类型分布')
    Object.entries(summary.errorsByType).forEach(([type, count]) => {
      lines.push(`- ${type}: ${count} 次`)
    })
    lines.push('')
    
    lines.push('## 错误最多的域名（Top 10）')
    summary.topErrorDomains.forEach((item, idx) => {
      const isPinned = SSLErrorClassifier.isPinnedDomain(item.domain)
      lines.push(`${idx + 1}. ${item.domain}${isPinned ? ' (证书固定)' : ''} - ${item.count} 次错误`)
    })
    lines.push('')
    
    lines.push('## 最近错误详情（最近20条）')
    const recent = this.getRecentErrors(20).reverse()
    recent.forEach((detail, idx) => {
      lines.push(`### ${idx + 1}. ${detail.domain}`)
      lines.push(`- 时间: ${new Date(detail.timestamp).toLocaleString()}`)
      lines.push(`- 类型: ${detail.type}`)
      lines.push(`- 严重程度: ${detail.severity}`)
      lines.push(`- 消息: ${detail.message}`)
      if (detail.userActionRequired) {
        lines.push(`- 建议操作: ${detail.userActionRequired}`)
      }
      lines.push('')
    })
    
    lines.push('========================================')
    lines.push('报告结束')
    lines.push('========================================')
    
    return lines.join('\n')
  }
  
  /**
   * 导出诊断报告到文件
   */
  exportDiagnosticReport(): string {
    const report = this.generateDiagnosticReport()
    const reportFile = path.join(this.logDir, `ssl-diagnostic-${Date.now()}.txt`)
    
    try {
      fs.writeFileSync(reportFile, report, 'utf8')
      return reportFile
    } catch (err) {
      console.error('Failed to export diagnostic report:', err)
      return ''
    }
  }
  
  /**
   * 清空错误记录
   */
  clear(): void {
    this.recentErrors = []
    this.errorStats.clear()
    this.log('INFO', 'SSL错误记录已清空')
  }
  
  /**
   * 获取日志文件路径
   */
  getLogFilePath(): string {
    return this.logFile
  }
}

/**
 * SSL错误格式化器（日志记录器专用）
 */
class SSLErrorFormatter {
  static format(detail: SSLErrorDetail): string {
    return `[${detail.severity}] ${detail.domain} → ${detail.type}: ${detail.message}`
  }
  
  static formatShort(detail: SSLErrorDetail): string {
    const icon = detail.severity === 'INFO' ? 'ℹ️' : '⚠️'
    return `${icon} [SSL] ${detail.domain}: ${detail.message}`
  }
}
