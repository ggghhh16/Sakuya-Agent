param([string]$ReleaseDirectory = 'release-security/win-unpacked')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$executable = Join-Path (Join-Path $projectRoot $ReleaseDirectory) 'Sakuya Agent.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the desktop application first.' }
$executable = (Resolve-Path -LiteralPath $executable).Path
if (-not $executable.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release directory must stay inside this project.' }
$shortcutShell = New-Object -ComObject WScript.Shell
$desktopLink = $shortcutShell.CreateShortcut((Join-Path $projectRoot 'Sakuya Desktop.lnk'))
$desktopLink.TargetPath = $executable
$desktopLink.WorkingDirectory = Split-Path $executable -Parent
$desktopLink.Description = 'Open Sakuya desktop and start its local service automatically'
$desktopLink.Save()
$webLink = $shortcutShell.CreateShortcut((Join-Path $projectRoot 'Sakuya Web.lnk'))
$webLink.TargetPath = $executable
$webLink.Arguments = '--web'
$webLink.WorkingDirectory = Split-Path $executable -Parent
$webLink.Description = 'Start Sakuya and open it in your browser'
$webLink.Save()
New-Item -ItemType Directory -Path (Join-Path $projectRoot '.build') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $projectRoot '.build/active-release.txt') -Value $executable -Encoding utf8
Write-Output 'Created Sakuya Desktop.lnk and Sakuya Web.lnk'
