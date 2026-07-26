$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = Join-Path $projectDir ".venv\Scripts\python.exe"
$appUrl = "http://127.0.0.1:8000/"
$healthUrl = "http://127.0.0.1:8000/api/ui-config"
$stdoutLog = Join-Path $projectDir "launcher.out.log"
$stderrLog = Join-Path $projectDir "launcher.err.log"

function Test-MangaApp {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

try {
    if (-not (Test-Path -LiteralPath $pythonExe)) {
        throw "Khong tim thay moi truong Python: $pythonExe"
    }

    if (-not (Test-MangaApp)) {
        $arguments = @(
            "-m", "uvicorn", "backend.main:app",
            "--host", "127.0.0.1",
            "--port", "8000"
        )
        Start-Process `
            -FilePath $pythonExe `
            -ArgumentList $arguments `
            -WorkingDirectory $projectDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog | Out-Null

        $deadline = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $deadline -and -not (Test-MangaApp)) {
            Start-Sleep -Milliseconds 750
        }
    }

    if (-not (Test-MangaApp)) {
        throw "Server khong khoi dong duoc. Hay xem launcher.err.log trong thu muc du an."
    }

    Start-Process $appUrl
}
catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $_.Exception.Message,
        "Manga Translator Studio",
        "OK",
        "Error"
    ) | Out-Null
}
