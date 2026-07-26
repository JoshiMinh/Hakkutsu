param(
    [Parameter(Mandatory = $true)]
    [string]$LlamaCppPath,
    [string]$Config = "$PSScriptRoot\pipeline_config.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$settings = Get-Content -LiteralPath $Config -Encoding UTF8 | ConvertFrom-Json
$mergedPath = Join-Path $projectRoot $settings.paths.merged
$ggufDirectory = Join-Path $projectRoot $settings.paths.gguf
$pythonExe = Join-Path $projectRoot ".training-venv\Scripts\python.exe"
$converter = Join-Path $LlamaCppPath "convert_hf_to_gguf.py"
$quantizerCandidates = @(
    (Join-Path $LlamaCppPath "build\bin\Release\llama-quantize.exe"),
    (Join-Path $LlamaCppPath "llama-quantize.exe")
)
$quantizer = $quantizerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Không thấy training Python: $pythonExe"
}
if (-not (Test-Path -LiteralPath $converter)) {
    throw "Không thấy convert_hf_to_gguf.py trong $LlamaCppPath"
}
if (-not $quantizer) {
    throw "Không thấy llama-quantize.exe. Hãy build llama.cpp trước."
}
if (-not (Test-Path -LiteralPath $mergedPath)) {
    throw "Chưa có merged model: $mergedPath"
}

New-Item -ItemType Directory -Force -Path $ggufDirectory | Out-Null
$f16Path = Join-Path $ggufDirectory "hakkutsu-javi-f16.gguf"
$quantizedPath = Join-Path $ggufDirectory "hakkutsu-javi-$($settings.deployment.quantization).gguf"

& $pythonExe $converter $mergedPath --outfile $f16Path --outtype f16
if ($LASTEXITCODE -ne 0) { throw "convert_hf_to_gguf thất bại: $LASTEXITCODE" }

& $quantizer $f16Path $quantizedPath $settings.deployment.quantization
if ($LASTEXITCODE -ne 0) { throw "llama-quantize thất bại: $LASTEXITCODE" }

Write-Host "GGUF đã tạo: $quantizedPath"
