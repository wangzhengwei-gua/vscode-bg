param(
    [Parameter(Mandatory=$true)][string]$src,
    [int]$tw = 1920,
    [int]$th = 1080
)
# Crop/scale image to target size (center crop keeping ratio, then resize)
# Safe: dispose original first to release file lock, then overwrite (no delete original)
Add-Type -AssemblyName System.Drawing
$i = [System.Drawing.Image]::FromFile($src)
$sw = $i.Width; $sh = $i.Height
$tr = $tw / $th; $sr = $sw / $sh
if ($sr -gt $tr) {
    $cw = $sh * $tr; $cx = ($sw - $cw) / 2; $cy = 0; $ch = $sh
} else {
    $ch = $sw / $tr; $cy = ($sh - $ch) / 2; $cx = 0; $cw = $sw
}
$bmp = New-Object System.Drawing.Bitmap($tw, $th)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($i,
    (New-Object System.Drawing.Rectangle(0, 0, $tw, $th)),
    (New-Object System.Drawing.Rectangle([int]$cx, [int]$cy, [int]$cw, [int]$ch)),
    [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$i.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq ([System.Drawing.Imaging.ImageFormat]::Jpeg).Guid }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 90L)
$bmp.Save($src, $enc, $params)
$bmp.Dispose()
