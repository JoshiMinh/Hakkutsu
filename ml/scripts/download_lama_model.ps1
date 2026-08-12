$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modelDirectory = Join-Path $projectRoot "data\models\lama"
$modelPath = Join-Path $modelDirectory "big-lama.pt"
$modelUrl = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"

New-Item -ItemType Directory -Force -Path $modelDirectory | Out-Null
curl.exe -L -C - --retry 3 --retry-delay 2 -o $modelPath $modelUrl
$file = Get-Item -LiteralPath $modelPath
if ($file.Length -ne 205803670) {
    throw "Model tải chưa đầy đủ: $($file.Length) / 205803670 byte"
}
Write-Host "LaMa model ready: $($file.FullName)"
