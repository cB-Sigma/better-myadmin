<?php

/**
 * Fixtures for src/util/php.ts: phpMyAdmin's Util::formatNumber, is_numeric, addslashes, ucwords,
 * preg_quote and the bind-parameter replacement of ImportController.
 *
 * Usage: php apps/server/scripts/gen-php-util.php [/path/to/pma] > apps/server/test/unit/fixtures/php-util.json
 */

declare(strict_types=1);

require ($argv[1] ?? '/home/user/ref/pma') . '/vendor/autoload.php';

use PhpMyAdmin\Util;

$numbers = [0, 1, -1, 0.5, 0.000045, 0.0000004, 0.0123, 0.000123456, 1.005, 2.5, 45.678, 999.9995, 1000,
    123456789, 0.001, 0.0049, 0.005, 99.995, 100, 33.333333, 66.666667, 0.00000001, 1e-12, 12.3456789, '0.000071',
    '0.000004', '0.000512', '1.23e-5'];
$formats = [[3, 1], [0, 2], [0, 0], [3, 0], [1, 2], [6, 3]];
$formatNumber = [];
foreach ($numbers as $n) {
    foreach ($formats as [$l, $r]) {
        $formatNumber[] = [$n, $l, $r, Util::formatNumber($n, $l, $r)];
    }
}

$numericInputs = ['1', '1.5', '.5', '5.', '-1', '+1', ' 1', '1 ', '1e3', '1E-3', '0x1A', 'abc', '', ' ', '1a', '--1',
    "\n1", "1\n", '1.2.3', '١', 'INF', 'NAN', '00012', '1_000'];
$isNumeric = array_map(static fn ($s) => [$s, is_numeric($s)], $numericInputs);

$slashInputs = ["a'b", 'a"b', 'a\\b', "a\0b", 'plain', "it's \"x\" \\ y"];
$addslashes = array_map(static fn ($s) => [$s, addslashes($s)], $slashInputs);

$wordsInputs = ['starting', 'sending data', 'checking permissions', "a\tb", 'Already Upper', 'x-y z', 'éa b'];
$ucwords = array_map(static fn ($s) => [$s, ucwords($s)], $wordsInputs);

$quoteInputs = [':id', ':a.b', ':x$', ':p1', ':a-b', ':a/b', ':a#b'];
$pregQuote = array_map(static fn ($s) => [$s, preg_quote($s, '/')], $quoteInputs);

// ImportController::__invoke bind parameters
$bindCases = [
    ['SELECT * FROM t WHERE id = :id', [':id' => '5']],
    ['SELECT :param, :param1', [':param' => 'a', ':param1' => 'b']],
    ['SELECT :param1, :param', [':param' => 'a', ':param1' => 'b']],
    ['SELECT :p', [':p' => "it's"]],
    ['SELECT :p', [':p' => '$1 and \\1 and ${1}']],
    ['SELECT :p, :p;', [':p' => '1e3']],
    ['SELECT :a:a', [':a' => 'x']],
    ['SELECT :a', [':a' => ' 12 ']],
    ['SELECT :missing', [':other' => 'z']],
];
$bind = [];
foreach ($bindCases as [$sql, $params]) {
    $out = $sql;
    foreach ($params as $parameter => $replacementValue) {
        if (! is_numeric($replacementValue)) {
            $replacementValue = "'" . addcslashes($replacementValue, "\\'\"\0\n\r\x1a") . "'";
        }

        $quoted = preg_quote($parameter, '/');
        $out = preg_replace('/' . $quoted . '([^a-zA-Z0-9_])/', $replacementValue . '${1}', $out) ?? '';
        $out = preg_replace('/' . $quoted . '$/', $replacementValue, $out) ?? '';
    }

    $bind[] = [$sql, $params, $out];
}

echo json_encode(
    compact('formatNumber', 'isNumeric', 'addslashes', 'ucwords', 'pregQuote', 'bind'),
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION,
), "\n";
