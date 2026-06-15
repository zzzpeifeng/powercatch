const fs = require('fs')
const path = require('path')

// 读取 package.json
const pkgPath = path.join(__dirname, '..', 'package.json')
let content = fs.readFileSync(pkgPath, 'utf8')

// 匹配 "version": "x.y.z" 并递增 patch
const versionRegex = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/
const match = content.match(versionRegex)

if (!match) {
  console.error('❌ 无法解析 version 字段')
  process.exit(1)
}

const [, major, minor, patch] = match
const newVersion = `${major}.${minor}.${parseInt(patch, 10) + 1}`
content = content.replace(versionRegex, `"version": "${newVersion}"`)

// 写回文件
fs.writeFileSync(pkgPath, content)
console.log(`📦 Version bumped to ${newVersion}`)
