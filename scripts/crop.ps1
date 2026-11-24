param(
    [Parameter(Mandatory=$true)][string]$src,
    [int]$tw = 1920,
    [int]$th = 1080
)
# 将图片裁剪/缩放到目标尺寸（居中裁切保持比例，再缩放）
Add-Type -AssemblyName System.Drawing
$i = [System.Drawing.Image]::FromFile($src)
$sw = $i.Width; $sh = $i.Height
$tr = $tw / $th; $sr = $sw / $sh
if ($sr -gt $tr) {
    # 源图更宽，裁左右
    $cw = $sh * $tr; $cx = ($sw - $cw) / 2; $cy = 0; $ch = $sh
} else {
    # 源图更高，裁上下
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
$tmp = $src + '.tmp'
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq ([System.Drawing.Imaging.ImageFormat]::Jpeg).Guid }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 90L)
$bmp.Save($tmp, $enc, $params)
$bmp.Dispose(); $i.Dispose()
Remove-Item $src -Force
Rename-Item $tmp $src
