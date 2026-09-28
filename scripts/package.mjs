import { spawnSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { editionConfig } from './edition-build.mjs';
const edition = process.argv.find(arg => arg.startsWith('--edition='))?.split('=')[1] || 'dev';
const config = editionConfig(edition);
const output = process.argv.slice(2).find(arg => !arg.startsWith('--')) || config.directories.output;
if (!/^release(?:-[a-z0-9]+)*$/.test(output)) throw new Error('Release output must be a release directory directly inside the project.');
const protect = spawnSync(resolve('.venv/Scripts/python.exe'), ['-c',
  'import sys; from pathlib import Path; sys.path.insert(0,"backend"); from app.private_storage import protect; p=Path(sys.argv[1]).resolve(); assert p.is_relative_to(Path.cwd()); p.mkdir(exist_ok=True); protect(p)', output], { stdio: 'inherit', windowsHide: true });
if (protect.status !== 0) process.exit(protect.status || 1);
let additionalPath = '';
if (process.platform === 'win32' && existsSync('.tools/npm/package/bin/npm-cli.js')) {
  mkdirSync('.tools/bin', { recursive: true });
  writeFileSync('.tools/bin/npm.cmd', '@echo off\r\nnode "%~dp0..\\npm\\package\\bin\\npm-cli.js" %*\r\n');
  additionalPath = resolve('.tools/bin') + delimiter;
}
mkdirSync('.build/builder-cache', { recursive: true });
mkdirSync('.build/builder-temp', { recursive: true });
const environment = { ...process.env, SAKUYA_EDITION: edition, PATH: additionalPath + (process.env.PATH || ''),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || resolve('.build/builder-cache'),
  TEMP: resolve('.build/builder-temp'), TMP: resolve('.build/builder-temp') };
config.directories.output = output;
mkdirSync('.build', { recursive: true });
const configPath = `.build/electron-builder-${edition}.json`;
writeFileSync(configPath, JSON.stringify(config, null, 2));
for (const args of [['scripts/build.mjs'], ['scripts/build-backend.mjs'], ['node_modules/electron/install.js'], ['node_modules/electron-builder/out/cli/cli.js', '--dir', '--config', configPath], ['scripts/verify-package.mjs', `${output}/win-unpacked`, edition]]) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
const scan = spawnSync(resolve('.venv/Scripts/python.exe'), ['scripts/check-publication.py', '--package', `${output}/win-unpacked`], { stdio: 'inherit', windowsHide: true });
if (scan.status !== 0) process.exit(scan.status || 1);

if (process.argv.includes('--installer')) {
  const result = spawnSync(process.execPath, ['node_modules/electron-builder/out/cli/cli.js', '--win', 'nsis', '--x64', '--prepackaged', `${output}/win-unpacked`, '--config', configPath, '--publish', 'never'], { env: environment, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
// Packaging either edition must not replace the workspace's existing shortcuts.
