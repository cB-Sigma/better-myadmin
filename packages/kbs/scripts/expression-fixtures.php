<?php

/**
 * Golden fixtures for the ExpressionLanguage port: evaluates expressions with Symfony's engine (the
 * one phpMyAdmin's advisor uses) and records the result (type + PHP string form) or the exception.
 *
 *   php packages/kbs/scripts/expression-fixtures.php
 *
 * Output: packages/kbs/test/fixtures/expressions.json
 */

declare(strict_types=1);

require __DIR__ . '/../../mysql-types/scripts/pma-bootstrap.php';

use Symfony\Component\ExpressionLanguage\ExpressionLanguage;

$values = [
    'a' => '10', 'b' => '4', 'z' => '0', 'f' => '2.5', 's' => 'abc', 'e' => '', 'big' => '9223372036854775807',
    'neg' => '-3', 'on' => 'ON', 'ws' => ' 12 ', 'lead' => '12abc', 'n' => null, 't' => true, 'i' => 7, 'fl' => 1.5,
    'value' => 0, 'Uptime' => '3600', 'version' => '8.4.11',
];

$expressions = [
    '1 + 2 * 3', '(1 + 2) * 3', '2 ** 3 ** 2', '-2 ** 2', '10 / 4', '10 / 5', 'a / b', 'a / z', 'a / e', 'a / s',
    'a % b', 'a % z', 'f * 2', 'a + b', 'a - f', 's + 1', 'e + 1', 'lead + 1', 'ws * 2', 'big + 1', 'big * 2',
    'neg * neg', 'n + 1', 't + 1', '!z', '!s', '!e', 'not a', 'a > b', 'a < "9"', 's > 1', 'on > 0', 'on == 0',
    'z == ""', 'e == n', 'a == "10.0"', 'a === "10"', 'i === 7', 'fl === 1.5', 'a != b', 'a !== a', 'version > "8.0"',
    'a ~ b', 's ~ i ~ fl', '[a, b, 1]', '[a, b,]', '1 < 2 && 2 < 3', '1 > 2 || s', 'z or e', 'a and b', '1 xor 1',
    'a ? "yes" : "no"', 'z ? "yes" : "no"', 'a ?: "x"', 'n ?? "default"', 'missing ?? "default"', 'min(a, b, 3)',
    'max(1, 2.5, "3")', 'a in [10, "10"]', 'i in [7]', 'a not in [1]', '"ab" contains "b"', 's starts with "a"',
    's matches "/B/i"', '1..3', '1 << 3', '7 & 3', '7 | 8', '5 ^ 1', '~5', '0.1 + 0.2', '1e3', '1_000 + 1', '.5 * 2',
    '10 / 3', '2 / 3 * 3', '1 / 7', '100 - 99.99', '"\\x41\\101\\n"', "'it\\'s'",
    // errors
    'missing', 'Uptim', 'valeu + 1', 'a +', '(a', 'a)', 'unknown(1)', 'roun(1)', '[1 2]', 'a b', '"unterminated', '#', 'a = 1',
    'a.b', 'a.b()', 'a[0]',
];

$el = new ExpressionLanguage();
$cases = [];
foreach ($expressions as $expression) {
    try {
        $r = $el->evaluate($expression, $values);
        $cases[] = ['expression' => $expression, 'type' => get_debug_type($r), 'value' => is_array($r) ? array_map(static fn ($v) => [get_debug_type($v), is_array($v) ? 'Array' : (string) $v], $r) : (is_bool($r) ? ($r ? 'true' : 'false') : (string) $r)];
    } catch (Throwable $e) {
        $cases[] = ['expression' => $expression, 'error' => get_class($e), 'message' => $e->getMessage()];
    }
}

bma_write_fixture(dirname(__DIR__) . '/test/fixtures/expressions.json', ['values' => $values, 'cases' => $cases]);
