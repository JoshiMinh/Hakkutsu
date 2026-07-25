param(
    [string]$Config = "",
    [string]$EnvironmentFile = "",
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $Config) {
    $Config = Join-Path $PSScriptRoot "pipeline_config.json"
}
if (-not $EnvironmentFile) {
    $EnvironmentFile = Join-Path $projectRoot ".env"
}

$settings = Get-Content -LiteralPath $Config -Encoding UTF8 | ConvertFrom-Json
$reportPath = Join-Path $projectRoot "data\training\javi\reports\evaluation_report.json"
$sourceReportPath = Join-Path $projectRoot "data\training\javi\reports\download_manifest.json"
$prepareReportPath = Join-Path $projectRoot "data\training\javi\reports\prepare_report.json"

foreach ($requiredPath in @($reportPath, $sourceReportPath, $prepareReportPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Missing required report: $requiredPath"
    }
}

$evaluation = Get-Content -LiteralPath $reportPath -Encoding UTF8 | ConvertFrom-Json
$sources = Get-Content -LiteralPath $sourceReportPath -Encoding UTF8 | ConvertFrom-Json
$prepared = Get-Content -LiteralPath $prepareReportPath -Encoding UTF8 | ConvertFrom-Json
$gates = $settings.deployment.gates
$failures = [System.Collections.Generic.List[string]]::new()

if ([double]$evaluation.valid_json_rate -lt [double]$gates.valid_json_rate) {
    $failures.Add("valid_json_rate=$($evaluation.valid_json_rate), required >= $($gates.valid_json_rate)")
}
if ([double]$evaluation.grammar_pattern_recall -lt [double]$gates.grammar_recall) {
    $failures.Add("grammar_pattern_recall=$($evaluation.grammar_pattern_recall), required >= $($gates.grammar_recall)")
}
if ($gates.require_no_split_overlap -and [int]$prepared.split_overlap_count -ne 0) {
    $failures.Add("split_overlap_count=$($prepared.split_overlap_count), required 0")
}
if ($gates.require_accepted_licenses) {
    $unaccepted = @($sources | Where-Object { -not $_.accepted })
    if ($unaccepted.Count -gt 0) {
        $failures.Add("$($unaccepted.Count) data sources have unaccepted licenses")
    }
}
if ($failures.Count -gt 0) {
    throw "Model failed release gates:`n- $($failures -join "`n- ")"
}

$modelName = [string]$settings.deployment.ollama_model
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "Ollama is not available in PATH."
}
$ollamaModels = & ollama list
if ($LASTEXITCODE -ne 0) {
    throw "Could not read the Ollama model list."
}
$modelExists = @($ollamaModels | Select-Object -Skip 1) | Where-Object {
    (($_ -split "\s+")[0]).Trim() -eq $modelName
}
if (-not $modelExists) {
    throw "Ollama model '$modelName' is not registered."
}

$desired = [ordered]@{
    JAVI_ANALYSIS_ENABLED = "true"
    JAVI_ANALYSIS_API_URL = "http://127.0.0.1:11434/v1/chat/completions"
    JAVI_ANALYSIS_API_KEY = ""
    JAVI_ANALYSIS_MODEL = $modelName
    JAVI_ANALYSIS_TIMEOUT = "45"
}

Write-Host "Model passed all release gates."
$desired.GetEnumerator() | ForEach-Object { Write-Host "$($_.Key)=$($_.Value)" }
if (-not $Apply) {
    Write-Host "Dry run only. Add -Apply to update .env."
    return
}

$existing = if (Test-Path -LiteralPath $EnvironmentFile) {
    [System.Collections.Generic.List[string]](
        Get-Content -LiteralPath $EnvironmentFile -Encoding UTF8
    )
} else {
    [System.Collections.Generic.List[string]]::new()
}
$backupPath = "$EnvironmentFile.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
if (Test-Path -LiteralPath $EnvironmentFile) {
    Copy-Item -LiteralPath $EnvironmentFile -Destination $backupPath
}

foreach ($entry in $desired.GetEnumerator()) {
    $prefix = "$($entry.Key)="
    $found = $false
    for ($index = 0; $index -lt $existing.Count; $index++) {
        if ($existing[$index].StartsWith($prefix, [StringComparison]::Ordinal)) {
            $existing[$index] = "$prefix$($entry.Value)"
            $found = $true
        }
    }
    if (-not $found) {
        $existing.Add("$prefix$($entry.Value)")
    }
}
$existing | Set-Content -LiteralPath $EnvironmentFile -Encoding UTF8
Write-Host "Enabled the Ja-Vi model in $EnvironmentFile"
if (Test-Path -LiteralPath $backupPath) {
    Write-Host "Previous environment backup: $backupPath"
}
