$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$application = Join-Path $PSScriptRoot 'release-ui-v7/win-unpacked/Sakuya Agent.exe'
$releaseMarker = Join-Path $PSScriptRoot '.build/active-release.txt'
if (Test-Path -LiteralPath $releaseMarker) {
  $candidate = (Get-Content -LiteralPath $releaseMarker -Raw).Trim()
  if ($candidate.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $candidate)) { $application = $candidate }
}
if (-not (Test-Path -LiteralPath $application)) { throw 'Desktop package not found. Build it with node scripts/package.mjs first.' }
if ($args -contains '--web') { Start-Process -FilePath $application -ArgumentList '--web' -WorkingDirectory (Split-Path $application -Parent) -WindowStyle Hidden }
else { Start-Process -FilePath $application -WorkingDirectory (Split-Path $application -Parent) }
