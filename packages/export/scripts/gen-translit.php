<?php
// Generates src/generated/translit.json: glibc iconv //TRANSLIT ASCII replacements per code point,
// used by the charset conversion when a character has no mapping in the target charset
// (phpMyAdmin converts with iconv($src, $dest . '//TRANSLIT')).
$out = [];
for ($cp = 0x80; $cp <= 0x2FFFF; $cp++) {
    if ($cp >= 0xD800 && $cp <= 0xDFFF) {
        continue;
    }
    $ch = mb_chr($cp, 'UTF-8');
    if ($ch === false) {
        continue;
    }
    $r = @iconv('UTF-8', 'ASCII//TRANSLIT', $ch);
    if ($r === false || $r === '' || $r === '?') {
        continue;
    }
    $out[dechex($cp)] = $r;
}
@mkdir(__DIR__ . '/../src/generated');
file_put_contents(__DIR__ . '/../src/generated/translit.json', json_encode($out, JSON_UNESCAPED_SLASHES) . "\n");
echo count($out), "\n";
