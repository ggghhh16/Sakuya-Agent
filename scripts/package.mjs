import { spawnSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
let additionalPath = '';
if (process.platform === 'win32' && existsSync('.tools/npm/package/bin/npm-cli.js')) {
  mkdirSync('.tools/bin', { recursive: true });
  writeFileSync('.tools/bin/npm.cmd', '@echo off\r\nnode "%~dp0..\\npm\\package\\bin\\npm-cli.js" %*\r\n');
  additionalPath = resolve('.tools/bin') + delimiter;
}
const environment = { ...process.env, PATH: additionalPath + (process.env.PATH || '') };
for (const args of [['scripts/build.mjs'], ['scripts/build-backend.mjs'], ['node_modules/electron/install.js'], ['node_modules/electron-builder/out/cli/cli.js', '--dir']]) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.platform === 'win32') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/create-shortcuts.ps1'], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
