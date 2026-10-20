param([Parameter(Mandatory = $true)][string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Source: https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip
# Data license: licenses/UNICODE-LICENSE.txt
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne 'F7A48B2B545ACFAA77B2D607AE28747404CE02BAEFEE16396C5D2D7A8EF34B5E') {
    throw 'Expected the pinned Unicode 17.0.0 Unihan archive.'
}
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
$readings = @{}
$variants = @{}
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.Name -notlike '*.txt') { continue }
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            while ($null -ne ($line = $reader.ReadLine())) {
                $parts = $line.Split("`t")
                if ($parts.Length -ne 3) { continue }
                $char = [char]::ConvertFromUtf32([Convert]::ToInt32($parts[0].Substring(2), 16))
                if ($parts[1] -eq 'kVietnamese') {
                    $readings[$char] = $parts[2].Split(' ')[0].Normalize().ToUpperInvariant()
                } elseif ($parts[1] -eq 'kTraditionalVariant') {
                    $variants[$char] = @($parts[2].Split(' ') | ForEach-Object {
                        [char]::ConvertFromUtf32([Convert]::ToInt32(($_ -split '<')[0].Substring(2), 16))
                    })
                }
            }
        } finally { $reader.Dispose() }
    }
} finally { $zip.Dispose() }
# Fill simplified/shinjitai only when all traditional variants agree. Never
# infer a pronunciation from an unrelated semantic variant.
$directReadings = $readings.Clone()
foreach ($char in $variants.Keys) {
    if ($readings.ContainsKey($char)) { continue }
    $values = @($variants[$char] | ForEach-Object { $directReadings[$_] } | Where-Object { $_ } | Select-Object -Unique)
    if ($values.Count -eq 1 -and @($variants[$char] | Where-Object { !$directReadings.ContainsKey($_) }).Count -eq 0) {
        $readings[$char] = $values[0]
    }
}
$ordered = [ordered]@{}
foreach ($char in ($readings.Keys | Sort-Object { [char]::ConvertToUtf32($_, 0) })) { $ordered[$char] = $readings[$char] }
$destination = Join-Path $PSScriptRoot '../src/shared/japanese/data/hanviet-unihan.json'
[System.IO.Directory]::CreateDirectory((Split-Path $destination)) | Out-Null
[System.IO.File]::WriteAllText($destination, (ConvertTo-Json -InputObject $ordered -Compress -Depth 4) + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Generated $($ordered.Count) offline Hán-Việt readings."
