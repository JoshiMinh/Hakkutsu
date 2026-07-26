param(
    [Parameter(Mandatory = $true)]
    [switch]$AcceptLicenses,
    [ValidateRange(100, 20000)]
    [int]$TeacherLimit = 5000
)

$ErrorActionPreference = "Stop"
if (-not $AcceptLicenses) {
    throw "Read ml/javi/sources.json, then run again with -AcceptLicenses."
}

$launcher = Join-Path $PSScriptRoot "start_hakkutsu_training.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $launcher `
    -Stage full `
    -AcceptLicenses `
    -PreventSleep `
    -TeacherLimit $TeacherLimit `
    -Resume auto
if ($LASTEXITCODE -ne 0) {
    throw "Could not start the Hakkutsu Ja-Vi pipeline."
}

