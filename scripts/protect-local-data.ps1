# Preserve and verify all data while replacing legacy directories owned by another account.
param([switch]$EnvironmentOnly)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
function Assert-LocalPath([string]$path) {
    $absolute = [IO.Path]::GetFullPath($path)
    if (-not $absolute.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped the project.' }
    if ((Get-Item -LiteralPath $absolute -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a reparse point.' }
    return $absolute
}
function Set-PrivateAcl([string]$path, [bool]$directory) {
    if ($directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() } else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inherit, 'None', 'Allow'))
    }
    if ($directory) {
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($path), $acl)
    } else {
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path), $acl)
    }
}
$running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -and $_.Name -match '^(sakuya-service|Sakuya Agent|python|electron)\.exe$' }
if ($running) { throw 'Stop project application and Python processes before migration.' }
$source = Join-Path $root '.data'
if (-not $EnvironmentOnly -and (Test-Path -LiteralPath $source)) {
    $source = Assert-LocalPath $source
    $entries = @(Get-ChildItem -LiteralPath $source -Force -Recurse)
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Data contains reparse points.' }
    $suffix = [Guid]::NewGuid().ToString('N')
    $stage = Join-Path $root ('.data-secure-' + $suffix)
    $backup = Join-Path $root ('.data-retired-' + $suffix)
    New-Item -ItemType Directory -Path $stage | Out-Null
    Set-PrivateAcl $stage $true
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force }
    $manifest = @()
    foreach ($file in ($entries | Where-Object { -not $_.PSIsContainer })) {
        $relative = [IO.Path]::GetRelativePath($source, $file.FullName)
        $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if ((Get-FileHash -LiteralPath (Join-Path $stage $relative) -Algorithm SHA256).Hash -ne $digest) { throw 'Data verification failed; original remains in place.' }
        $manifest += [pscustomobject]@{Path=$relative;SHA256=$digest}
    }
    if (@(Get-ChildItem -LiteralPath $stage -Force -Recurse -File).Count -ne $manifest.Count) { throw 'File count mismatch.' }
    # Keep a byte-verified, ACL-protected archive for recovery before replacing
    # anything. ZIP entries do not retain the old permissive Windows ACLs.
    $backupDirectory = Join-Path $root '.build/private-backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    Set-PrivateAcl $backupDirectory $true
    $archivePath = Join-Path $backupDirectory ('local-data-' + $suffix + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archivePath)
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $archived = @{}
        foreach ($entry in $archive.Entries) {
            if (-not $entry.Name) { continue }
            $stream = $entry.Open()
            try { $archived[$entry.FullName.Replace('/', '\')] = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
        }
        if ($archived.Count -ne $manifest.Count) { throw 'Backup file count mismatch; original remains in place.' }
        foreach ($file in $manifest) {
            if ($archived[$file.Path.Replace('/', '\')] -ne $file.SHA256) { throw 'Backup verification failed; original remains in place.' }
        }
    } finally { $archive.Dispose() }
    Move-Item -LiteralPath $source -Destination $backup
    try { Move-Item -LiteralPath $stage -Destination $source } catch { Move-Item -LiteralPath $backup -Destination $source; throw }
    foreach ($file in $manifest) {
        if ((Get-FileHash -LiteralPath (Join-Path $source $file.Path) -Algorithm SHA256).Hash -ne $file.SHA256) { throw 'Final verification failed; original backup retained.' }
    }
    $verifiedBackup = Assert-LocalPath $backup
    Remove-Item -LiteralPath $verifiedBackup -Recurse -Force
    Write-Output ('Protected data directory; verified and preserved files: ' + $manifest.Count)
    Write-Output ('Verified recovery archive retained: ' + $archivePath)
}
$envFile = Join-Path $root '.env'
if (Test-Path -LiteralPath $envFile) {
    $envFile = Assert-LocalPath $envFile
    $temporary = Join-Path $root ('.env.secure-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllBytes($temporary, [IO.File]::ReadAllBytes($envFile))
    Set-PrivateAcl $temporary $false
    if ((Get-FileHash -LiteralPath $temporary).Hash -ne (Get-FileHash -LiteralPath $envFile).Hash) { throw 'Environment verification failed.' }
    $backupDirectory = Join-Path $root '.build/private-backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    Set-PrivateAcl $backupDirectory $true
    Copy-Item -LiteralPath $envFile -Destination (Join-Path $backupDirectory ('environment-' + [Guid]::NewGuid().ToString('N') + '.env'))
    Move-Item -LiteralPath $temporary -Destination $envFile -Force
    Write-Output 'Protected environment file; content preserved.'
}
