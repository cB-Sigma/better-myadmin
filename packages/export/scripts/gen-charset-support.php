<?php
// Generates src/generated/charset-support.json: the character set names each recoding engine
// accepts, for Encoding::listEncodings(), which lists only the AvailableCharsets the engine can
// convert from (`@iconv($charset, 'utf-8', '') !== false` / `mb_convert_encoding('', 'utf-8',
// $charset)` without a ValueError).
// - iconv: every name glibc's `iconv -l` prints (iconv_open upper-cases a name and keeps only
//   letters, digits and `_-.,:` before looking it up)
// - mbstring: every encoding's name, MIME name and aliases (mbstring compares them ignoring case)
// The result is checked against PHP itself for the names of `iconv -l` and of mbstring.
$iconv = [];
foreach (preg_split('/[\s,]+/', (string) shell_exec('iconv -l')) as $token) {
    $name = rtrim($token, '/');
    if ($name !== '') {
        $iconv[$name] = true;
    }
}

$mbstring = [];
foreach (mb_list_encodings() as $encoding) {
    $names = [$encoding, ...mb_encoding_aliases($encoding)];
    $mime = @mb_preferred_mime_name($encoding);
    if (is_string($mime) && $mime !== '') {
        $names[] = $mime;
    }

    foreach ($names as $name) {
        $mbstring[strtolower($name)] = true;
    }
}

// what PHP really accepts (a name glibc lists but cannot convert into UTF-8 is dropped)
$iconv = array_keys(array_filter($iconv, static fn ($_, string $n): bool => @iconv($n, 'utf-8', '') !== false, ARRAY_FILTER_USE_BOTH));
$mbstring = array_keys(array_filter($mbstring, static function ($_, string $n): bool {
    try {
        return mb_convert_encoding('', 'utf-8', $n) !== false;
    } catch (ValueError) {
        return false;
    }
}, ARRAY_FILTER_USE_BOTH));
$iconv = array_map(strval(...), $iconv);
$mbstring = array_map(strval(...), $mbstring);
sort($iconv, SORT_STRING);
sort($mbstring, SORT_STRING);

@mkdir(__DIR__ . '/../src/generated');
file_put_contents(
    __DIR__ . '/../src/generated/charset-support.json',
    json_encode(['iconv' => $iconv, 'mbstring' => $mbstring], JSON_UNESCAPED_SLASHES) . "\n",
);
echo count($iconv), ' iconv, ', count($mbstring), " mbstring\n";
