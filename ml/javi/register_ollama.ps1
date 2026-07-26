param(
    [string]$Config = "$PSScriptRoot\pipeline_config.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$settings = Get-Content -LiteralPath $Config -Encoding UTF8 | ConvertFrom-Json
$ggufDirectory = Join-Path $projectRoot $settings.paths.gguf
$ggufName = "hakkutsu-javi-$($settings.deployment.quantization).gguf"
$ggufPath = Join-Path $ggufDirectory $ggufName
$templatePath = Join-Path $PSScriptRoot "Modelfile.template"
$generatedPath = Join-Path $ggufDirectory "Modelfile"

if (-not (Test-Path -LiteralPath $ggufPath)) {
    throw "Chưa có GGUF: $ggufPath"
}
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "Không tìm thấy ollama trong PATH."
}

$escapedPath = $ggufPath.Replace("\", "/")
$content = (Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8).Replace(
    "{{GGUF_PATH}}",
    $escapedPath
)
Set-Content -LiteralPath $generatedPath -Value $content -Encoding UTF8

& ollama create $settings.deployment.ollama_model -f $generatedPath
if ($LASTEXITCODE -ne 0) { throw "ollama create thất bại: $LASTEXITCODE" }

$envSnippet = Join-Path $ggufDirectory ".env.javi.generated"
@"
JAVI_ANALYSIS_ENABLED=true
JAVI_ANALYSIS_API_URL=http://127.0.0.1:11434/v1/chat/completions
JAVI_ANALYSIS_MODEL=$($settings.deployment.ollama_model)
JAVI_ANALYSIS_API_KEY=
JAVI_ANALYSIS_TIMEOUT=45
"@ | Set-Content -LiteralPath $envSnippet -Encoding UTF8

Write-Host "Ollama model sẵn sàng: $($settings.deployment.ollama_model)"
Write-Host "Cấu hình gợi ý đã tạo: $envSnippet"
Write-Host "Pipeline không tự sửa .env; chỉ bật model sau khi evaluation được duyệt."
