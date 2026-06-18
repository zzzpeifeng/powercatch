/**
 * URL 协议提取与域名格式化工具
 */

/**
 * 从 URL 中提取协议前缀
 * @param url 完整 URL 或路径
 * @returns 协议前缀，如 'https://' 或 'http://'，默认 'https://'
 */
export function getProtocolFromUrl(url: string): string {
  if (url.startsWith('https://')) return 'https://'
  if (url.startsWith('http://')) return 'http://'
  // 无协议前缀（HTTPS MITM 的相对路径），默认 https
  return 'https://'
}

/**
 * 格式化域名显示，带协议前缀
 * @param host 域名
 * @param url 完整 URL（用于推断协议）
 * @returns 带协议前缀的域名，如 'https://api.example.com'；host 为空时返回空字符串
 */
export function formatHostWithProtocol(host: string, url: string): string {
  if (!host) return ''
  return `${getProtocolFromUrl(url)}${host}`
}
