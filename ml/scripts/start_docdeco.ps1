$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $ProjectRoot "apps\doc-deco"
$BackendRoot = Join-Path $AppRoot "backend"
$FrontendRoot = Join-Path $AppRoot "word-addin"
$RuntimeRoot = Join-Path $AppRoot ".runtime"
$PythonPath = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$ProcessFile = Join-Path $RuntimeRoot "processes.json"
$MlRoot = Join-Path $AppRoot "ml"
$MlPython = Join-Path $AppRoot ".venv-ml\Scripts\python.exe"
$ModelArtifact = Join-Path $ProjectRoot "data\docdeco\models\contextual-v1"
$ModelAvailable = (Test-Path -LiteralPath (Join-Path $ModelArtifact "config.json")) -and
    (Test-Path -LiteralPath $MlPython)

if (-not (Test-Path -LiteralPath $PythonPath)) {
    python -m venv (Join-Path $ProjectRoot ".venv")
}

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

if (Test-Path -LiteralPath $ProcessFile) {
    $Saved = Get-Content -LiteralPath $ProcessFile | ConvertFrom-Json
    $BackendAlive = Get-Process -Id $Saved.backend -ErrorAction SilentlyContinue
    $FrontendAlive = Get-Process -Id $Saved.frontend -ErrorAction SilentlyContinue
    $ModelAlive = $true
    if ($ModelAvailable) {
        $ModelAlive = $Saved.model -and (Get-Process -Id $Saved.model -ErrorAction SilentlyContinue)
    }
    if ($BackendAlive -and $FrontendAlive -and $ModelAlive) {
        Write-Host "DocDeco is already running at https://localhost:3000"
        Start-Process "https://localhost:3000"
        exit 0
    }
    foreach ($ProcessId in @($Saved.backend, $Saved.frontend, $Saved.model)) {
        if (-not $ProcessId) { continue }
        $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($Process) { Stop-Process -Id $ProcessId }
    }
    Remove-Item -LiteralPath $ProcessFile
}

& $PythonPath -m pip install -q -r (Join-Path $BackendRoot "requirements.txt")

if (-not (Test-Path -LiteralPath (Join-Path $FrontendRoot "node_modules"))) {
    Push-Location $FrontendRoot
    try { npm install } finally { Pop-Location }
}

$BackendOut = Join-Path $RuntimeRoot "backend.out.log"
$BackendErr = Join-Path $RuntimeRoot "backend.err.log"
$FrontendOut = Join-Path $RuntimeRoot "frontend.out.log"
$FrontendErr = Join-Path $RuntimeRoot "frontend.err.log"
$ModelOut = Join-Path $RuntimeRoot "model.out.log"
$ModelErr = Join-Path $RuntimeRoot "model.err.log"
$Env:PYTHONPATH = $BackendRoot

$Backend = Start-Process -FilePath $PythonPath `
    -ArgumentList @("-m", "uvicorn", "docdeco.main:app", "--host", "127.0.0.1", "--port", "8010") `
    -WorkingDirectory $BackendRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $BackendOut -RedirectStandardError $BackendErr

$Frontend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") `
    -WorkingDirectory $FrontendRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $FrontendOut -RedirectStandardError $FrontendErr

$Model = $null
if ($ModelAvailable) {
    $Env:PYTHONPATH = $MlRoot
    $Env:DOCDECO_ARTIFACT_DIR = $ModelArtifact
    $Model = Start-Process -FilePath $MlPython `
        -ArgumentList @("-m", "uvicorn", "docdeco_ml.serve:app", "--host", "127.0.0.1", "--port", "8011") `
        -WorkingDirectory $MlRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $ModelOut -RedirectStandardError $ModelErr
}

@{
    backend = $Backend.Id
    frontend = $Frontend.Id
    model = if ($Model) { $Model.Id } else { $null }
} | ConvertTo-Json | Set-Content -LiteralPath $ProcessFile

Write-Host "DocDeco is running:"
Write-Host "  Demo:     https://localhost:3000"
Write-Host "  API:      http://127.0.0.1:8010/api/docdeco/health"
Write-Host "  Manifest: $FrontendRoot\manifest.xml"
Start-Process "https://localhost:3000"
