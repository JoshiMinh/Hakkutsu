param(
    [ValidateSet("setup", "download", "prepare", "teacher", "dataset", "train", "evaluate", "merge", "all", "full")]
    [string]$Stage = "all",
    [switch]$AcceptLicenses,
    [switch]$PreventSleep,
    [int]$TeacherLimit = 0,
    [string]$Resume = "auto"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runner = Join-Path $PSScriptRoot "train_hakkutsu_javi.ps1"
$runDirectory = Join-Path $projectRoot "data\training\javi\runs"
$null = New-Item -ItemType Directory -Force -Path $runDirectory
$pidFile = Join-Path $runDirectory "active.pid.json"

if (Test-Path -LiteralPath $pidFile) {
    $active = Get-Content -LiteralPath $pidFile -Encoding UTF8 | ConvertFrom-Json
    if (Get-Process -Id $active.pid -ErrorAction SilentlyContinue) {
        throw "Pipeline đang chạy với PID $($active.pid)."
    }
}

$arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$runner`"",
    "-Stage", $Stage,
    "-Resume", $Resume
)
if ($AcceptLicenses) { $arguments += "-AcceptLicenses" }
if ($PreventSleep) { $arguments += "-PreventSleep" }
if ($TeacherLimit -gt 0) { $arguments += @("-TeacherLimit", "$TeacherLimit") }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdout = Join-Path $runDirectory "$timestamp-$Stage.stdout.log"
$stderr = Join-Path $runDirectory "$timestamp-$Stage.stderr.log"
$process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList $arguments `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

@{
    pid = $process.Id
    stage = $Stage
    started_at = (Get-Date).ToString("o")
    runner = $runner
    stdout = $stdout
    stderr = $stderr
} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

Write-Host "Pipeline đã chạy nền. PID=$($process.Id)"
Write-Host "Theo dõi: powershell -File `"$PSScriptRoot\hakkutsu_training_status.ps1`""
