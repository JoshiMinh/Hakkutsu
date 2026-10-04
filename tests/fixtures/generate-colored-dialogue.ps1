$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$fixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'colored-dialogue.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$bitmap = [System.Drawing.Bitmap]::new([int]$fixture.width, [int]$fixture.height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$rectangle = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectangle, [System.Drawing.Color]::FromArgb(222, 208, 169), [System.Drawing.Color]::FromArgb(160, 199, 218), 90)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 65, 56), 1)
$format = [System.Drawing.StringFormat]::GenericTypographic
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.FillRectangle($background, $rectangle)
    $graphics.DrawLine($pen, 8, 20, 392, 50)
    $graphics.DrawBezier($pen, 35, 240, 20, 190, 92, 155, 58, 130)
    $graphics.DrawBezier($pen, 240, 245, 224, 185, 299, 170, 262, 146)
    foreach ($passage in $fixture.passages) {
        foreach ($column in $passage.columns) {
            $font = [System.Drawing.Font]::new('Yu Gothic', [single]$column.size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            try {
                if ($font.Name -ne 'Yu Gothic') { throw 'Yu Gothic is required to reproduce this fixture.' }
                for ($index = 0; $index -lt $column.text.Length; $index++) {
                    $graphics.DrawString($column.text.Substring($index, 1), $font, [System.Drawing.Brushes]::Black, $column.x, ($column.y + $index * $column.step), $format)
                }
            } finally { $font.Dispose() }
        }
    }
    $bitmap.Save((Join-Path $PSScriptRoot $fixture.image), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $pen.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
