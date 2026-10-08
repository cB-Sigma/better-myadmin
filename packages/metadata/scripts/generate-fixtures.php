<?php

/**
 * Golden fixtures for @bettermyadmin/metadata, produced by running phpMyAdmin's own code.
 *
 *   php packages/metadata/scripts/generate-fixtures.php
 *
 * Pure functions are called directly. The configuration-storage discovery (Relation::getRelationParameters,
 * initRelationParamsCache, fixPmaTables, createPmaDatabase) runs against a REAL MySQL server
 * (BMA_MYSQL_HOST/PORT/USER/PASSWORD, default 127.0.0.1:3306 root/root): each scenario builds a scratch
 * database `m1meta_rp` (+ a restricted control user `m1meta_rpu`), runs phpMyAdmin, and records every
 * statement phpMyAdmin sent on the control connection plus the resulting RelationParameters::toArray().
 * Everything created is dropped again.
 */

declare(strict_types=1);

require __DIR__ . '/../../mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Bookmarks\Bookmark;
use PhpMyAdmin\Config;
use PhpMyAdmin\Config\Forms\User\UserFormList;
use PhpMyAdmin\Config\Settings\Server;
use PhpMyAdmin\Config\UserPreferences;
use PhpMyAdmin\ConfigStorage\Features\BookmarkFeature;
use PhpMyAdmin\ConfigStorage\Relation;
use PhpMyAdmin\Current;
use PhpMyAdmin\Dbal\Connection;
use PhpMyAdmin\Dbal\ConnectionType;
use PhpMyAdmin\Dbal\DatabaseInterface;
use PhpMyAdmin\Dbal\DbiMysqli;
use PhpMyAdmin\Dbal\ResultInterface;
use PhpMyAdmin\Identifiers\DatabaseName;
use PhpMyAdmin\Identifiers\TableName;
use PhpMyAdmin\InternalRelations;
use PhpMyAdmin\Template;
use PhpMyAdmin\Transformations;
use PhpMyAdmin\Identifiers\DatabaseName as Db;

$out = __DIR__ . '/../test/fixtures';
@mkdir($out, 0777, true);

// ---------------------------------------------------------------------------------------------
// PHP json_encode() with the default flags (what phpMyAdmin stores in pmadb)
// ---------------------------------------------------------------------------------------------
$jsonCases = [];
foreach (
    [
        ['db' => 'shop', 'table' => 'orders'],
        [['db' => 'a/b', 'table' => 'c"d'], ['db' => 'é', 'table' => '日本']],
        ['Console/Mode' => 'collapse', 'MaxRows' => 50, 'NavigationWidth' => 240, 'ShowAll' => true, 'x' => null],
        ['sorted_col' => '`id` DESC', 'col_order' => [2, 0, 1], 'col_visib' => [1, 0, 1], 'CREATE_TIME' => '2026-10-08 10:00:00'],
        "tab\there\nnew\rline \x08\x0c \x01\x1f \x7f back\\slash 'q' <>&",
        '😀 surrogate pair',
        [],
        [1 => ['db' => 'x', 'table' => 'y'], 2 => ['db' => 'x', 'table' => 'z']],
        ['2fa' => ['backend' => 'application', 'settings' => ['secret' => 'ABC']]],
        [0.5, -3, 0, 1.0, 12345678901],
    ] as $value
) {
    $jsonCases[] = ['value' => $value, 'php' => json_encode($value)];
}

// gaps left by RecentFavoriteTables::remove() (unset) turn the list into a JSON object
$gapCases = [];
foreach ([[0], [1], [2], [0, 2], [1, 2]] as $removeIdx) {
    $tables = [['db' => 'd', 'table' => 't0'], ['db' => 'd', 'table' => 't1'], ['db' => 'd', 'table' => 't2']];
    foreach ($removeIdx as $k) {
        unset($tables[$k]);
    }

    $gapCases[] = ['remove' => $removeIdx, 'php' => json_encode($tables)];
}

// ---------------------------------------------------------------------------------------------
// Bookmark::getVariableCount / applyVariables
// ---------------------------------------------------------------------------------------------
$dbi = bma_dbi();
$feature = new BookmarkFeature(DatabaseName::from('phpmyadmin'), TableName::from('pma__bookmark'));
$bookmarkCases = [];
foreach (
    [
        ['SELECT * FROM t WHERE id = /*[VARIABLE1]*/', [1 => '42']],
        ['SELECT * FROM t WHERE a = [VARIABLE1] AND b = [VARIABLE2]', [1 => 'x', 2 => 'y']],
        ['SELECT [VARIABLE] , [VARIABLE1]', [1 => 'v']],
        ['SELECT /* keep */ 1 /* [VARIABLE1] in comment */, /*[VARIABLE2]*/', [1 => 'A', 2 => 'B']],
        ["SELECT * FROM t WHERE a = '/*[VARIABLE1]*/'\nAND b = /*\n[VARIABLE2]\n*/", [1 => '1', 2 => '2']],
        ['SELECT [VARIABLE1], [VARIABLE3]', [1 => 'one']],
        ['SELECT [VARIABLE2]', []],
        ['SELECT 1', [1 => 'unused']],
        ['SELECT [variable1] /*[VARIABLE1]*/ /*[VARIABLE1]*/', [1 => 'Z']],
    ] as [$query, $vars]
) {
    $b = new Bookmark($dbi, $feature, 'db', 'user', 'label', $query);
    $bookmarkCases[] = [
        'query' => $query,
        'variables' => (object) $vars,
        'count' => $b->getVariableCount(),
        'applied' => $b->applyVariables($vars),
    ];
}

// ---------------------------------------------------------------------------------------------
// Transformations::fixUpMime
// ---------------------------------------------------------------------------------------------
$transformations = new Transformations($dbi, new Relation($dbi));
$mimeCases = [];
foreach (
    ['image/jpeg', 'image_png', 'text/plain', 'application/octetstream', 'Text_Plain_Dateformat.php',
        'text_plain_dateformat.class.php', 'output/text_plain_bool2text', '', 'a b_c1d'] as $v
) {
    $mimeCases[] = ['in' => $v, 'out' => $transformations->fixUpMime($v)];
}

// ---------------------------------------------------------------------------------------------
// Relation::getCreateTableSqlQueries (create_tables.sql split + custom names)
// ---------------------------------------------------------------------------------------------
$relation = new Relation($dbi);
$createCases = [];
foreach ([[], ['pma__bookmark' => 'my_bookmarks', 'pma__history' => 'h'], ['pma__users' => 'pma__usersx']] as $repl) {
    $createCases[] = ['replacements' => (object) $repl, 'queries' => $relation->getCreateTableSqlQueries($repl)];
}

// ---------------------------------------------------------------------------------------------
// UserFormList::getFields and UserPreferences::apply
// ---------------------------------------------------------------------------------------------
$fields = [];
foreach ([false, true] as $devTab) {
    Config::$instance = null;
    $config = Config::getInstance();
    $config->set('UserprefsDeveloperTab', $devTab);
    $fields[$devTab ? 'developer' : 'default'] = UserFormList::getFields();
}

$applyCases = [];
foreach (
    [
        [[], ['MaxRows' => 50, 'Console/Mode' => 'collapse', 'Server/hide_db' => '^test', 'lang' => 'cs',
            'ThemeDefault' => 'original', '2fa' => ['backend' => ''], 'NotAField' => 1, 'Servers/1/only_db' => 'x',
            'DBG/sql' => true, 'Export/format' => 'csv']],
        [['MaxRows', 'Console/Mode'], ['MaxRows' => 50, 'Console/Mode' => 'collapse', 'ShowAll' => true]],
    ] as [$disallow, $data]
) {
    Config::$instance = null;
    $config = Config::getInstance();
    $config->set('UserprefsDisallow', $disallow);
    $config->set('UserprefsDeveloperTab', false);
    $up = new UserPreferences($dbi, new Relation($dbi, $config), new Template($config), $config, new class implements Psr\Clock\ClockInterface {
        public function now(): DateTimeImmutable
        {
            return new DateTimeImmutable('@0');
        }
    });
    $applyCases[] = ['disallow' => $disallow, 'config_data' => $data, 'applied' => $up->apply($data)];
}

// ---------------------------------------------------------------------------------------------
// Configuration storage discovery against a real server
// ---------------------------------------------------------------------------------------------

/** DbiMysqli that records what it sends, per connection kind. */
final class RecordingMysqli extends DbiMysqli
{
    /** @var list<array{conn: string, kind: string, sql: string}> */
    public array $log = [];
    public bool $recording = false;
    /** @var array<int, string> spl_object_id(Connection) → 'user'|'control' */
    public array $names = [];

    private function name(Connection $c): string
    {
        return $this->names[spl_object_id($c)] ?? '?';
    }

    public function selectDb(string|DatabaseName $databaseName, Connection $connection): bool
    {
        if ($this->recording) {
            $this->log[] = ['conn' => $this->name($connection), 'kind' => 'selectDb', 'sql' => (string) $databaseName];
        }

        return parent::selectDb($databaseName, $connection);
    }

    public function realQuery(string $query, Connection $connection, bool $unbuffered = false): \PhpMyAdmin\Dbal\MysqliResult|false
    {
        if ($this->recording) {
            $this->log[] = ['conn' => $this->name($connection), 'kind' => 'query', 'sql' => $query];
        }

        return parent::realQuery($query, $connection, $unbuffered);
    }

    public function realMultiQuery(Connection $connection, string $query): bool
    {
        if ($this->recording) {
            $this->log[] = ['conn' => $this->name($connection), 'kind' => 'multi', 'sql' => $query];
        }

        return parent::realMultiQuery($connection, $query);
    }
}

$host = (string) (getenv('BMA_MYSQL_HOST') ?: '127.0.0.1');
$port = (string) (getenv('BMA_MYSQL_PORT') ?: '3306');
$rootUser = (string) (getenv('BMA_MYSQL_USER') ?: 'root');
$rootPass = (string) (getenv('BMA_MYSQL_PASSWORD') ?: 'root');

$admin = $GLOBALS['bma_mysqli'];
if (! $admin instanceof mysqli) {
    fwrite(STDERR, "relation-storage fixtures need a MySQL server; skipped\n");
    $scenarios = null;
} else {
    $admin->query('SET sql_mode = ""');
    $allTables = array_keys($relation->getCreateTableSqlQueries([]));
    $defaultNames = [
        'bookmarktable' => 'pma__bookmark', 'relation' => 'pma__relation', 'table_info' => 'pma__table_info',
        'table_coords' => 'pma__table_coords', 'pdf_pages' => 'pma__pdf_pages', 'column_info' => 'pma__column_info',
        'history' => 'pma__history', 'recent' => 'pma__recent', 'favorite' => 'pma__favorite',
        'table_uiprefs' => 'pma__table_uiprefs', 'tracking' => 'pma__tracking', 'userconfig' => 'pma__userconfig',
        'users' => 'pma__users', 'usergroups' => 'pma__usergroups', 'navigationhiding' => 'pma__navigationhiding',
        'savedsearches' => 'pma__savedsearches', 'central_columns' => 'pma__central_columns',
        'designer_settings' => 'pma__designer_settings', 'export_templates' => 'pma__export_templates',
    ];

    $q = static function (string $sql) use ($admin): void {
        if (! $admin->query($sql)) {
            throw new RuntimeException($admin->error . ' in ' . $sql);
        }
    };

    $reset = static function () use ($q): void {
        $q('DROP DATABASE IF EXISTS `m1meta_rp`');
        $q('DROP DATABASE IF EXISTS `m1meta_rp_new`');
        $q("DROP USER IF EXISTS 'm1meta_rpu'@'%'");
    };

    /**
     * @param array<string, string> $create  table name in db → default table it is built from
     * @param array<string, mixed>  $server  Servers[1] overrides
     */
    $run = static function (array $sc) use ($q, $reset, $relation, $host, $port, $rootUser, $rootPass): array {
        $reset();
        $create = $sc['create'] ?? null;
        $sqlFile = $relation->getCreateTableSqlQueries([]);
        if ($create !== null) {
            $q('CREATE DATABASE `m1meta_rp` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
            foreach ($create as $name => $from) {
                $ddl = str_replace('`' . $from . '`', '`' . $name . '`', $sqlFile[$from]);
                $q('USE `m1meta_rp`');
                $q($ddl);
                if (($sc['oldColumnInfo'] ?? false) && $from === 'pma__column_info') {
                    $q('ALTER TABLE `m1meta_rp`.`' . $name . '` DROP `input_transformation`, DROP `input_transformation_options`');
                }
            }
        }

        $q("CREATE USER 'm1meta_rpu'@'%' IDENTIFIED BY 'm1meta_rpu'");
        if ($create !== null) {
            if (isset($sc['denyTable'])) {
                foreach ($create as $name => $from) {
                    if ($name !== $sc['denyTable']) {
                        $q("GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON `m1meta_rp`.`" . $name . "` TO 'm1meta_rpu'@'%'");
                    }
                }
            } else {
                $q("GRANT ALL ON `m1meta_rp`.* TO 'm1meta_rpu'@'%'");
            }
        }

        if ($sc['grantCreateNew'] ?? false) {
            $q("GRANT ALL ON `m1meta_rp_new`.* TO 'm1meta_rpu'@'%'");
        }

        Config::$instance = null;
        $config = Config::getInstance();
        $config->set('ZeroConf', true);
        $serverIn = ['host' => $host, 'port' => $port, 'user' => 'm1meta_rpu', 'password' => 'm1meta_rpu',
            'controluser' => 'm1meta_rpu', 'controlpass' => 'm1meta_rpu'] + ($sc['server'] ?? []);
        $config->selectedServer = (new Server($serverIn))->asArray();
        Current::$server = 1;
        Current::$database = $sc['currentDb'] ?? '';

        $ext = new RecordingMysqli();
        $dbi = DatabaseInterface::getInstanceForTest($ext, $config);
        $srv = new Server($config->selectedServer);
        $lm = \PhpMyAdmin\I18n\LanguageManager::getInstance();
        $lm->activate($lm->getLanguage('en'));
        $userConn = $dbi->connect($srv, ConnectionType::User);
        $controlConn = $dbi->connect($srv, ConnectionType::ControlUser);
        $ext->names[spl_object_id($userConn)] = 'user';
        $ext->names[spl_object_id($controlConn)] = 'control';
        DatabaseInterface::$instance = $dbi;

        $rel = new Relation($dbi, $config);
        // reset Relation::$cache (static)
        (static fn () => self::$cache = null)->bindTo(null, Relation::class)();
        Current::$message = null;

        $ext->recording = true;
        $steps = [];
        foreach ($sc['steps'] as $step) {
            $before = count($ext->log);
            $result = null;
            switch ($step) {
                case 'init':
                    $rel->initRelationParamsCache();
                    break;
                case 'params':
                    $result = $rel->getRelationParameters()->toArray();
                    unset($result['version']);
                    break;
                case 'fix_pmadb':
                    $rel->fixPmaTables((string) $rel->getRelationParameters()->db);
                    break;
                case 'fixall_pmadb':
                    $rel->fixPmaTables(Current::$database);
                    break;
                case 'create_pmadb':
                    $name = $rel->getConfigurationStorageDbName();
                    if ($rel->createPmaDatabase($name)) {
                        $rel->fixPmaTables($name);
                    }

                    break;
                case 'flags':
                    $result = [
                        'arePmadbTablesDefined' => $rel->arePmadbTablesDefined(),
                        'arePmadbTablesAllDisabled' => $rel->arePmadbTablesAllDisabled(),
                        'configurationStorageDbName' => $rel->getConfigurationStorageDbName(),
                    ];
                    break;
                default:
                    throw new RuntimeException('unknown step ' . $step);
            }

            $steps[] = [
                'step' => $step,
                'statements' => array_values(array_filter(
                    array_slice($ext->log, $before),
                    static fn (array $e): bool => $e['conn'] === 'control',
                )),
                'result' => $result,
                'message' => Current::$message?->getMessage(),
                'selectedServer' => array_intersect_key(
                    $config->selectedServer,
                    array_flip(['pmadb', ...array_keys($GLOBALS['bma_default_names'])]),
                ),
            ];
            Current::$message = null;
        }

        $ext->recording = false;
        $tablesAfter = [];
        foreach (['m1meta_rp', 'm1meta_rp_new'] as $db) {
            $res = $GLOBALS['bma_mysqli']->query('SHOW TABLES FROM `' . $db . '`');
            $tablesAfter[$db] = $res ? array_map(static fn ($r) => $r[0], $res->fetch_all()) : null;
        }

        $reset();

        return ['name' => $sc['name'], 'setup' => array_diff_key($sc, ['steps' => 1, 'name' => 1]), 'steps' => $steps, 'tablesAfter' => $tablesAfter];
    };

    $GLOBALS['bma_default_names'] = $defaultNames;
    $all = array_combine($allTables, $allTables);
    $named = [];
    foreach ($defaultNames as $k => $v) {
        $named[$k] = $v;
    }

    $scenarioDefs = [
        ['name' => 'no pmadb configured, nothing found', 'server' => [], 'steps' => ['init', 'params', 'flags']],
        ['name' => 'pmadb configured but missing', 'server' => ['pmadb' => 'm1meta_rp'], 'steps' => ['init', 'params', 'flags']],
        ['name' => 'all tables, auto-detected names', 'create' => $all, 'server' => ['pmadb' => 'm1meta_rp'], 'steps' => ['init', 'params', 'flags']],
        ['name' => 'all tables, explicit names', 'create' => $all, 'server' => ['pmadb' => 'm1meta_rp'] + $named, 'steps' => ['init', 'params', 'flags']],
        [
            'name' => 'subset of tables, auto-detected',
            'create' => array_intersect_key($all, array_flip(['pma__bookmark', 'pma__relation', 'pma__history', 'pma__table_coords', 'pma__users'])),
            'server' => ['pmadb' => 'm1meta_rp'],
            'steps' => ['init', 'params', 'flags'],
        ],
        [
            'name' => 'custom table name',
            'create' => ['my_bookmarks' => 'pma__bookmark', 'pma__history' => 'pma__history', 'pma__table_info' => 'pma__table_info'],
            'server' => ['pmadb' => 'm1meta_rp', 'bookmarktable' => 'my_bookmarks'],
            'steps' => ['init', 'params', 'flags'],
        ],
        [
            'name' => 'features disabled with false',
            'create' => $all,
            'server' => ['pmadb' => 'm1meta_rp', 'tracking' => false, 'users' => false, 'pdf_pages' => false],
            'steps' => ['init', 'params', 'flags'],
        ],
        [
            'name' => 'all features disabled',
            'create' => $all,
            'server' => ['pmadb' => 'm1meta_rp'] + array_fill_keys(array_keys($defaultNames), false),
            'steps' => ['init', 'params', 'flags'],
        ],
        [
            'name' => 'column_info needs the 4.3 upgrade',
            'create' => $all,
            'oldColumnInfo' => true,
            'server' => ['pmadb' => 'm1meta_rp'],
            'steps' => ['init', 'params'],
        ],
        [
            'name' => 'control user cannot read one table',
            'create' => $all,
            'denyTable' => 'pma__tracking',
            'server' => ['pmadb' => 'm1meta_rp'],
            'steps' => ['init', 'params'],
        ],
        [
            'name' => 'tables in the current database are picked up (ZeroConf)',
            'create' => array_intersect_key($all, array_flip(['pma__bookmark', 'pma__userconfig'])),
            'server' => [],
            'currentDb' => 'm1meta_rp',
            'steps' => ['init', 'params', 'flags'],
        ],
        [
            'name' => 'fix_pmadb creates the missing tables (explicit names)',
            'create' => array_intersect_key($all, array_flip(['pma__bookmark', 'pma__relation'])),
            'server' => ['pmadb' => 'm1meta_rp', 'history' => 'my_history'] + array_diff_key($named, ['history' => 1]),
            'steps' => ['init', 'params', 'flags', 'fix_pmadb', 'params'],
        ],
        [
            'name' => 'fix_pmadb with disabled tables skips them',
            'create' => array_intersect_key($all, array_flip(['pma__bookmark'])),
            'server' => ['pmadb' => 'm1meta_rp', 'tracking' => false, 'central_columns' => false] + array_diff_key($named, ['tracking' => 1, 'central_columns' => 1]),
            'steps' => ['init', 'fix_pmadb', 'params'],
        ],
        [
            'name' => 'fixall_pmadb creates the storage in the current database',
            'create' => [],
            'server' => [],
            'currentDb' => 'm1meta_rp',
            'steps' => ['init', 'params', 'fixall_pmadb', 'params', 'flags'],
        ],
        [
            'name' => 'create_pmadb creates the database and the tables',
            'server' => ['pmadb' => 'm1meta_rp_new'],
            'grantCreateNew' => true,
            'steps' => ['init', 'params', 'flags', 'create_pmadb', 'params'],
        ],
        [
            'name' => 'create_pmadb without privileges',
            'server' => ['pmadb' => 'm1meta_rp_new'],
            'steps' => ['init', 'create_pmadb', 'params'],
        ],
    ];

    $scenarios = [];
    foreach ($scenarioDefs as $sc) {
        fwrite(STDERR, '  scenario: ' . $sc['name'] . "\n");
        $scenarios[] = $run($sc);
    }
}

bma_write_fixture($out . '/php.json', [
    'json_encode' => $jsonCases,
    'json_encode_gaps' => $gapCases,
    'bookmark_variables' => $bookmarkCases,
    'fix_up_mime' => $mimeCases,
]);
bma_write_fixture($out . '/create-tables.json', ['cases' => $createCases]);
bma_write_fixture($out . '/userprefs.json', ['fields' => $fields, 'apply' => $applyCases]);
if ($scenarios !== null) {
    bma_write_fixture($out . '/relation-storage.json', ['scenarios' => $scenarios]);
}

// shipped data, not a test fixture: the hard-coded relations of information_schema / mysql
$resources = __DIR__ . '/../resources';
file_put_contents(
    $resources . '/internal-relations.json',
    json_encode(
        ['information_schema' => InternalRelations::INFORMATION_SCHEMA, 'mysql' => InternalRelations::MYSQL],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES,
    ) . "\n",
);
fwrite(STDERR, 'wrote ' . $resources . "/internal-relations.json\n");
// UserFormList::getFields() (with and without the Developer tab): the allow-list of UserPreferences::apply
file_put_contents(
    $resources . '/user-form-fields.json',
    json_encode($fields, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n",
);
fwrite(STDERR, 'wrote ' . $resources . "/user-form-fields.json\n");
