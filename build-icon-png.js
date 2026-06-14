// build-icon-png.js - 生成 icon.png（用于 Dock 图标）
const { createCanvas } = require('canvas')
const fs = require('fs')
const path = require('path')

const S = 1024
const OUT = path.join(__dirname, 'resources', 'icon.png')

function draw(ctx, w) {
  const cx = w/2, cy = w/2
  const f = w / 1024

  // 背景渐变
  const bg = ctx.createLinearGradient(0, 0, w, w)
  bg.addColorStop(0, '#667eea')
  bg.addColorStop(1, '#764ba2')
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.roundRect(0, 0, w, w, w*0.2)
  ctx.fill()

  // 耳朵
  const ears = [[-260, -340], [260, -340]]
  ears.forEach((off) => {
    const ex = cx + off[0]*f, ey = cy + off[1]*f
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(ex, ey, 120*f, 200*f, 0, 0, Math.PI*2)
    ctx.fill()
    ctx.fillStyle = '#ff9a9e'
    ctx.beginPath()
    ctx.ellipse(ex, ey + 30*f, 70*f, 140*f, 0, 0, Math.PI*2)
    ctx.fill()
  })

  // 头部
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(cx, cy + 40*f, 320*f, 340*f, 0, 0, Math.PI*2)
  ctx.fill()

  // 眼睛
  ;[[-100, -20], [100, -20]].forEach((off) => {
    const ex = cx + off[0]*f, ey = cy + off[1]*f
    ctx.fillStyle = '#1a1a2e'
    ctx.beginPath()
    ctx.ellipse(ex, ey, 42*f, 48*f, 0, 0, Math.PI*2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(ex + 12*f, ey - 10*f, 14*f, 0, Math.PI*2)
    ctx.fill()
  })

  // 鼻子
  ctx.fillStyle = '#ff9a9e'
  ctx.beginPath()
  ctx.ellipse(cx, cy + 60*f, 28*f, 20*f, 0, 0, Math.PI*2)
  ctx.fill()

  // 大板牙
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(cx - 60*f, cy + 90*f, 120*f, 70*f, 8*f)
  ctx.fill()
  ctx.strokeStyle = '#e0e0e0'
  ctx.lineWidth = 3*f
  ctx.beginPath()
  ctx.moveTo(cx, cy + 92*f)
  ctx.lineTo(cx, cy + 158*f)
  ctx.stroke()
}

const canvas = createCanvas(S, S)
draw(canvas.getContext('2d'), S)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, canvas.toBuffer('image/png'))
console.log('已生成:', OUT)
