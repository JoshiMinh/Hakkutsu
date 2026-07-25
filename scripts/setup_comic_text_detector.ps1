$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$vendorPath = Join-Path $projectRoot "data\vendor\comic-text-detector"
$modelDir = Join-Path $projectRoot "data\models\comic-text-detector"
$modelPath = Join-Path $modelDir "comictextdetector.pt"

if (-not (Test-Path -LiteralPath $vendorPath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $vendorPath) | Out-Null
    git clone --depth 1 https://github.com/dmMaze/comic-text-detector.git $vendorPath
}

if (-not (Test-Path -LiteralPath $modelPath)) {
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
    Invoke-WebRequest `
        -Uri "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.2.1/comictextdetector.pt" `
        -OutFile $modelPath
}

Write-Host "comic-text-detector đã sẵn sàng: $modelPath"
