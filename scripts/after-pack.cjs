const { execFileSync } = require('node:child_process');
const { resolve, join } = require('node:path');
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  execFileSync(resolve('node_modules/electron-winstaller/vendor/rcedit.exe'), [
    join(context.appOutDir, context.packager.appInfo.productFilename + '.exe'),
    '--set-icon', resolve('electron/sakuya.ico'), '--set-version-string', 'ProductName', 'Sakuya',
    '--set-version-string', 'FileDescription', 'Sakuya',
  ], { windowsHide: true });
};
