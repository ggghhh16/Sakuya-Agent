import { spawnSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const output = JSON.parse(readFileSync('package.json', 'utf8')).build.directories.output;
const protect = spawnSync(resolve('.venv/Scripts/python.exe'), ['-c',
  'import sys; from pathlib import Path; sys.path.insert(0,"backend"); from app.private_storage import protect; p=Path(sys.argv[1]).resolve(); assert p.is_relative_to(Path.cwd()); p.mkdir(exist_ok=True); protect(p)', output], { stdio: 'inherit', windowsHide: true });
if (protect.status !== 0) process.exit(protect.status || 1);
let additionalPath = '';
if (process.platform === 'win32' && existsSync('.tools/npm/package/bin/npm-cli.js')) {
  mkdirSync('.tools/bin', { recursive: true });
  writeFileSync('.tools/bin/npm.cmd', '@echo off\r\nnode "%~dp0..\\npm\\package\\bin\\npm-cli.js" %*\r\n');
  additionalPath = resolve('.tools/bin') + delimiter;
}
const environment = { ...process.env, PATH: additionalPath + (process.env.PATH || '') };
for (const args of [['scripts/build.mjs'], ['scripts/build-backend.mjs'], ['node_modules/electron/install.js'], ['node_modules/electron-builder/out/cli/cli.js', '--dir'], ['scripts/verify-package.mjs', `${output}/win-unpacked`]]) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
const scan = spawnSync(resolve('.venv/Scripts/python.exe'), ['scripts/check-publication.py', '--package', `${output}/win-unpacked`], { stdio: 'inherit', windowsHide: true });
if (scan.status !== 0) process.exit(scan.status || 1);

if (process.platform === 'win32') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/create-shortcuts.ps1'], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
