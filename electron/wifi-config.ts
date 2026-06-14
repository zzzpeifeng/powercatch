/**
 * WiFi 配置模块
 * 生成 iOS .mobileconfig 描述文件，用于自动配置 WiFi + 代理
 */
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface WifiConfigOptions {
  /** WiFi 名称 (SSID) */
  ssid: string
  /** WiFi 密码 */
  password: string
  /** 加密类型 */
  encryptionType: 'WPA' | 'WEP' | 'nopass'
  /** 代理服务器 IP */
  proxyIp: string
  /** 代理端口 */
  proxyPort: number
  /** 是否隐藏 SSID */
  hidden?: boolean
}

export interface WifiConfigResult {
  success: boolean
  filePath?: string
  downloadUrl?: string
  error?: string
}

/**
 * 生成 UUID (用于 .mobileconfig 的 PayloadUUID)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * 生成 .mobileconfig 文件内容
 */
function generateMobileConfigXML(options: WifiConfigOptions): string {
  const {
    ssid,
    password,
    encryptionType,
    proxyIp,
    proxyPort,
    hidden = false,
  } = options

  const uuid1 = generateUUID()
  const uuid2 = generateUUID()
  const timestamp = new Date().toISOString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>AutoJoin</key>
      <true/>
      <key>EncryptionType</key>
      <string>${encryptionType}</string>
      <key>HiddentNetwork</key>
      <${hidden ? 'true' : 'false'}/>
      <key>Password</key>
      <string>${password}</string>
      <key>PayloadDescription</key>
      <string>配置 WiFi 网络</string>
      <key>PayloadDisplayName</key>
      <string>${ssid}</string>
      <key>PayloadIdentifier</key>
      <string>com.packetcapture.wifi.${uuid1}</string>
      <key>PayloadType</key>
      <string>com.apple.wifi.managed</string>
      <key>PayloadUUID</key>
      <string>${uuid1}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>ProxyServer</key>
      <string>${proxyIp}:${proxyPort}</string>
      <key>ProxyType</key>
      <string>Manual</string>
      <key>SSID_STR</key>
      <string>${ssid}</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>自动配置 WiFi 并设置代理</string>
  <key>PayloadDisplayName</key>
  <string>抓包工具 - WiFi 配置</string>
  <key>PayloadIdentifier</key>
  <string>com.packetcapture.${uuid2}</string>
  <key>PayloadOrganization</key>
  <string>Packet Capture App</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuid2}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`
}

/**
 * 生成 .mobileconfig 文件
 * @param options WiFi 配置选项
 * @returns 文件路径
 */
export function generateWifiConfig(options: WifiConfigOptions): WifiConfigResult {
  try {
    const userDataPath = app.getPath('userData')
    const fileName = `wifi-config-${Date.now()}.mobileconfig`
    const filePath = join(userDataPath, fileName)

    const xmlContent = generateMobileConfigXML(options)
    writeFileSync(filePath, xmlContent, 'utf-8')

    return {
      success: true,
      filePath,
      downloadUrl: `/config/${fileName}`,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * 生成标准 WiFi QR 码内容（用于 Android）
 * 格式: WIFI:T:WPA;S:SSID;P:password;H:false;;
 */
export function generateWifiQRContent(options: WifiConfigOptions): string {
  const { ssid, password, encryptionType, hidden = false } = options
  return `WIFI:T:${encryptionType};S:${ssid};P:${password};H:${hidden ? 'true' : 'false'};;`
}
