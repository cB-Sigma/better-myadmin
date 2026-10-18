<?php
/**
 * Fixtures of the wrapper's thumbnails (WrapperController, resize=jpeg|png), made with PHP's GD:
 * the sources and GD's resized images, compared by apps/server/test/unit/gd-resize.test.ts.
 * Run: php apps/server/test/fixtures/gd-resize/gen.php (GD 2.3.3 at the time of writing)
 */
$dir = __DIR__;

// an opaque gradient with a pattern, 97 x 61 (odd sizes: partial source pixels)
$a = imagecreatetruecolor(97, 61);
for ($y = 0; $y < 61; $y++) {
    for ($x = 0; $x < 97; $x++) {
        imagesetpixel($a, $x, $y, imagecolorallocate($a, ($x * 7) % 256, ($y * 11) % 256, (($x ^ $y) * 5) % 256));
    }
}
imagepng($a, "$dir/opaque.png");

// the same with an alpha channel (saved with it)
$b = imagecreatetruecolor(40, 30);
imagealphablending($b, false);
imagesavealpha($b, true);
for ($y = 0; $y < 30; $y++) {
    for ($x = 0; $x < 40; $x++) {
        imagesetpixel($b, $x, $y, imagecolorallocatealpha($b, ($x * 13) % 256, ($y * 17) % 256, 90, ($x + $y) % 128));
    }
}
imagepng($b, "$dir/alpha.png");

// a palette GIF with a transparent index
$c = imagecreate(33, 21);
$bg = imagecolorallocate($c, 10, 200, 30);
$fg = imagecolorallocate($c, 250, 20, 120);
imagecolortransparent($c, $bg);
for ($y = 0; $y < 21; $y++) {
    for ($x = 0; $x < 33; $x++) {
        if (($x * $y) % 3 === 0) imagesetpixel($c, $x, $y, $fg);
    }
}
imagegif($c, "$dir/palette.gif");

// a JPEG source
imagejpeg($a, "$dir/photo.jpg", 90);

/** WrapperController's resize */
function thumb(string $file, string $resize, int $newWidth, int $newHeight, string $out): void
{
    $src = imagecreatefromstring(file_get_contents($file));
    $srcWidth = imagesx($src);
    $srcHeight = imagesy($src);
    $ratioWidth = $srcWidth / $newWidth;
    $ratioHeight = $srcHeight / $newHeight;
    if ($ratioWidth < $ratioHeight) {
        $destWidth = (int) round($srcWidth / $ratioHeight);
        $destHeight = $newHeight;
    } else {
        $destWidth = $newWidth;
        $destHeight = (int) round($srcHeight / $ratioWidth);
    }
    $dest = imagecreatetruecolor($destWidth, $destHeight);
    imagecopyresampled($dest, $src, 0, 0, 0, 0, $destWidth, $destHeight, $srcWidth, $srcHeight);
    if ($resize === 'jpeg') {
        imagejpeg($dest, $out, 75);
    } else {
        imagepng($dest, $out);
    }
}

thumb("$dir/opaque.png", 'png', 30, 30, "$dir/opaque-30x30.png");
thumb("$dir/opaque.png", 'png', 200, 100, "$dir/opaque-200x100.png");
thumb("$dir/opaque.png", 'jpeg', 50, 40, "$dir/opaque-50x40.jpg");
thumb("$dir/alpha.png", 'png', 23, 23, "$dir/alpha-23x23.png");
thumb("$dir/palette.gif", 'png', 16, 16, "$dir/palette-16x16.png");
thumb("$dir/photo.jpg", 'png', 41, 41, "$dir/photo-41x41.png");
