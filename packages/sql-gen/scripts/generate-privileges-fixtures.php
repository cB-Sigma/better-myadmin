<?php

/**
 * Golden fixtures for the Server → User accounts statements of @bettermyadmin/sql-gen, produced
 * by EXECUTING phpMyAdmin's Privileges class over a server matrix (MySQL 5.5 … 8.4, MariaDB 5.1 …
 * 11.4, with and without a MariaDB password-check plugin) with a stub DatabaseInterface that
 * records every statement and answers the reads (PASSWORD(), @@old_passwords, plugin, …):
 *
 *   php packages/sql-gen/scripts/generate-privileges-fixtures.php
 *
 * Covered: getSqlQueriesForDisplayAndAddUser, generateQueriesForUpdatePrivileges, updatePassword,
 * getRequireClause, getWithClauseForAddUserAndUpdatePrivs, extractPrivInfo.
 */

declare(strict_types=1);

require dirname(__DIR__, 2) . '/mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Cache;
use PhpMyAdmin\Config;
use PhpMyAdmin\ConfigStorage\Relation;
use PhpMyAdmin\ConfigStorage\RelationCleanup;
use PhpMyAdmin\Current;
use PhpMyAdmin\Dbal\Connection;
use PhpMyAdmin\Dbal\DatabaseInterface;
use PhpMyAdmin\Server\Plugins;
use PhpMyAdmin\Server\Privileges;
use PhpMyAdmin\Template;
use PhpMyAdmin\Tests\Stubs\DbiDummy;
use PhpMyAdmin\Tests\Stubs\DummyResult;

/** A DbiDummy that records every statement and answers through a callback. */
final class BmaRecordingDbi extends DbiDummy
{
    /** @var list<string> */
    public array $log = [];

    /** @param callable(string): (list<list<string|null>>|bool) $answer */
    public function __construct(private $answer)
    {
        parent::__construct();
    }

    public function realQuery(string $query, Connection $connection, bool $unbuffered = false): DummyResult|false
    {
        $this->log[] = $query;
        $result = ($this->answer)($query);
        if ($result === false) {
            return false;
        }

        if ($result === true) {
            return new DummyResult(['query' => $query, 'result' => true]);
        }

        return new DummyResult(['query' => $query, 'result' => $result[0], 'columns' => $result[1]]);
    }

    public function quoteString(Connection $connection, string $string): string
    {
        return "'" . bma_escape($string) . "'";
    }
}

/**
 * @param 'mysql'|'mariadb' $vendor
 * @param callable(string): (array{list<list<string|null>>, list<string>}|bool) $answer
 */
function bma_privileges(string $vendor, int $version, callable $answer, BmaRecordingDbi|null &$ext = null): Privileges
{
    Config::$instance = null;
    $config = Config::getInstance();
    $config->selectedServer['DisableIS'] = false;
    Current::$database = '';
    Current::$table = '';
    Current::$lang = 'en';
    $ext = new BmaRecordingDbi($answer);
    $dbi = DatabaseInterface::getInstanceForTest($ext, $config);
    $dbi->setVersion([
        '@@version' => bma_version_string($vendor, $version),
        '@@version_comment' => 'Source distribution',
    ]);
    DatabaseInterface::$instance = $dbi;
    // the privilege probes: a superuser with GRANT and CREATE USER
    Cache::set('is_superuser', true);
    \PhpMyAdmin\Utils\SessionCache::set('is_superuser', true);
    \PhpMyAdmin\Utils\SessionCache::set('is_grantuser', true);
    \PhpMyAdmin\Utils\SessionCache::set('is_createuser', true);
    $relation = new Relation($dbi);

    return new Privileges(
        new Template($config),
        $dbi,
        $relation,
        new RelationCleanup($dbi, $relation),
        new Plugins($dbi),
        $config,
    );
}

/** @return callable(string): (list<list<string|null>>|bool) */
function bma_answers(bool $pwdCheckActive = false, string $plugin = 'caching_sha2_password'): callable
{
    return static function (string $q) use ($pwdCheckActive, $plugin) {
        if (str_starts_with($q, 'SELECT PASSWORD(')) {
            return [[['*HASHED-' . strlen($q)]], ['PASSWORD']];
        }

        if (str_starts_with($q, 'SHOW PLUGINS SONAME')) {
            $cols = ['Name', 'Status', 'Type', 'Library', 'License'];

            return $pwdCheckActive ? [[['simple_password_check', 'ACTIVE', 'PASSWORD VALIDATION', 'simple_password_check.so', 'GPL']], $cols] : [[], $cols];
        }

        if ($q === 'SELECT @@old_passwords;') {
            return [[['0']], ['@@old_passwords']];
        }

        if (str_starts_with($q, 'SELECT `plugin` FROM')) {
            return [[[$plugin]], ['plugin']];
        }

        return true;
    };
}

$servers = [
    ['mysql', 50506],
    ['mysql', 50507],
    ['mysql', 50705],
    ['mysql', 50706],
    ['mysql', 80010],
    ['mysql', 80011],
    ['mysql', 80400],
    ['mariadb', 50100],
    ['mariadb', 50200],
    ['mariadb', 100001],
    ['mariadb', 100002],
    ['mariadb', 100406],
    ['mariadb', 110400],
];

$addUserPosts = [
    'password + plugin' => ['pred_password' => 'userdefined', 'pma_pw' => "Se'cret", 'pma_pw2' => "Se'cret", 'authentication_plugin' => 'mysql_native_password', 'Select_priv' => 'Y'],
    'password, no plugin' => ['pred_password' => 'userdefined', 'pma_pw' => 'pw', 'pma_pw2' => 'pw', 'Insert_priv' => 'Y', 'Grant_priv' => 'Y'],
    'no password' => ['pred_password' => 'none', 'authentication_plugin' => 'sha256_password', 'max_questions' => '3', 'ssl_type' => 'X509'],
    'keep (copy user)' => ['pred_password' => 'keep', 'authentication_plugin' => 'caching_sha2_password', 'ssl_type' => 'SPECIFIED', 'ssl_cipher' => 'C', 'x509_issuer' => '', 'x509_subject' => 'S'],
    'all privileges + limits' => ['pred_password' => 'userdefined', 'pma_pw' => 'x', 'pma_pw2' => 'x', 'Select_priv' => 'Y', 'Insert_priv' => 'Y', 'grant_count' => '2', 'max_questions' => '-1', 'max_updates' => '9', 'max_connections' => '0', 'max_user_connections' => 'abc'],
];

$addUser = [];
foreach ($servers as [$vendor, $version]) {
    foreach ([false, true] as $pwdCheck) {
        if ($pwdCheck && ! ($vendor === 'mariadb' && $version >= 100002)) {
            continue;
        }

        foreach ($addUserPosts as $name => $post) {
            $_POST = $post;
            $p = bma_privileges($vendor, $version, bma_answers($pwdCheck), $ext);
            $q = $p->getSqlQueriesForDisplayAndAddUser('f06u_n', 'h%', 'stored*hash');
            $addUser[] = [
                'vendor' => $vendor,
                'version' => $version,
                'pwdCheck' => $pwdCheck,
                'case' => $name,
                'post' => $post,
                'queries' => $q,
                'ran' => $ext->log,
            ];
        }
    }
}

$updatePosts = [
    'privileges' => ['Select_priv' => 'Y', 'Delete_priv' => 'Y'],
    'grant + limits + ssl' => ['Select_priv' => 'Y', 'Grant_priv' => 'Y', 'max_questions' => '1', 'max_updates' => '2', 'max_connections' => '3', 'max_user_connections' => '4', 'ssl_type' => 'ANY'],
    'usage' => [],
    'columns' => ['Select_priv' => ['a', 'b`c'], 'Insert_priv' => ['a', 'b`c'], 'Update_priv' => ['a'], 'Update_priv_none' => 'on', 'column_count' => '2'],
];
$targets = [['', '*.*', ''], ['', '`d\_b`.*', 'd\_b'], ['FUNCTION', '`db`.`f`', 'db']];
$update = [];
$generate = new ReflectionMethod(Privileges::class, 'generateQueriesForUpdatePrivileges');
foreach ($servers as [$vendor, $version]) {
    foreach ($updatePosts as $name => $post) {
        foreach ($targets as [$itemType, $dbAndTable, $dbname]) {
            $_POST = $post;
            $_REQUEST = $post;
            $p = bma_privileges($vendor, $version, bma_answers());
            $update[] = [
                'vendor' => $vendor,
                'version' => $version,
                'case' => $name,
                'post' => $post,
                'itemType' => $itemType,
                'dbAndTable' => $dbAndTable,
                'dbname' => $dbname,
                'queries' => $generate->invoke($p, $itemType, $dbAndTable, 'u', 'h', $dbname),
                'require' => $p->getRequireClause(),
                'with' => $p->getWithClauseForAddUserAndUpdatePrivs(),
                'privs' => $p->extractPrivInfo(),
            ];
        }
    }
}

$passwordPosts = [
    'new password + plugin' => ['pma_pw' => "n'ew", 'pma_pw2' => "n'ew", 'authentication_plugin' => 'sha256_password'],
    'old password plugin' => ['pma_pw' => 'p', 'pma_pw2' => 'p', 'authentication_plugin' => 'mysql_old_password'],
    'stored plugin' => ['pma_pw' => 'été', 'pma_pw2' => 'été'],
    'no password' => ['nopass' => '1', 'pma_pw' => '', 'pma_pw2' => ''],
    'mismatch' => ['pma_pw' => 'a', 'pma_pw2' => 'b'],
];
$password = [];
foreach ($servers as [$vendor, $version]) {
    foreach ($passwordPosts as $name => $post) {
        $_POST = $post;
        $p = bma_privileges($vendor, $version, bma_answers(false, 'mysql_native_password'), $ext);
        $message = $p->updatePassword('u', 'h');
        $password[] = [
            'vendor' => $vendor,
            'version' => $version,
            'case' => $name,
            'post' => $post,
            'ran' => $ext->log,
            'message' => $message->getMessage(),
            'success' => $message->isSuccess(),
        ];
    }
}

$rows = [
    'all db privileges' => array_fill_keys(['Select_priv', 'Insert_priv', 'Update_priv', 'Delete_priv', 'Create_priv', 'Drop_priv', 'Grant_priv', 'References_priv', 'Index_priv', 'Alter_priv', 'Create_tmp_table_priv', 'Lock_tables_priv', 'Create_view_priv', 'Show_view_priv', 'Create_routine_priv', 'Alter_routine_priv', 'Execute_priv', 'Event_priv', 'Trigger_priv'], 'Y'),
    'some' => ['Select_priv' => 'Y', 'Insert_priv' => 'N', 'Execute_priv' => 'Y', 'Grant_priv' => 'Y'],
    'none' => ['Select_priv' => 'N'],
    'routine' => ['Alter_routine_priv' => 'Y', 'Execute_priv' => 'Y', 'Grant_priv' => 'N'],
];
$extract = [];
$_POST = [];
$p = bma_privileges('mysql', 80400, bma_answers());
foreach ($rows as $name => $row) {
    $extract[] = ['case' => $name, 'row' => $row, 'privs' => $p->extractPrivInfo($row), 'html' => $p->extractPrivInfo($row, true)];
}

bma_write_fixture(dirname(__DIR__) . '/test/fixtures/privileges.json', [
    'addUser' => $addUser,
    'update' => $update,
    'password' => $password,
    'extract' => $extract,
]);
