// 测试 require('electron') 在 node 下返回什么
const electron = require('electron')
console.log('typeof electron:', typeof electron)
console.log('electron value (first 200 chars):', JSON.stringify(String(electron)).substring(0, 200))
try {
  console.log('app:', electron.app)
  console.log('app.whenReady:', typeof electron.app?.whenReady)
} catch (e) {
  console.log('error:', e.message)
}
