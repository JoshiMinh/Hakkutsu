param(
    [ValidateSet("setup", "download", "prepare", "teacher", "dataset", "train", "evaluate", "merge", "all", "full")]
    [string]$Stage = "all",
    [switch]$AcceptLicenses,
    [switch]$PreventSleep,
    [int]$TeacherLimit = 0,
    [string]$Config = "",
    [string]$Resume = "auto"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$trainingRoot = Join-Path $projectRoot "training\javi"
if (-not $Config) {
    $Config = Join-Path $trainingRoot "pipeline_config.json"
}
$trainingPython = Join-Path $projectRoot ".training-venv\Scripts\python.exe"
$requirements = Join-Path $trainingRoot "requirements-training.txt"
$runDirectory = Join-Path $projectRoot "data\training\javi\runs"
$null = New-Item -ItemType Directory -Force -Path $runDirectory
$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$stageLog = Join-Path $runDirectory "$runId-$Stage.transcript.log"

function Enable-ProcessSleepBlock {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HakkutsuPower {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
    [void][HakkutsuPower]::SetThreadExecutionState(0x80000001)
}

function Disable-ProcessSleepBlock {
    if ("HakkutsuPower" -as [type]) {
        [void][HakkutsuPower]::SetThreadExecutionState(0x80000000)
    }
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$PackageId
    )
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is required to install $PackageId automatically."
    }
    & winget install --exact --id $PackageId --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Automatic install failed: $PackageId"
    }
    Refresh-ProcessPath
}

function Ensure-SystemPrerequisites {
    $pythonReady = $false
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.11 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)"
        $pythonReady = $LASTEXITCODE -eq 0
    }
    if (-not $pythonReady) {
        Install-WingetPackage "Python.Python.3.11"
        if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
            throw "Python launcher is unavailable after installing Python 3.11."
        }
    }

    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Install-WingetPackage "Ollama.Ollama"
    }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        $ollamaDirectory = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
        if (Test-Path -LiteralPath (Join-Path $ollamaDirectory "ollama.exe")) {
            $env:Path = "$ollamaDirectory;$env:Path"
        } else {
            throw "Ollama is unavailable after automatic installation."
        }
    }

    & ollama list *> $null
    if ($LASTEXITCODE -ne 0) {
        Start-Process -FilePath (Get-Command ollama).Source `
            -ArgumentList "serve" `
            -WindowStyle Hidden | Out-Null
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 2
            try {
                Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" `
                    -TimeoutSec 2 | Out-Null
                $ready = $true
                break
            } catch {
                # Ollama is still starting.
            }
        }
        if (-not $ready) { throw "Ollama did not start within 60 seconds." }
    }

    $settings = Get-Content -LiteralPath $Config -Encoding UTF8 | ConvertFrom-Json
    $teacherModel = [string]$settings.teacher.model
    $installedModels = & ollama list
    $teacherReady = @($installedModels | Select-Object -Skip 1) | Where-Object {
        (($_ -split "\s+")[0]).Trim() -eq $teacherModel
    }
    if (-not $teacherReady) {
        & ollama pull $teacherModel
        if ($LASTEXITCODE -ne 0) {
            throw "Could not pull teacher model: $teacherModel"
        }
    }
}

function Ensure-TrainingEnvironment {
    if (-not (Test-Path -LiteralPath $trainingPython)) {
        Write-Host "Tạo virtualenv training riêng..."
        & py -3.11 -m venv (Join-Path $projectRoot ".training-venv")
        if ($LASTEXITCODE -ne 0) {
            throw "Không tạo được .training-venv. Cần cài Python 3.11 x64."
        }
    }
    & $trainingPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Không nâng cấp được pip." }
    & $trainingPython -m pip install -r $requirements
    if ($LASTEXITCODE -ne 0) { throw "Không cài được dependency training." }
}

function Invoke-PythonStage {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @()
    )
    $scriptPath = Join-Path $trainingRoot $Script
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "Thiếu script stage: $scriptPath"
    }
    Write-Host "=== $Script ==="
    & $trainingPython $scriptPath --config $Config @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Stage $Script thất bại với exit code $LASTEXITCODE"
    }
}

function Invoke-Download {
    $arguments = @()
    if ($AcceptLicenses) { $arguments += "--accept-licenses" }
    Invoke-PythonStage "download_data.py" $arguments
}

function Invoke-Teacher {
    $arguments = @()
    if ($TeacherLimit -gt 0) {
        $arguments += @("--limit", "$TeacherLimit")
    }
    Invoke-PythonStage "teacher_annotate.py" $arguments
}

function Ensure-LlamaCpp {
    $llamaCppPath = Join-Path $projectRoot "data\tools\llama.cpp"
    $converter = Join-Path $llamaCppPath "convert_hf_to_gguf.py"
    $quantizerCandidates = @(
        (Join-Path $llamaCppPath "build\bin\Release\llama-quantize.exe"),
        (Join-Path $llamaCppPath "llama-quantize.exe")
    )
    if (-not (Test-Path -LiteralPath $converter)) {
        $toolsRoot = Split-Path -Parent $llamaCppPath
        $sourceZip = Join-Path $toolsRoot "llama.cpp-source.zip"
        $sourceExtract = Join-Path $toolsRoot "llama.cpp-source"
        $null = New-Item -ItemType Directory -Force -Path $toolsRoot
        Invoke-WebRequest `
            -Uri "https://github.com/ggml-org/llama.cpp/archive/refs/heads/master.zip" `
            -OutFile $sourceZip
        Expand-Archive -LiteralPath $sourceZip -DestinationPath $sourceExtract -Force
        $extracted = Get-ChildItem -LiteralPath $sourceExtract -Directory |
            Select-Object -First 1
        if (-not $extracted) { throw "Could not unpack llama.cpp source." }
        $null = New-Item -ItemType Directory -Force -Path $llamaCppPath
        Copy-Item -Path (Join-Path $extracted.FullName "*") `
            -Destination $llamaCppPath -Recurse -Force
    }
    $quantizer = $quantizerCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if (-not $quantizer) {
        $release = Invoke-RestMethod `
            -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
        $asset = $release.assets | Where-Object {
            $_.name -like "*bin-win-cpu-x64.zip"
        } | Select-Object -First 1
        if (-not $asset) {
            throw "No Windows CPU x64 llama.cpp release asset was found."
        }
        $binaryZip = Join-Path (Split-Path -Parent $llamaCppPath) $asset.name
        $binaryExtract = Join-Path (Split-Path -Parent $llamaCppPath) "llama.cpp-bin"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $binaryZip
        Expand-Archive -LiteralPath $binaryZip -DestinationPath $binaryExtract -Force
        $downloadedQuantizer = Get-ChildItem -LiteralPath $binaryExtract `
            -Recurse -Filter "llama-quantize.exe" | Select-Object -First 1
        if (-not $downloadedQuantizer) {
            throw "Downloaded llama.cpp package has no llama-quantize.exe."
        }
        Copy-Item -LiteralPath $downloadedQuantizer.FullName `
            -Destination (Join-Path $llamaCppPath "llama-quantize.exe") -Force
    }
    return $llamaCppPath
}

function Invoke-Release {
    $llamaCppPath = Ensure-LlamaCpp
    & powershell -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $trainingRoot "export_gguf.ps1") `
        -LlamaCppPath $llamaCppPath `
        -Config $Config
    if ($LASTEXITCODE -ne 0) { throw "Export GGUF thất bại." }
    & powershell -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $trainingRoot "register_ollama.ps1") `
        -Config $Config
    if ($LASTEXITCODE -ne 0) { throw "Đăng ký model Ollama thất bại." }
    & powershell -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $trainingRoot "promote_model.ps1") `
        -Config $Config `
        -Apply
    if ($LASTEXITCODE -ne 0) { throw "Model không được bật do chưa vượt cổng phát hành." }
}

Start-Transcript -LiteralPath $stageLog | Out-Null
try {
    if ($PreventSleep) { Enable-ProcessSleepBlock }
    Set-Location -LiteralPath $projectRoot
    if ($Stage -eq "setup") {
        Ensure-TrainingEnvironment
        return
    }
    if ($Stage -eq "full") {
        Ensure-SystemPrerequisites
        Ensure-TrainingEnvironment
    } elseif ($Stage -eq "all") {
        Ensure-TrainingEnvironment
    } elseif (-not (Test-Path -LiteralPath $trainingPython)) {
        throw "Chưa có .training-venv. Chạy stage setup trước."
    }
    switch ($Stage) {
        "download" { Invoke-Download }
        "prepare" { Invoke-PythonStage "prepare_dataset.py" }
        "teacher" { Invoke-Teacher }
        "dataset" { Invoke-PythonStage "build_sft_dataset.py" }
        "train" { Invoke-PythonStage "train_qlora.py" @("--resume", $Resume) }
        "evaluate" { Invoke-PythonStage "evaluate_model.py" }
        "merge" { Invoke-PythonStage "merge_adapter.py" }
        "all" {
            Invoke-Download
            Invoke-PythonStage "prepare_dataset.py"
            Invoke-Teacher
            Invoke-PythonStage "build_sft_dataset.py"
            Invoke-PythonStage "train_qlora.py" @("--resume", $Resume)
            Invoke-PythonStage "evaluate_model.py"
            Invoke-PythonStage "merge_adapter.py"
        }
        "full" {
            Invoke-Download
            Invoke-PythonStage "prepare_dataset.py"
            Invoke-Teacher
            Invoke-PythonStage "build_sft_dataset.py"
            Invoke-PythonStage "train_qlora.py" @("--resume", $Resume)
            Invoke-PythonStage "evaluate_model.py"
            Invoke-PythonStage "merge_adapter.py"
            Invoke-Release
        }
    }
    Write-Host "Pipeline stage '$Stage' hoàn tất."
}
finally {
    if ($PreventSleep) { Disable-ProcessSleepBlock }
    Stop-Transcript | Out-Null
}
