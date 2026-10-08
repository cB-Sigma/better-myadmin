<?php
/**
 * Dumps LanguageManager::$languageData as JSON for scripts/gen-languages.ts.
 * Usage: php scripts/dump-languages.php /path/to/phpmyadmin
 */
declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');
require $root . '/vendor/autoload.php';

$ref = new ReflectionProperty(PhpMyAdmin\I18n\LanguageManager::class, 'languageData');
$data = $ref->getValue();
$out = [];
foreach ($data as $key => [$code, $english, $native, $regex, $mysql]) {
    $out[] = [
        'key' => $key,
        'code' => $code,
        'english' => $english,
        // the table stores some native names as HTML entities; the page shows them decoded
        'native' => html_entity_decode($native, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'regex' => $regex,
        'mysql' => $mysql,
    ];
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
