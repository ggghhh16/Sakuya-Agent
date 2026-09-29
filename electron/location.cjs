const {execFile} = require('node:child_process');
const {join} = require('node:path');

// Windows' device location provider, not IP lookup or Chromium's Google service.
// Fixed script, no renderer-supplied commands; coordinate data is never logged.
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Device
  $watcher = New-Object System.Device.Location.GeoCoordinateWatcher ([System.Device.Location.GeoPositionAccuracy]::High)
  try {
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    $started = $watcher.TryStart($false, [TimeSpan]::FromSeconds(10))
    while ($watcher.Position.Location.IsUnknown -and $watcher.Permission -ne 'Denied' -and $elapsed.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 150 }
    $point = $watcher.Position.Location
    if ($watcher.Permission -eq 'Denied') { @{ok=$false;reason='denied'} | ConvertTo-Json -Compress }
    elseif (!$point.IsUnknown) {
      $accuracy = $point.HorizontalAccuracy
      if ([double]::IsNaN($accuracy) -or [double]::IsInfinity($accuracy)) { $accuracy = $null }
      @{ok=$true;latitude=$point.Latitude;longitude=$point.Longitude;accuracy=$accuracy} | ConvertTo-Json -Compress
    } else { @{ok=$false;reason='unavailable'} | ConvertTo-Json -Compress }
  } finally { $watcher.Stop(); $watcher.Dispose() }
} catch { @{ok=$false;reason='unavailable'} | ConvertTo-Json -Compress }
`;
let pending;
function deviceLocation() {
  if (process.platform !== 'win32') return Promise.resolve({ok:false,reason:'unavailable'});
  if (pending) return pending;
  pending = new Promise(resolve => {
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    execFile(executable, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,timeout:14000,maxBuffer:8192,encoding:'utf8'}, (error, stdout) => {
        if (error) return resolve({ok:false,reason:error.killed?'timeout':'unavailable'});
        try {
          const result=JSON.parse(stdout.trim());
          if (result.ok && Number.isFinite(result.latitude) && Math.abs(result.latitude)<=90 && Number.isFinite(result.longitude) && Math.abs(result.longitude)<=180)
            return resolve({ok:true,latitude:result.latitude,longitude:result.longitude,accuracy:Number.isFinite(result.accuracy)&&result.accuracy>=0?result.accuracy:null});
          resolve({ok:false,reason:result.reason==='denied'?'denied':'unavailable'});
        } catch { resolve({ok:false,reason:'unavailable'}); }
      });
  }).finally(() => {pending=undefined;});
  return pending;
}
module.exports = {deviceLocation};
