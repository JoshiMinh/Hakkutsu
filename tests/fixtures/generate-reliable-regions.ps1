$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$fixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'reliable-regions.json') -Raw | ConvertFrom-Json
$bitmap = [System.Drawing.Bitmap]::new([int]$fixture.width, [int]$fixture.height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 3)
$format = [System.Drawing.StringFormat]::GenericTypographic
try {
    # Everything on this page is authored here. No screenshots or UI overlays.
    $graphics.DrawRectangle($pen, 8, 8, 980, 1380)
    $graphics.DrawLine($pen, 8, 640, 390, 640)
    $graphics.DrawLine($pen, 560, 640, 988, 640)
    foreach ($bubble in $fixture.bubbles) {
        $graphics.DrawEllipse($pen, $bubble[0], $bubble[1], $bubble[2], $bubble[3])
    }
    foreach ($passage in $fixture.passages) {
        foreach ($column in $passage.columns) {
            $font = [System.Drawing.Font]::new('Yu Gothic', [single]$column.size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
            try {
                if ($font.Name -ne 'Yu Gothic') { throw 'Yu Gothic is required to reproduce this fixture.' }
                if ($column.step) {
                    for ($index = 0; $index -lt $column.text.Length; $index++) {
                        $graphics.DrawString($column.text.Substring($index, 1), $font, [System.Drawing.Brushes]::Black, $column.x, ($column.y + $index * $column.step), $format)
                    }
                } else {
                    $graphics.DrawString($column.text, $font, [System.Drawing.Brushes]::Black, $column.x, $column.y, $format)
                }
            } finally { $font.Dispose() }
        }
    }
    foreach ($reading in $fixture.furigana) {
        $font = [System.Drawing.Font]::new('Yu Gothic', [single]$reading.size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        try {
            if ($font.Name -ne 'Yu Gothic') { throw 'Yu Gothic is required to reproduce this fixture.' }
            for ($index = 0; $index -lt $reading.text.Length; $index++) {
                $graphics.DrawString($reading.text.Substring($index, 1), $font, [System.Drawing.Brushes]::Black, $reading.x, ($reading.y + $index * $reading.step), $format)
            }
        } finally { $font.Dispose() }
    }
    # Connected strands, eyes and a face outline extend beyond any local crop.
    $graphics.DrawEllipse($pen, 80, 85, 175, 330)
    for ($index = 0; $index -lt 9; $index++) {
        $graphics.DrawBezier($pen, (85 + $index * 14), 80, 270, 160, 35, 285, (85 + $index * 14), 435)
    }
    $graphics.FillEllipse([System.Drawing.Brushes]::Black, 115, 220, 38, 12)
    $graphics.FillEllipse([System.Drawing.Brushes]::Black, 185, 220, 38, 12)
    $graphics.DrawLine($pen, 134, 224, 100, 95)
    $graphics.DrawLine($pen, 204, 224, 240, 95)
    # Flower petals share one connected stem; windows share a frame.
    $graphics.DrawLine($pen, 470, 530, 470, 655)
    for ($index = 0; $index -lt 6; $index++) {
        $angle = $index * [Math]::PI / 3
        $graphics.DrawEllipse($pen, [single](450 + [Math]::Cos($angle) * 28), [single](558 + [Math]::Sin($angle) * 28), 38, 38)
    }
    $graphics.DrawRectangle($pen, 30, 1280, 250, 90)
    for ($x = 30; $x -le 280; $x += 25) { $graphics.DrawLine($pen, $x, 1280, $x, 1370) }
    for ($y = 1280; $y -le 1370; $y += 30) { $graphics.DrawLine($pen, 30, $y, 280, $y) }
    for ($y = 735; $y -lt 910; $y += 7) {
        for ($x = 870; $x -lt 955; $x += 7) { $graphics.FillEllipse([System.Drawing.Brushes]::Black, $x, $y, 2, 2) }
    }
    $graphics.DrawLine($pen, 905, 620, 905, 665)
    $graphics.DrawLine($pen, 870, 642, 940, 642)
    $graphics.DrawLine($pen, 877, 620, 933, 665)
    $graphics.DrawLine($pen, 933, 620, 877, 665)
    $target = Join-Path $PSScriptRoot $fixture.image
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Generated $target (Yu Gothic, 1000x1400)"
} finally {
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
