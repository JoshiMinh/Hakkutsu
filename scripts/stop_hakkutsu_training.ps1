$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runDirectory = Join-Path $projectRoot "data\training\javi\runs"
$pidFile = Join-Path $runDirectory "active.pid.json"

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host "Không có pipeline active."
    exit 0
}

$active = Get-Content -LiteralPath $pidFile -Encoding UTF8 | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($active.pid)" -ErrorAction SilentlyContinue
if (-not $process) {
    Write-Host "PID $($active.pid) đã dừng."
    exit 0
}
if ($process.CommandLine -notlike "*train_hakkutsu_javi.ps1*") {
    throw "Từ chối dừng PID $($active.pid): command line không phải pipeline Hakkutsu."
}

Stop-Process -Id $active.pid
Write-Host "Đã yêu cầu dừng pipeline PID $($active.pid). Checkpoint gần nhất vẫn được giữ."
