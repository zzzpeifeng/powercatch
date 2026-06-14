import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * 获取当前连接的 WiFi 信息
 * macOS: 使用 networksetup -getairportnetwork en0
 * Windows: 使用 netsh wlan show interfaces
 */
export async function getCurrentWifiInfo(): Promise<{ ssid: string; error?: string; needSudo?: boolean }> {
  try {
    const platform = process.platform
    
    if (platform === 'darwin') {
      // macOS - 先尝试普通方式（不需要 sudo）
      try {
        const { stdout } = await execAsync('networksetup -getairportnetwork en0')
        const ssid = parseMacOSWifiOutput(stdout)
        if (ssid) {
          return { ssid }
        }
        return { ssid: '', error: '未连接到 WiFi 或无法解析输出' }
      } catch (err: any) {
        // 如果普通方式失败，返回需要权限的提示
        if (err.message?.includes('not permitted') || err.stderr?.includes('not permitted')) {
          return { ssid: '', error: '需要管理员权限', needSudo: true }
        }
        return { ssid: '', error: err.message || '获取失败' }
      }
    } else if (platform === 'win32') {
      // Windows
      const { stdout } = await execAsync('netsh wlan show interfaces')
      const match = stdout.match(/SSID\s*:\s*(.+)/)
      if (match && match[1]) {
        return { ssid: match[1].trim() }
      }
      return { ssid: '', error: '未连接到 WiFi' }
    } else {
      return { ssid: '', error: '不支持的操作系统' }
    }
  } catch (error: any) {
    return { ssid: '', error: error.message }
  }
}

/**
 * 解析 macOS networksetup 输出
 * 可能格式：
 *   "Current Wi-Fi Network: YourWiFi"
 *   "Current Wi-Fi Network: <SSID>"
 *   或者报错："Error: Wi-Fi power is off"
 */
function parseMacOSWifiOutput(output: string): string | null {
  // 格式1: Current Wi-Fi Network: SSID
  const match1 = output.match(/Current Wi-Fi Network:\s*(.+)/i)
  if (match1 && match1[1] && match1[1] !== '<none>' && !match1[1].includes('Error')) {
    return match1[1].trim()
  }
  
  // 检查是否未连接
  if (output.includes('not associated') || output.includes('<none>')) {
    return ''
  }
  
  // 检查 WiFi 是否关闭
  if (output.includes('power is off') || output.includes('Wi-Fi power is off')) {
    return ''
  }

  return null
}

/**
 * 使用 system_profiler 获取 WiFi 名称（无需 sudo，更可靠）
 */
export async function getWifiSsidWithAppleScript(): Promise<{ ssid: string; error?: string }> {
  try {
    // 使用 system_profiler 获取 WiFi 信息
    const { stdout } = await execAsync('system_profiler SPAirPortDataType')
    
    // 解析输出，查找 "Current Network Information" 部分
    const lines = stdout.split('\n')
    let inCurrentNetwork = false
    
    for (const line of lines) {
      // 找到 "Current Network Information:" 部分
      if (line.includes('Current Network Information:')) {
        inCurrentNetwork = true
        continue
      }
      
      // 在 "Current Network Information" 部分中，下一行是 SSID（缩进的）
      if (inCurrentNetwork) {
        const trimmed = line.trim()
        // 跳过空行
        if (!trimmed) continue
        
        // SSID 行格式： "WiFi名称": （带冒号和引号，或没有引号）
        // 排除已知的字段名
        const knownFields = ['PHY Mode', 'Channel', 'Country Code', 'Network Type', 'Security', 'Signal / Noise', 'Transmit Rate', 'MCS Index', 'Last Associated', 'BSSID']
        const isKnownField = knownFields.some(field => trimmed.startsWith(field))
        
        if (!isKnownField && trimmed.includes(':')) {
          // 提取 SSID（去掉引号和冒号）
          const ssid = trimmed.replace(/":?\s*$/, '').replace(/^"/, '').trim()
          
          // 检查是否被红化
          if (ssid === '<redacted>') {
            return { ssid: '', error: '系统权限不足，无法自动获取 WiFi 名称，请手动输入' }
          }
          
          if (ssid && ssid !== '') {
            return { ssid }
          }
        }
        
        // 如果遇到下一个主要部分（如 "Other Local Wi-Fi Networks"），停止解析
        if (trimmed.startsWith('Other') || trimmed.startsWith('Preferred')) {
          break
        }
      }
    }
    
    return { ssid: '', error: '无法获取 WiFi 名称，请手动输入' }
  } catch (error: any) {
    return { ssid: '', error: error.message || '获取失败' }
  }
}

/**
 * 获取 WiFi 接口名称
 */
export async function getWifiInterface(): Promise<string> {
  try {
    const platform = process.platform
    
    if (platform === 'darwin') {
      const { stdout } = await execAsync('networksetup -listallhardwareports')
      const lines = stdout.split('\n')
      let foundWifi = false
      
      for (const line of lines) {
        if (line.includes('Wi-Fi')) {
          foundWifi = true
        }
        if (foundWifi && line.includes('Device:')) {
          const match = line.match(/Device:\s*(.+)/)
          if (match && match[1]) {
            return match[1].trim()
          }
        }
      }
      
      return 'en0'
    } else if (platform === 'win32') {
      return 'Wi-Fi'
    } else {
      return 'wlan0'
    }
  } catch (error) {
    return 'en0'
  }
}
