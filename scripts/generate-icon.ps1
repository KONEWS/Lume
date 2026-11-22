Add-Type -AssemblyName System.Drawing
$iconRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\resources'))
[System.IO.Directory]::CreateDirectory($iconRoot) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap(256, 256)
$canvas = [System.Drawing.Graphics]::FromImage($bitmap)
$canvas.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$canvas.Clear([System.Drawing.Color]::FromArgb(255, 20, 30, 32))
$bounds = New-Object System.Drawing.Rectangle(0, 0, 256, 256)
$back = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bounds, [System.Drawing.Color]::FromArgb(255, 55, 74, 69), [System.Drawing.Color]::FromArgb(255, 18, 26, 30), 55)
$canvas.FillRectangle($back, $bounds)
$gold = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bounds, [System.Drawing.Color]::FromArgb(255, 250, 230, 177), [System.Drawing.Color]::FromArgb(255, 149, 186, 169), 90)
$pen = New-Object System.Drawing.Pen($gold, 25)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$canvas.DrawLine($pen, 66, 112, 66, 161)
$canvas.DrawLine($pen, 107, 73, 107, 185)
$canvas.DrawLine($pen, 148, 54, 148, 168)
$canvas.DrawLine($pen, 189, 98, 189, 144)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $iconRoot 'lume.png'), $png)
$file = [System.IO.File]::Create((Join-Path $iconRoot 'lume.ico'))
$writer = New-Object System.IO.BinaryWriter($file)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$png.Length); $writer.Write([UInt32]22)
$writer.Write($png)
$writer.Dispose(); $stream.Dispose(); $canvas.Dispose(); $bitmap.Dispose(); $pen.Dispose(); $back.Dispose(); $gold.Dispose()
Write-Output 'LUME icon created.'
