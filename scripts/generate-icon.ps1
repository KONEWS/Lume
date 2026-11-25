# Rebuild platform assets from the square artwork used by the desktop window.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$art = [Drawing.Image]::FromFile((Join-Path $root 'resources/lume.png'))

function Get-IconPng([int]$size) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $canvas = [Drawing.Graphics]::FromImage($bitmap)
    $stream = [IO.MemoryStream]::new()
    try {
        $canvas.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $canvas.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
        $canvas.DrawImage($art, [Drawing.Rectangle]::new(0, 0, $size, $size))
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally {
        $stream.Dispose()
        $canvas.Dispose()
        $bitmap.Dispose()
    }
}

try {
    $targets = @{
        'public/lume.png' = 128
        'pc-lyrics/public/lume.png' = 128
        'mobile/player-assets/player/lume.png' = 128
        'mobile/harmony/AppScope/resources/base/media/lume.png' = 512
        'mobile/android/app/src/main/res/drawable-nodpi/lume.png' = 432
    }
    foreach ($relative in $targets.Keys) {
        $target = Join-Path $root $relative
        [IO.Directory]::CreateDirectory((Split-Path $target)) | Out-Null
        [IO.File]::WriteAllBytes($target, (Get-IconPng $targets[$relative]))
    }

    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $images = @{}
    $writer = [IO.BinaryWriter]::new([IO.File]::Create((Join-Path $root 'resources/lume.ico')))
    try {
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        foreach ($size in $sizes) {
            $png = Get-IconPng $size
            $images[$size] = $png
            # In an ICO directory, zero represents a 256-pixel dimension.
            $writer.Write([byte]($size % 256))
            $writer.Write([byte]($size % 256))
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]32)
            $writer.Write([UInt32]$png.Length)
            $writer.Write([UInt32]$offset)
            $offset += $png.Length
        }
        foreach ($size in $sizes) { $writer.Write([byte[]]$images[$size]) }
    } finally { $writer.Dispose() }
} finally { $art.Dispose() }
