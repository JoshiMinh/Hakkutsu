$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runDirectory = Join-Path $projectRoot "data\training\javi\runs"
$pidFile = Join-Path $runDirectory "active.pid.json"

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host "Chưa có pipeline active."
    exit 0
}

$active = Get-Content -LiteralPath $pidFile -Encoding UTF8 | ConvertFrom-Json
$process = Get-Process -Id $active.pid -ErrorAction SilentlyContinue
[pscustomobject]@{
    Status = if ($process) { "running" } else { "stopped" }
    PID = $active.pid
    Stage = $active.stage
    StartedAt = $active.started_at
    Stdout = $active.stdout
    Stderr = $active.stderr
} | Format-List

if (Test-Path -LiteralPath $active.stdout) {
    Write-Host "--- log mới nhất ---"
    Get-Content -LiteralPath $active.stdout -Tail 30 -Encoding UTF8
}
