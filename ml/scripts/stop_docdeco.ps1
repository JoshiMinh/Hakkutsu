$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProcessFile = Join-Path $ProjectRoot "apps\doc-deco\.runtime\processes.json"

if (-not (Test-Path -LiteralPath $ProcessFile)) {
    Write-Host "DocDeco has no saved running processes."
    exit 0
}

$Processes = Get-Content -LiteralPath $ProcessFile | ConvertFrom-Json

# Vite and the venv launcher can keep child processes alive after their wrapper
# process exits. Stop the exact processes that own DocDeco's two local ports too.
$PortOwners = Get-NetTCPConnection -LocalPort 3000, 8010, 8011 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($ProcessId in $PortOwners) {
    $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($Process) { Stop-Process -Id $ProcessId }
}

foreach ($ProcessId in @($Processes.backend, $Processes.frontend, $Processes.model)) {
    if (-not $ProcessId) { continue }
    $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($Process) { Stop-Process -Id $ProcessId }
}
Remove-Item -LiteralPath $ProcessFile
Write-Host "DocDeco stopped."
