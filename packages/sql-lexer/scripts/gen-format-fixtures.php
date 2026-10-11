<?php

/**
 * Generates test/fixtures/format.json: phpmyadmin/sql-parser 6.0.1 Formatter::format() output for
 *   - the library's own FormatterTest cases (text/cli/html, with their options),
 *   - the sql-parser test corpus and scripts/extra-cases.php, formatted the way phpMyAdmin's
 *     /database/sql/format does it (type text, and the "single line" variant) plus html.
 *
 * Usage: php packages/sql-lexer/scripts/gen-format-fixtures.php [/path/to/sql-parser]
 */

declare(strict_types=1);

use PhpMyAdmin\SqlParser\Context;
use PhpMyAdmin\SqlParser\Tests\Utils\FormatterTest;
use PhpMyAdmin\SqlParser\Translator;
use PhpMyAdmin\SqlParser\Utils\Formatter;

$sqlParserRoot = $argv[1] ?? '/home/user/ref/sql-parser';
require $sqlParserRoot . '/vendor/autoload.php';

// The checkout has no dev dependencies: stub the PHPUnit bits FormatterTest needs to load its provider.
if (! class_exists('PHPUnit\Framework\TestCase')) {
    eval('namespace PHPUnit\Framework; abstract class TestCase {}');
    eval('namespace PHPUnit\Framework\Attributes; #[\Attribute] final class DataProvider { public function __construct(string $m) {} }');
}

require_once $sqlParserRoot . '/tests/TestCase.php';
require_once $sqlParserRoot . '/tests/Utils/FormatterTest.php';

Translator::setLocale('en');
set_error_handler(static fn (): bool => true);
ini_set('memory_limit', '2G');

$out = [];

foreach (FormatterTest::formatQueriesProviders() as $name => $case) {
    $options = $case['options'] ?? [];
    $out[] = [
        'name' => 'FormatterTest/' . $name,
        'context' => null,
        'query' => $case['query'],
        'options' => (object) $options,
        'text' => Formatter::format($case['query'], ['type' => 'text'] + $options),
        'cli' => Formatter::format($case['query'], ['type' => 'cli'] + $options),
        'html' => Formatter::format($case['query'], ['type' => 'html'] + $options),
    ];
}

$cases = [];
foreach (['lexer', 'parser', 'bugs', 'misc'] as $dir) {
    $files = glob($sqlParserRoot . '/tests/data/' . $dir . '/*.in');
    sort($files);
    foreach ($files as $file) {
        $query = file_get_contents($file);
        if (! mb_check_encoding($query, 'UTF-8')) {
            continue;
        }

        $name = $dir . '/' . basename($file, '.in');
        $context = null;
        $pos = strpos($name, '_mariadb_');
        if ($pos !== false) {
            $context = 'MariaDb' . (int) substr($name, $pos + 9, 6);
        }

        $cases[] = [$name, $query, $context];
    }
}

foreach (require __DIR__ . '/extra-cases.php' as $extra) {
    $cases[] = ['extra/' . $extra[0], $extra[1], $extra[2]['context'] ?? null];
}

foreach ($cases as [$name, $query, $context]) {
    Context::load($context ?? '');
    Context::setMode();
    try {
        $out[] = [
            'name' => $name,
            'context' => $context,
            'query' => $query,
            'options' => (object) [],
            // pma: src/Controllers/Database/SqlFormatController.php
            'text' => Formatter::format($query, ['type' => 'text']),
            'singleLine' => Formatter::format($query, ['type' => 'text', 'line_ending' => ' ', 'indentation' => '']),
            'html' => Formatter::format($query, ['type' => 'html']),
            'noComments' => Formatter::format($query, ['type' => 'text', 'remove_comments' => true]),
        ];
    } catch (Throwable $e) {
        $out[] = ['name' => $name, 'context' => $context, 'query' => $query, 'phpException' => get_class($e)];
    } finally {
        Context::load();
        Context::setMode();
    }
}

$flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE;
$lines = array_map(static fn ($r): string => json_encode($r, $flags), $out);
file_put_contents(dirname(__DIR__) . '/test/fixtures/format.json', "[\n" . implode(",\n", $lines) . "\n]\n");
printf("format: %d\n", count($out));
