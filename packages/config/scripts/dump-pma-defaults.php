<?php
/**
 * Dumps phpMyAdmin's configuration defaults as JSON.
 *
 * Usage: php packages/config/scripts/dump-pma-defaults.php /path/to/phpmyadmin > packages/config/test/fixtures/pma-defaults.json
 *
 * pma: src/Config/Settings.php::asArray, src/Config/Settings/Server.php::asArray,
 *      src/Config/Forms/User/UserFormList.php::getFields
 *
 * ROOT_PATH is defined as './' so TempDir resolves to './tmp/' (phpMyAdmin's
 * documented default) instead of an absolute path of the machine running this.
 */

declare(strict_types=1);

$pmaRoot = $argv[1] ?? getenv('PMA_ROOT') ?: '/home/user/ref/pma';
$pmaRoot = rtrim($pmaRoot, '/') . '/';

define('ROOT_PATH', './');

if (! function_exists('__')) {
    function __(string $s): string
    {
        return $s;
    }
}

require $pmaRoot . 'vendor/autoload.php';

$settings = new PhpMyAdmin\Config\Settings([]);
$server = new PhpMyAdmin\Config\Settings\Server([]);

// User preference fields (pma: src/Config/Forms/User/UserFormList.php::getFields). FeaturesForm
// only lists DBG/sql when UserprefsDeveloperTab is on, so enable it to get the full list.
$config = PhpMyAdmin\Config::getInstance();
$config->config = new PhpMyAdmin\Config\Settings(['UserprefsDeveloperTab' => true]);
$userPrefFields = array_values(array_filter(
    PhpMyAdmin\Config\Forms\User\UserFormList::getFields(),
    static fn (string $field): bool => ! str_starts_with($field, ':group:'),
));
$commit = trim((string) @shell_exec('git -C ' . escapeshellarg($pmaRoot) . ' rev-parse HEAD'));

echo json_encode(
    [
        '_meta' => ['source' => 'phpMyAdmin Settings::asArray()', 'commit' => $commit, 'php' => PHP_VERSION],
        'settings' => $settings->asArray(),
        'server' => $server->asArray(),
        'userPrefFields' => $userPrefFields,
    ],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
) . "\n";
