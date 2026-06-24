const fs = require('fs');
const electron = require('electron');
const result = {
  electronType: typeof electron,
  electronKeys: Object.keys(electron || {}),
  appType: typeof electron.app,
  appKeys: electron.app ? Object.keys(electron.app).slice(0, 10) : [],
};
fs.writeFileSync('/tmp/electron-require-test.json', JSON.stringify(result, null, 2));
process.exit(0);
