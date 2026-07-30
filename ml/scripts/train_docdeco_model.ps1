param(
    [string]$RawDocxDir = "",
    [int]$SyntheticDocuments = 2000,
    [string]$BaseModel = "vinai/phobert-base-v2",
    [int]$Epochs = 5,
    [int]$BatchSize = 2,
    [int]$WindowSize = 48,
    [int]$GradientAccumulation = 1,
    [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$MlRoot = Join-Path $ProjectRoot "apps\doc-deco\ml"
$MlVenv = Join-Path $ProjectRoot "apps\doc-deco\.venv-ml"
$PythonPath = Join-Path $MlVenv "Scripts\python.exe"
$DefaultRaw = Join-Path $ProjectRoot "data\docdeco\corpus\raw"
$FeedbackDb = Join-Path $ProjectRoot "data\docdeco\docdeco.db"
$WorkDir = Join-Path $ProjectRoot "data\docdeco\training\contextual-v1"
$OutputDir = Join-Path $ProjectRoot "data\docdeco\models\contextual-v1"

if (-not $RawDocxDir) { $RawDocxDir = $DefaultRaw }
New-Item -ItemType Directory -Force -Path $RawDocxDir, $WorkDir, $OutputDir | Out-Null

if (-not (Test-Path -LiteralPath $PythonPath)) {
    python -m venv $MlVenv
}

& $PythonPath -m pip install --upgrade pip
& $PythonPath -m pip install -r (Join-Path $MlRoot "requirements.txt")

$NvidiaAvailable = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($NvidiaAvailable) {
    & $PythonPath -c "import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "NVIDIA GPU detected but CPU-only PyTorch is installed. Installing CUDA 13.0 wheel..."
        & $PythonPath -m pip install --force-reinstall "torch==2.13.0+cu130" `
            --index-url "https://download.pytorch.org/whl/cu130"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & $PythonPath -c "import torch; print(f'CUDA ready: {torch.cuda.get_device_name(0)} | torch={torch.__version__}')"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$env:PYTHONPATH = $MlRoot

if ($PrepareOnly) {
    & $PythonPath -m docdeco_ml.build_dataset `
        --raw-dir $RawDocxDir `
        --output-dir (Join-Path $WorkDir "dataset") `
        --synthetic-documents $SyntheticDocuments `
        --feedback-db $FeedbackDb
    Write-Host "Dataset prepared. Training was not started."
    exit $LASTEXITCODE
}

& $PythonPath -m docdeco_ml.pipeline `
    --raw-dir $RawDocxDir `
    --work-dir $WorkDir `
    --output-dir $OutputDir `
    --synthetic-documents $SyntheticDocuments `
    --feedback-db $FeedbackDb `
    --base-model $BaseModel `
    --epochs $Epochs `
    --batch-size $BatchSize `
    --window-size $WindowSize `
    --gradient-accumulation $GradientAccumulation

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "DocDeco model is ready:"
Write-Host "  $OutputDir"
Write-Host "Restart DocDeco from the Desktop icon to activate it."
