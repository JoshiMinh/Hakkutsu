param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$ThieuChuu
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Source: https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip
# Data license: licenses/UNICODE-LICENSE.txt
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne '4C93EA9C1F636451729A840978F1667A53886AF37BA854FDCCE109721C63D43E') {
    throw 'Expected the pinned Unicode 18.0.0 Unihan archive.'
}
# Thiều Chửu's Hán Việt tự điển, digitized by catusf/tudien (CC0-1.0).
if ((Get-FileHash -LiteralPath $ThieuChuu -Algorithm SHA256).Hash -ne '6266861966039B984126D0FB2852C918727B7E4930888C7ED2A31E66E0F68F28') {
    throw 'Expected the pinned TudienThienChuu.tab file.'
}
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
$readings = @{}
$variants = [ordered]@{ kJapaneseOldVariant = @{}; kJapaneseNewVariant = @{}; kTraditionalVariant = @{} }
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.Name -notlike '*.txt') { continue }
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try {
            while ($null -ne ($line = $reader.ReadLine())) {
                $parts = $line.Split("`t")
                if ($parts.Length -ne 3 -or !$parts[0].StartsWith('U+')) { continue }
                if ($parts[1] -ne 'kVietnamese' -and !$variants.Contains($parts[1])) { continue }
                $char = [char]::ConvertFromUtf32([Convert]::ToInt32($parts[0].Substring(2), 16))
                if ($parts[1] -eq 'kVietnamese') {
                    $readings[$char] = $parts[2].Split(' ')[0].Normalize().ToUpperInvariant()
                } else {
                    $variants[$parts[1]][$char] = @(($parts[2] -split '\s+') | ForEach-Object {
                        [char]::ConvertFromUtf32([Convert]::ToInt32(($_ -split '<')[0].Substring(2), 16))
                    })
                }
            }
        } finally { $reader.Dispose() }
    }
} finally { $zip.Dispose() }
# Use direct readings for variant targets and require agreement between all targets.
function Add-VariantReadings($Readings, $DirectReadings, $Variants) {
    foreach ($group in $Variants.Values) {
        foreach ($char in $group.Keys) {
            if ($Readings.ContainsKey($char)) { continue }
            if ($group[$char] | Where-Object { !$DirectReadings.ContainsKey($_) } | Select-Object -First 1) { continue }
            $values = @($group[$char] | ForEach-Object { $DirectReadings[$_] } | Select-Object -Unique)
            if ($values.Count -eq 1) {
                $Readings[$char] = $values[0]
            }
        }
    }
}
$directReadings = $readings.Clone()
Add-VariantReadings $readings $directReadings $variants

foreach ($line in [System.IO.File]::ReadLines((Resolve-Path -LiteralPath $ThieuChuu))) {
    $parts = $line -split "`t", 2
    $char = $parts[0]
    if ($parts.Length -ne 2 -or $directReadings.ContainsKey($char)) { continue }

    $field = ($parts[1] -split '<br>', 2)[0]
    foreach ($candidate in ($field -split '\|')) {
        $reading = ($candidate -replace '\(\d+ n\)|[.,;]', '').Trim().Normalize().ToLowerInvariant()
        if ($reading -cnotmatch '^[\p{Ll}\p{M}]+$') { continue }
        $directReadings[$char] = $reading.ToUpperInvariant()
        if (!$readings.ContainsKey($char)) { $readings[$char] = $directReadings[$char] }
        break
    }
}
Add-VariantReadings $readings $directReadings $variants

$ordered = [ordered]@{}
foreach ($char in ($readings.Keys | Sort-Object { [char]::ConvertToUtf32($_, 0) })) { $ordered[$char] = $readings[$char] }
$destination = Join-Path $PSScriptRoot '../src/shared/japanese/data/hanviet-unihan.json'
[System.IO.Directory]::CreateDirectory((Split-Path $destination)) | Out-Null
[System.IO.File]::WriteAllText($destination, (ConvertTo-Json -InputObject $ordered -Compress -Depth 4) + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Generated $($ordered.Count) offline Hán-Việt readings."
