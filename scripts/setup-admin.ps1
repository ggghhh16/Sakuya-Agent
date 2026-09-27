param([Parameter(Mandatory=$true)][string]$Email)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$env:SAKUYA_DATA_DIR = Join-Path $projectRoot '.data'
$env:SAKUYA_ENV_FILE = Join-Path $projectRoot '.env'
$env:PYTHONUTF8 = '1'
$env:PYTHONPATH = Join-Path $projectRoot 'backend'
$python = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (Test-Path -LiteralPath $python) {
    & $python -m app.auth $Email
} else {
    $service = Join-Path $projectRoot 'release-user-workspace/win-unpacked/resources/backend/sakuya-service.exe'
    if (-not (Test-Path -LiteralPath $service)) { throw '找不到本机 Python 或已打包后端，请先完成构建。' }
    & $service --admin-email $Email
}
if ($LASTEXITCODE -ne 0) { throw '管理员账号配置失败。' }
