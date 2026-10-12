<?php
/**
 * Dumps phpMyAdmin's user preference, page settings and setup script forms as JSON: the tabs, their form
 * groups and fields (in order, with `:group:` headers), each field's type, select values,
 * name / description / comment (untranslated msgids, BBCode kept) and the validators.
 *
 * Usage: php packages/config/scripts/dump-pma-forms.php /path/to/phpmyadmin > packages/config/src/generated/pma-forms.json
 *
 * pma: src/Config/Forms/User/*, src/Config/Forms/Page/*, src/Config/Forms/Setup/*, src/Config/Form.php::readTypes,
 *      src/Config/Form.php::getOptionValueList, src/Config/ConfigFile.php::getAllowedValues,
 *      src/Config/Descriptions.php::getString, src/Config/Validator.php::loadValidators
 *
 * Gettext calls return their msgid; `_pgettext` returns "context\x04msgid" so the context is kept.
 */

declare(strict_types=1);

$pmaRoot = $argv[1] ?? getenv('PMA_ROOT') ?: '/home/user/ref/pma';
$pmaRoot = rtrim($pmaRoot, '/') . '/';

define('ROOT_PATH', './');

function __(string $s): string
{
    return $s;
}

function _pgettext(string $ctx, string $s): string
{
    return $ctx . "\x04" . $s;
}

function _gettext(string $s): string
{
    return $s;
}

require $pmaRoot . 'vendor/autoload.php';

use PhpMyAdmin\Config;
use PhpMyAdmin\Config\ConfigFile;
use PhpMyAdmin\Config\Descriptions;
use PhpMyAdmin\Config\Form;
use PhpMyAdmin\Config\Forms\Page\PageFormList;
use PhpMyAdmin\Config\Forms\Setup\SetupFormList;
use PhpMyAdmin\Config\Forms\User\UserFormList;

$config = Config::getInstance();
$config->config = new Config\Settings(['UserprefsDeveloperTab' => true]);

$configFile = new ConfigFile([]);
$charsets = array_merge([''], $config->config->AvailableCharsets);

/** @return array{msgid: string, context?: string} */
function msg(string $s): array
{
    $p = strpos($s, "\x04");

    return $p === false ? ['msgid' => $s] : ['msgid' => substr($s, $p + 1), 'context' => substr($s, 0, $p)];
}

$fields = [];
$describe = static function (string $path, Form $form, string $field) use (&$fields, $configFile, $charsets): void {
    if (isset($fields[$path])) {
        return;
    }

    $type = $form->getOptionType($field);
    $entry = ['type' => $type];
    if ($type === 'select') {
        if ($configFile->getDbEntry($path) === $charsets) {
            $entry['valuesFrom'] = 'AvailableCharsets';
        } else {
            $values = [];
            foreach ($form->getOptionValueList($path) as $k => $v) {
                $values[] = ['key' => $k, 'label' => is_string($v) ? msg($v) : $v];
            }

            $entry['values'] = $values;
        }
    }

    $key = str_replace(['Servers/1/', '/'], ['Servers/', '_'], $path);
    foreach (['name', 'desc', 'cmt'] as $t) {
        $s = Descriptions::getString($key, $t);
        if ($s !== null && $s !== '') {
            $entry[$t] = $s;
        }
    }

    $fields[$path] = $entry;
};

/** @param array<string, class-string> $classes */
$dumpList = static function (array $classes) use ($configFile, $describe): array {
    $out = [];
    foreach ($classes as $tab => $class) {
        $forms = [];
        foreach ($class::getForms() as $formName => $def) {
            Form::resetGroupCounter();
            $form = new Form($formName, $def, $configFile);
            $items = [];
            foreach ($form->fields as $field => $path) {
                $field = (string) $field;
                if (str_starts_with($field, ':group:')) {
                    $items[] = str_starts_with($field, ':group:end')
                        ? ['groupEnd' => true]
                        : ['group' => substr($field, 7)];
                    continue;
                }

                $describe($path, $form, $field);
                $item = ['path' => $path];
                if (isset($form->default[$path])) {
                    $item['setvalue'] = (string) $form->default[$path];
                }

                $items[] = $item;
            }

            $forms[] = [
                'name' => $formName,
                'title' => Descriptions::getString('Form_' . $formName, 'name') ?? $formName,
                'desc' => Descriptions::getString('Form_' . $formName, 'desc') ?? '',
                'items' => $items,
            ];
        }

        $out[] = ['tab' => $tab, 'name' => $class::getName(), 'forms' => $forms];
    }

    return $out;
};

$userClasses = (new ReflectionClass(UserFormList::class))->getStaticPropertyValue('all');
$pageClasses = (new ReflectionClass(PageFormList::class))->getStaticPropertyValue('all');
$setupClasses = (new ReflectionClass(SetupFormList::class))->getStaticPropertyValue('all');

// the setup script runs with the default configuration: no Developer tab in the parent FeaturesForm,
// so Setup\FeaturesForm appends its own after Security
$config->config = new Config\Settings([]);
$setupForms = $dumpList($setupClasses);
$config->config = new Config\Settings(['UserprefsDeveloperTab' => true]);

$commit = trim((string) @shell_exec('git -C ' . escapeshellarg($pmaRoot) . ' rev-parse HEAD'));

$dbEntries = (new ReflectionMethod(ConfigFile::class, 'getAllowedValues'))->invoke($configFile);

echo json_encode(
    [
        '_meta' => ['source' => 'phpMyAdmin Config/Forms', 'commit' => $commit],
        'user' => $dumpList($userClasses),
        'page' => $dumpList($pageClasses),
        'setup' => $setupForms,
        'fields' => $fields,
        'validators' => $dbEntries['_validators'],
        'userValidators' => $dbEntries['_userValidators'],
    ],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
) . "\n";
