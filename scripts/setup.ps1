$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path '.venv/Scripts/python.exe')) { python -m venv .venv }
& .venv/Scripts/python.exe -m pip install -r backend/requirements-build.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
if (Get-Command npm -ErrorAction SilentlyContinue) {
    npm ci
} else {
    if (-not (Test-Path '.tools/npm/package/bin/npm-cli.js')) {
        New-Item -ItemType Directory -Force .tools | Out-Null
        python -c "import urllib.request,tarfile,pathlib; p=pathlib.Path('.tools/npm.tgz'); urllib.request.urlretrieve('https://registry.npmjs.org/npm/-/npm-11.6.0.tgz',p); tarfile.open(p).extractall('.tools/npm',filter='data')"
    }
    node .tools/npm/package/bin/npm-cli.js ci
}
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependencies failed' }
node node_modules/electron/install.js
if ($LASTEXITCODE -ne 0) { throw 'Electron runtime installation failed' }
Write-Host 'Ready. Develop: node scripts/dev.mjs. Build standalone app: node scripts/package.mjs'
