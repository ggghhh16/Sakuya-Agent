import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const edition = process.env.SAKUYA_EDITION || 'dev';
if (!['dev', 'client'].includes(edition)) throw new Error('Invalid edition');
const output = `.build/backend-${edition}`;
const python = resolve('.venv/Scripts/python.exe');
const args = ['-m', 'PyInstaller', '--noconfirm', '--onedir', '--console', '--name', 'sakuya-service',
  '--distpath', output, '--workpath', `.build/pyinstaller-${edition}`, '--specpath', '.build',
  '--paths', 'backend', '--collect-submodules', 'langgraph', '--collect-submodules', 'langchain_core',
  '--copy-metadata', 'langchain-core', '--copy-metadata', 'langgraph', '--copy-metadata', 'langsmith',
  '--collect-data', 'langchain_core', '--hidden-import', 'uvicorn.logging', '--hidden-import', 'uvicorn.loops.asyncio',
  '--hidden-import', 'uvicorn.protocols.http.h11_impl', '--hidden-import', 'uvicorn.lifespan.on', 'backend/service.py'];
const result = spawnSync(python, args, { stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
if (result.status === 0) writeFileSync(`${output}/sakuya-service/edition.json`, JSON.stringify({edition}) + '\n');
process.exit(result.status ?? 1);
