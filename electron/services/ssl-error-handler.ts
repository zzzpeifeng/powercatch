/**
 * SSL错误分类与处理系统
 * 
 * 功能：
 * 1. 识别并分类SSL错误（证书未知、证书固定、网络重置等）
 * 2. 提供针对性的处理建议
 * 3. 记录详细诊断信息
 * 4. 智能重试机制
 */

// SSL错误类型枚举
export enum SSLErrorType {
  // 证书相关错误
  CERTIFICATE_UNKNOWN = 'CERTIFICATE_UNKNOWN',       // SSL3_ALERT_CERTIFICATE_UNKNOWN (alert 46)
  CERTIFICATE_EXPIRED = 'CERTIFICATE_EXPIRED',       // 证书过期
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',       // 证书被吊销
  CERTIFICATE_UNTRUSTED = 'CERTIFICATE_UNTRUSTED',   // 证书不受信任（CA未安装）
  CERTIFICATE_MISMATCH = 'CERTIFICATE_MISMATCH',     // 域名不匹配
  CERTIFICATE_PINNING = 'CERTIFICATE_PINNING',         // 证书固定（App拒绝假证书）
  
  // 连接相关错误
  CONNECTION_RESET = 'CONNECTION_RESET',                 // ECONNRESET - 客户端主动断开
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',             // 连接超时
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',             // 连接被拒绝
  
  // 协议相关错误
  TLS_VERSION_MISMATCH = 'TLS_VERSION_MISMATCH',       // TLS版本不匹配
  HANDSHAKE_FAILED = 'HANDSHAKE_FAILED',               // 握手失败
  
  // 未知错误
  UNKNOWN_SSL_ERROR = 'UNKNOWN_SSL_ERROR',
}

// SSL错误严重程度
export enum SSLErrorSeverity {
  INFO = 'INFO',           // 信息级别（如证书固定，属正常行为）
  WARNING = 'WARNING',     // 警告（如临时网络问题）
  ERROR = 'ERROR',         // 错误（需要用户介入）
  FATAL = 'FATAL',       // 致命错误
}

// SSL错误详情接口
export interface SSLErrorDetail {
  type: SSLErrorType
  severity: SSLErrorSeverity
  code?: string            // OpenSSL错误码
  alertNumber?: number     // TLS alert编号
  message: string
  domain: string
  timestamp: number
  userActionRequired?: string  // 需要用户执行的操作
  canRetry: boolean
  retryAfterMs?: number   // 建议重试延迟
}

// 错误统计接口
export interface SSLErrorStats {
  domain: string
  totalErrors: number
  errorsByType: Partial<Record<SSLErrorType, number>>
  lastErrorTime: number
  firstErrorTime: number
  isPinnedDomain: boolean  // 是否为已知使用证书固定的域名
}

/**
 * SSL错误分类器
 */
export class SSLErrorClassifier {
  // 已知使用证书固定的域名/域名模式
  private static readonly PINNED_DOMAINS = [
    '*.google.com',
    '*.googleapis.com',
    '*.gstatic.com',
    '*.apple.com',
    '*.icloud.com',
    '*.microsoft.com',
    '*.facebook.com',
    '*.fbcdn.net',
    '*.twitter.com',
    '*.twimg.com',
    '*.amazon.com',
    '*.aws.amazon.com',
    '*.instagram.com',
    '*.whatsapp.com',
    '*.telegram.org',
    '*.signal.org',
    '*.cloudfront.net',
  ]
  
  // OpenSSL错误码映射
  private static readonly OPENSSL_ERROR_MAP: Record<string, SSLErrorType> = {
    'SSL3_ALERT_CERTIFICATE_UNKNOWN': SSLErrorType.CERTIFICATE_UNKNOWN,
    'SSLV3_ALERT_CERTIFICATE_UNKNOWN': SSLErrorType.CERTIFICATE_UNKNOWN,
    'CERTIFICATE_VERIFY_FAILED': SSLErrorType.CERTIFICATE_UNTRUSTED,
    'CERT_HAS_EXPIRED': SSLErrorType.CERTIFICATE_EXPIRED,
    'CERT_REVOKED': SSLErrorType.CERTIFICATE_REVOKED,
    'ERR_SSL_PINNING_FAILED': SSLErrorType.CERTIFICATE_PINNING,
    'ERR_TLS_VERSION_OR_CIPHER_MISMATCH': SSLErrorType.TLS_VERSION_MISMATCH,
  }
  
  /**
   * 分类SSL错误
   */
  static classify(error: any, domain: string): SSLErrorDetail {
    const timestamp = Date.now()
    const errorStr = String(error)
    const errorCode = error?.code || ''
    const reason = error?.reason || ''
    
    // 1. 检查 SSLV3_ALERT_CERTIFICATE_UNKNOWN（你的具体错误）
    if (errorStr.includes('SSL3_ALERT_CERTIFICATE_UNKNOWN') ||
        errorStr.includes('SSLV3_ALERT_CERTIFICATE_UNKNOWN') ||
        errorCode === 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN') {
      const isPinned = this.isPinnedDomain(domain)
      return {
        type: SSLErrorType.CERTIFICATE_PINNING,
        severity: isPinned ? SSLErrorSeverity.INFO : SSLErrorSeverity.WARNING,
        code: errorCode,
        alertNumber: 46,
        message: isPinned 
          ? `域名 ${domain} 使用了证书固定（Certificate Pinning），这是正常行为，无需处理。`
          : `客户端不信任代理签发的证书。如果这是你的App，请配置networkSecurityConfig信任用户证书。`,
        domain,
        timestamp,
        userActionRequired: isPinned 
          ? '无需操作，这是目标App的正常安全行为'
          : '1. 确认CA证书已正确安装并启用信任\n2. 如果是你开发的App，配置networkSecurityConfig\n3. 或使用已root的设备+绕过SSL Pinning工具',
        canRetry: false,  // 证书固定问题重试也没用
        retryAfterMs: 0,
      }
    }
    
    // 2. 检查 ECONNRESET（客户端主动断开，通常是证书固定导致）
    if (errorCode === 'ECONNRESET' || errorStr.includes('socket hang up')) {
      const isPinned = this.isPinnedDomain(domain)
      return {
        type: SSLErrorType.CONNECTION_RESET,
        severity: isPinned ? SSLErrorSeverity.INFO : SSLErrorSeverity.WARNING,
        code: errorCode,
        message: isPinned
          ? `与 ${domain} 的连接被客户端重置（证书固定导致App主动断开连接）`
          : `与 ${domain} 的连接被重置，可能是证书问题或网络不稳定`,
        domain,
        timestamp,
        userActionRequired: isPinned
          ? '无需操作，这是证书固定App的正常行为'
          : '1. 检查CA证书是否正确安装\n2. 检查网络连接是否稳定',
        canRetry: !isPinned,  // 证书固定域名不重试
        retryAfterMs: 1000,
      }
    }
    
    // 3. 检查证书验证失败（CA未安装/未信任）
    if (errorStr.includes('CERTIFICATE_VERIFY_FAILED') ||
        errorStr.includes('certificate verify failed')) {
      return {
        type: SSLErrorType.CERTIFICATE_UNTRUSTED,
        severity: SSLErrorSeverity.ERROR,
        code: errorCode,
        message: `CA证书未受信任。请确认已在手机上安装并启用对CA证书的信任。`,
        domain,
        timestamp,
        userActionRequired: [
          'Android: 设置 → 安全 → 加密与凭据 → 受信任的凭据 → 确认你的CA证书在"用户"标签页中',
          'iOS: 设置 → 通用 → 关于本机 → 证书信任设置 → 启用对CA证书的完全信任',
          'Android 7+: 普通App默认不信任用户证书，需要App配置networkSecurityConfig或使用已root设备',
        ].join('\n'),
        canRetry: true,
        retryAfterMs: 0,
      }
    }
    
    // 4. 检查TLS版本不匹配
    if (errorStr.includes('TLS_VERSION_MISMATCH') ||
        errorStr.includes('version') && errorStr.includes('mismatch')) {
      return {
        type: SSLErrorType.TLS_VERSION_MISMATCH,
        severity: SSLErrorSeverity.WARNING,
        code: errorCode,
        message: `TLS版本不匹配，客户端要求的TLS版本与代理提供的不一致`,
        domain,
        timestamp,
        userActionRequired: '尝试在代理中调整TLS版本配置，或更新客户端',
        canRetry: true,
        retryAfterMs: 500,
      }
    }
    
    // 5. 检查连接超时
    if (errorCode === 'ETIMEDOUT' || errorStr.includes('timeout')) {
      return {
        type: SSLErrorType.CONNECTION_TIMEOUT,
        severity: SSLErrorSeverity.WARNING,
        code: errorCode,
        message: `与 ${domain} 的SSL握手超时`,
        domain,
        timestamp,
        userActionRequired: '检查网络连接，确认目标服务器可达',
        canRetry: true,
        retryAfterMs: 2000,
      }
    }
    
    // 6. 未知SSL错误
    return {
      type: SSLErrorType.UNKNOWN_SSL_ERROR,
      severity: SSLErrorSeverity.WARNING,
      code: errorCode,
      message: `未知的SSL错误: ${errorStr.substring(0, 200)}`,
      domain,
      timestamp,
      userActionRequired: '查看详细错误日志以获取更多信息',
      canRetry: true,
      retryAfterMs: 1000,
    }
  }
  
  /**
   * 检查域名是否使用证书固定
   */
  private static isPinnedDomain(domain: string): boolean {
    for (const pattern of this.PINNED_DOMAINS) {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.substring(2)
        if (domain === suffix || domain.endsWith('.' + suffix)) {
          return true
        }
      } else if (domain === pattern) {
        return true
      }
    }
    return false
  }
  
  /**
   * 添加自定义证书固定域名
   */
  static addPinnedDomain(pattern: string): void {
    if (!this.PINNED_DOMAINS.includes(pattern)) {
      this.PINNED_DOMAINS.push(pattern)
    }
  }
  
  /**
   * 获取所有已知证书固定域名
   */
  static getPinnedDomains(): string[] {
    return [...this.PINNED_DOMAINS]
  }
}

/**
 * SSL错误格式化器
 */
export class SSLErrorFormatter {
  /**
   * 格式化错误为可读字符串
   */
  static format(detail: SSLErrorDetail): string {
    const lines: string[] = [
      `[${detail.severity}] SSL错误`,
      `  域名: ${detail.domain}`,
      `  类型: ${detail.type}`,
      `  消息: ${detail.message}`,
    ]
    
    if (detail.code) {
      lines.push(`  错误码: ${detail.code}`)
    }
    if (detail.alertNumber) {
      lines.push(`  TLS Alert编号: ${detail.alertNumber}`)
    }
    
    lines.push(`  时间: ${new Date(detail.timestamp).toLocaleString()}`)
    lines.push(`  可重试: ${detail.canRetry ? '是' : '否'}`)
    
    if (detail.userActionRequired) {
      lines.push(`  建议操作:`)
      detail.userActionRequired.split('\n').forEach(line => {
        lines.push(`    ${line}`)
      })
    }
    
    return lines.join('\n')
  }
  
  /**
   * 格式化错误为简短的一行日志
   */
  static formatShort(detail: SSLErrorDetail): string {
    const severityIcon = {
      [SSLErrorSeverity.INFO]: 'ℹ️',
      [SSLErrorSeverity.WARNING]: '⚠️',
      [SSLErrorSeverity.ERROR]: '❌',
      [SSLErrorSeverity.FATAL]: '💀',
    }[detail.severity] || '❓'
    
    return `${severityIcon} [SSL] ${detail.domain} → ${detail.type}: ${detail.message}`
  }
  
  /**
   * 生成用户友好的错误报告（用于UI显示）
   */
  static formatUserFriendly(detail: SSLErrorDetail): {
    title: string
    description: string
    solution: string
    level: 'info' | 'warning' | 'error'
  } {
    const isPinned = SSLErrorClassifier.isPinnedDomain(detail.domain)
    
    if (detail.type === SSLErrorType.CERTIFICATE_PINNING) {
      return {
        title: `无法解密 ${detail.domain}`,
        description: isPinned
          ? `该域名使用了证书固定（Certificate Pinning）技术，App会拒绝任何非官方签发的证书。这是正常的安全行为。`
          : `客户端不信任代理签发的证书，可能原因是CA证书未正确安装或App使用了证书固定。`,
        solution: isPinned
          ? `此域名（${detail.domain}）无法抓包，建议：\n1. 在域名过滤中添加 *.${detail.domain} 跳过解密\n2. 或使用已root的Android设备+Frida绕过证书固定`
          : `请尝试：\n1. 确认CA证书已安装并在"受信任的凭据"中启用\n2. 如果是你开发的App，配置networkSecurityConfig信任用户证书\n3. 使用手机浏览器测试（浏览器通常信任用户证书）`,
        level: isPinned ? 'info' : 'warning',
      }
    }
    
    if (detail.type === SSLErrorType.CERTIFICATE_UNTRUSTED) {
      return {
        title: 'CA证书未受信任',
        description: '手机不信任代理签发的证书，HTTPS流量无法解密。',
        solution: '请按照证书安装指引正确安装并启用对CA证书的信任。',
        level: 'error',
      }
    }
    
    return {
      title: `SSL连接错误`,
      description: detail.message,
      solution: detail.userActionRequired || '请检查网络连接和证书配置。',
      level: detail.severity === SSLErrorSeverity.ERROR ? 'error' : 'warning',
    }
  }
}
