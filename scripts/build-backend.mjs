import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const python = resolve('.venv/Scripts/python.exe');
const args = ['-m', 'PyInstaller', '--noconfirm', '--onedir', '--console', '--name', 'sakuya-service',
  '--distpath', '.build/backend', '--workpath', '.build/pyinstaller', '--specpath', '.build',
  '--paths', 'backend', '--collect-submodules', 'langgraph', '--collect-submodules', 'langchain_core',
  '--copy-metadata', 'langchain-core', '--copy-metadata', 'langgraph', '--copy-metadata', 'langsmith',
  '--collect-data', 'langchain_core', '--hidden-import', 'uvicorn.logging', '--hidden-import', 'uvicorn.loops.asyncio',
  '--hidden-import', 'uvicorn.protocols.http.h11_impl', '--hidden-import', 'uvicorn.lifespan.on', 'backend/service.py'];
const result = spawnSync(python, args, { stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
