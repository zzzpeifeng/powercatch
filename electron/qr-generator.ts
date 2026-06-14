/**
 * QR 码生成模块
 * 使用 qrcode 库生成 QR 码图片
 * 
 * 安装依赖：npm install qrcode
 */
import QRCode from 'qrcode'

export interface QRCodeoptions {
  /** QR 码内容 */
  text: string
  /** 宽度（像素） */
  width?: number
  /** 边距 */
  margin?: number
  /** 颜色 */
  color?: {
    dark: string
    light: string
  }
}

export interface QRCodeResult {
  success: boolean
  dataUrl?: string
  error?: string
}

/**
 * 生成 QR 码（Data URL 格式）
 * @param options QR 码选项
 * @returns Data URL (base64 编码的 PNG 图片)
 */
export async function generateQRCode(options: QRCodeOptions): Promise<QRCodeResult> {
  try {
    const {
      text,
      width = 256,
      margin = 2,
      color = { dark: '#000000', light: '#FFFFFF' },
    } = options

    const dataUrl = await QRCode.toDataURL(text, {
      width,
      margin,
      color: {
        dark: color.dark,
        light: color.light,
      },
      errorCorrectionLevel: 'M',
    })

    return {
      success: true,
      dataUrl,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * 生成 QR 码（SVG 格式）
 * @param text QR 码内容
 * @returns SVG 字符串
 */
export async function generateQRCodeSVG(text: string): Promise<string> {
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
    return svg
  } catch (error: any) {
    throw error
  }
}

/**
 * 生成 WiFi 配置 QR 码（用于 Android）
 * @param ssid WiFi 名称
 * @param password WiFi 密码
 * @param encryption 加密类型
 * @returns Data URL
 */
export async function generateWifiQRCode(
  ssid: string,
  password: string,
  encryption: 'WPA' | 'WEP' | 'nopass' = 'WPA'
): Promise<QRCodeResult> {
  const wifiString = `WIFI:T:${encryption};S:${ssid};P:${password};;`
  return generateQRCode({ text: wifiString })
}
