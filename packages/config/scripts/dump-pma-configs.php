<?php
/**
 * Evaluates every test/fixtures/pma-configs/*.inc.php with the real PHP runtime and
 * phpMyAdmin's Settings class, writing the raw $cfg array and the resulting
 * Settings::asArray() for each file. Used as golden output for pma-import.test.ts
 * and loader.test.ts.
 *
 * Usage: php packages/config/scripts/dump-pma-configs.php /path/to/phpmyadmin > packages/config/test/fixtures/pma-configs.json
 *
 * pma: src/Config.php::loadFromFile (config.inc.php is included with $cfg in scope)
 */

declare(strict_types=1);

$pmaRoot = rtrim($argv[1] ?? (getenv('PMA_ROOT') ?: '/home/user/ref/pma'), '/') . '/';
define('ROOT_PATH', './');
if (! function_exists('__')) {
    function __(string $s): string
    {
        return $s;
    }
}

require $pmaRoot . 'vendor/autoload.php';

$dir = dirname(__DIR__) . '/test/fixtures/pma-configs';
$files = glob($dir . '/*.inc.php');
sort($files);
$out = [];
foreach ($files as $file) {
    $raw = (static function (string $__file): array {
        $cfg = [];
        include $__file;

        return $cfg;
    })($file);
    $out[basename($file)] = [
        'cfg' => $raw,
        'settings' => (new PhpMyAdmin\Config\Settings($raw))->asArray(),
    ];
}

echo json_encode(
    $out,
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
) . "\n";
