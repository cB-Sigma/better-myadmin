<?php

/**
 * Golden fixtures for the pmadb repositories, produced by running phpMyAdmin's classes against a
 * real MySQL server with a correctly initialised configuration storage:
 *
 *   php packages/metadata/scripts/generate-repository-fixtures.php
 *
 * A scratch pmadb `m1meta_rp` (all 19 tables) and data database `m1meta_rpd` are created for a
 * scratch user `m1meta_rpu` (also the control user). Every operation records the statements sent on
 * the control and user links, the rows each read returned (re-run on a separate connection, the
 * scratch databases being private), the return value and phpMyAdmin's message, then the affected
 * pmadb table. Timestamps are masked as <TS>. Everything is dropped again.
 */

declare(strict_types=1);

require __DIR__ . '/../../mysql-types/scripts/pma-bootstrap.php';
require __DIR__ . '/recording.php';

use PhpMyAdmin\Bookmarks\BookmarkRepository;
use PhpMyAdmin\Config\UserPreferences;
use PhpMyAdmin\ConfigStorage\Relation;
use PhpMyAdmin\Console\History;
use PhpMyAdmin\Current;
use PhpMyAdmin\Favorites\RecentFavoriteTable;
use PhpMyAdmin\Favorites\RecentFavoriteTables;
use PhpMyAdmin\Favorites\TableType;
use PhpMyAdmin\Identifiers\DatabaseName;
use PhpMyAdmin\Identifiers\TableName;
use PhpMyAdmin\Message;
use PhpMyAdmin\Navigation\Navigation;
use PhpMyAdmin\Navigation\Nodes\NodeDatabase;
use PhpMyAdmin\Table\UiProperty;
use PhpMyAdmin\Template;
use PhpMyAdmin\Transformations;

$admin = $GLOBALS['bma_mysqli'];
if (! $admin instanceof mysqli) {
    fwrite(STDERR, "repository fixtures need a MySQL server\n");
    exit(1);
}

$host = (string) (getenv('BMA_MYSQL_HOST') ?: '127.0.0.1');
$port = (string) (getenv('BMA_MYSQL_PORT') ?: '3306');
$q = static function (string $sql) use ($admin): void {
    if (! $admin->query($sql)) {
        throw new RuntimeException($admin->error . ' in ' . $sql);
    }
};

$reset = static function () use ($q): void {
    $q('DROP DATABASE IF EXISTS `m1meta_rp`');
    $q('DROP DATABASE IF EXISTS `m1meta_rpd`');
    $q("DROP USER IF EXISTS 'm1meta_rpu'@'%'");
};

$reset();
$q('CREATE DATABASE `m1meta_rp` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
$q('USE `m1meta_rp`');
$dbiForSql = bma_dbi();
foreach ((new Relation($dbiForSql))->getCreateTableSqlQueries([]) as $ddl) {
    $q($ddl);
}

$q('CREATE DATABASE `m1meta_rpd`');
$q('CREATE TABLE `m1meta_rpd`.`t` (id INT PRIMARY KEY, num INT, name VARCHAR(20), note TEXT)');
$q('CREATE TABLE `m1meta_rpd`.`t2` (id INT PRIMARY KEY, label CHAR(5))');
$q('CREATE TABLE `m1meta_rpd`.`nochar` (id INT PRIMARY KEY, n INT)');
$q('CREATE VIEW `m1meta_rpd`.`v` AS SELECT id, name FROM `m1meta_rpd`.`t`');
$q("CREATE USER 'm1meta_rpu'@'%' IDENTIFIED BY 'm1meta_rpu'");
$q("GRANT ALL ON `m1meta_rp`.* TO 'm1meta_rpu'@'%'");
$q("GRANT ALL ON `m1meta_rpd`.* TO 'm1meta_rpu'@'%'");
$q("INSERT INTO `m1meta_rp`.`pma__relation` VALUES ('m1meta_rpd', 't', 'num', 'm1meta_rpd', 't2', 'id'), ('m1meta_rpd', 't', 'name', 'other', 'x', 'y')");
$q("INSERT INTO `m1meta_rp`.`pma__table_info` VALUES ('m1meta_rpd', 't2', 'label')");
$q("INSERT INTO `m1meta_rp`.`pma__column_info` (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options) VALUES
    ('m1meta_rpd', 't', 'name', '', 'text/plain', 'output/text_plain_dateformat.php', '0,''%Y''', '', ''),
    ('m1meta_rpd', 't', 'note', '', '', '', '', 'Input/Text_Plain_FileUpload.php', ''),
    ('m1meta_rpd', 't', 'id', '', 'image_jpeg', 'image_jpeg_link', '', '', '')");

[$dbi, $ext, $config] = bma_meta_dbi([
    'host' => $host,
    'port' => $port,
    'user' => 'm1meta_rpu',
    'password' => 'm1meta_rpu',
    'controluser' => 'm1meta_rpu',
    'controlpass' => 'm1meta_rpu',
    'pmadb' => 'm1meta_rp',
    'MaxTableUiprefs' => 2,
]);
$ext->shadow = $admin;
$config->set('QueryHistoryDB', true);
$config->set('QueryHistoryMax', 2);
$config->set('NumRecentTables', 2);
$config->set('NumFavoriteTables', 2);
$config->set('AllowSharedBookmarks', true);
$config->set('UserprefsDisallow', []);
$_SESSION = [];

$relation = new Relation($dbi, $config);
$relation->initRelationParamsCache();
$rp = $relation->getRelationParameters();

$mask = static fn (string $s): string => (string) preg_replace("/'\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d'/", "'<TS>'", $s);

/** Masks timestamps in the recorded statements and the rows their reads returned. */
$withResults = static function (array $log) use ($mask): array {
    $m = static fn ($v) => $v === null ? null : substr($mask("'" . $v . "'"), 1, -1);
    foreach ($log as $i => $e) {
        $log[$i]['sql'] = $mask($e['sql']);
        if (isset($e['rows'])) {
            $log[$i]['rows'] = array_map(static fn ($row) => array_map($m, $row), $e['rows']);
        }
    }

    return $log;
};

$dump = static function (string $table, string $cols, string $order) use ($admin, $mask): array {
    $res = $admin->query('SELECT ' . $cols . ' FROM `m1meta_rp`.`' . $table . '` ORDER BY ' . $order);
    $rows = [];
    while ($row = $res->fetch_assoc()) {
        $rows[] = array_map(static fn ($v) => $v === null ? null : substr($mask("'" . $v . "'"), 1, -1), $row);
    }

    return $rows;
};

$ops = [];
$record = static function (string $group, string $op, array $args, callable $fn, string|null $table = null, string $cols = '*', string $order = '1')
    use (&$ops, $ext, $withResults, $dump): void {
    $ext->take();
    $ext->recording = true;
    Current::$message = null;
    $result = $fn();
    $ext->recording = false;
    if ($result instanceof Message) {
        $result = ['message' => $result->getMessage()];
    }

    $ops[] = [
        'group' => $group,
        'op' => $op,
        'args' => $args,
        'statements' => $withResults($ext->take()),
        'result' => $result,
        'rows' => $table === null ? null : $dump($table, $cols, $order),
    ];
};

$user = 'm1meta_rpu';
$db = 'm1meta_rpd';

// --- bookmarks -----------------------------------------------------------------------------
$bookmarks = new BookmarkRepository($dbi, $relation, $config);
$bcols = 'id, dbase, user, label, query';
foreach (
    [
        ['SELECT 1', 'b1', $user, $db, false],
        ['SELECT [VARIABLE1]', 'b2', $user, $db, true],
        ["SELECT 'it''s'", 'B3 é', $user, '', false],
    ] as $args
) {
    $record('bookmarks', 'create', $args, static function () use ($bookmarks, $args) {
        $b = $bookmarks->createBookmark(...$args);

        return $b === false ? false : $b->save();
    }, 'pma__bookmark', $bcols, 'id');
}

$view = static fn ($b) => $b === null ? null : [
    'id' => $b->getId(), 'dbase' => $b->getDatabase(), 'user' => $b->getUser(), 'label' => $b->getLabel(), 'query' => $b->getQuery(),
];
$record('bookmarks', 'getList', [$user, $db], static fn () => array_map($view, $bookmarks->getList($user, $db)));
$record('bookmarks', 'getList', [$user, false], static fn () => array_map($view, $bookmarks->getList($user)));
$record('bookmarks', 'get', [$user, 1], static fn () => $view($bookmarks->get($user, 1)));
$record('bookmarks', 'get', [null, 2], static fn () => $view($bookmarks->get(null, 2)));
$record('bookmarks', 'get', ['someone', 1], static fn () => $view($bookmarks->get('someone', 1)));
$record('bookmarks', 'getByLabel', [$user, $db, 'b1'], static fn () => $view($bookmarks->getByLabel($user, DatabaseName::from($db), 'b1')));
$record('bookmarks', 'delete', [1], static fn () => $bookmarks->get($user, 1)?->delete(), 'pma__bookmark', $bcols, 'id');

// --- history -------------------------------------------------------------------------------
$history = new History($dbi, $relation, $config);
foreach ([[$db, 't', 'SELECT * FROM t;'], [$db, '', 'SELECT 2;'], ['', '', 'SELECT 3;']] as $args) {
    $record('history', 'setHistory', $args, static function () use ($history, $args, $user) {
        $history->setHistory($args[0], $args[1], $user, $args[2]);

        return $_SESSION['sql_history'];
    }, 'pma__history', 'username, db, `table`, sqlquery', 'id');
    sleep(1);
}

$record('history', 'getHistory', [$user], static fn () => array_map(
    static fn ($r) => ['db' => $r['db'], 'table' => $r['table'], 'sqlquery' => $r['sqlquery']],
    $history->getHistory($user),
));

// --- recent / favorite ---------------------------------------------------------------------
$rft = static fn (string $t) => new RecentFavoriteTable(DatabaseName::from($db), TableName::from($t));
$tablesOf = static fn (RecentFavoriteTables $x) => array_map(static fn ($t) => $t->toArray(), array_values($x->getTables()));
foreach (['t', 't2', 't', 'v', 'missing'] as $t) {
    $record('recent', 'add', [$db, $t], static function () use ($rft, $t, $tablesOf) {
        $r = RecentFavoriteTables::getInstance(TableType::Recent);
        $res = $r->add($rft($t));

        return ['returned' => $res === true ? true : $res->getMessage(), 'tables' => $tablesOf($r)];
    }, 'pma__recent', 'username, tables', 'username');
}

foreach ([['add', 't'], ['add', 't2'], ['remove', 't'], ['add', 'v'], ['remove', 'v'], ['remove', 'nope']] as [$action, $t]) {
    $record('favorite', $action, [$db, $t], static function () use ($rft, $t, $action, $tablesOf) {
        $f = RecentFavoriteTables::getInstance(TableType::Favorite);
        $res = $action === 'add' ? $f->add($rft($t)) : $f->remove($rft($t));

        return ['returned' => $res === true ? true : $res->getMessage(), 'tables' => $tablesOf($f)];
    }, 'pma__favorite', 'username, tables', 'username');
}

// --- table UI preferences ------------------------------------------------------------------
$res = $admin->query("SELECT CREATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'm1meta_rpd' AND TABLE_NAME = 't'");
$createTime = (string) $res->fetch_row()[0];
$ucols = 'username, db_name, table_name, prefs';
$uiOps = [
    ['t', 'set', 'col_order', [1, 0, 2, 3], $createTime],
    ['t', 'set', 'col_visib', [1, 1, 0, 1], $createTime],
    ['t', 'set', 'sorted_col', '`name` DESC', null],
    ['t', 'get', 'sorted_col', null, null],
    ['t', 'get', 'col_order', null, null],
    ['t', 'remove', 'col_order', null, null],
    ['t', 'set', 'col_order', [0, 1, 2, 3], 'wrong'],
    ['t2', 'set', 'sorted_col', '`label` ASC', null],
    ['v', 'set', 'col_order', [1, 0], null],
    ['t', 'set', 'sorted_col', '`gone` ASC', null],
    ['t', 'get', 'sorted_col', null, null],
];
foreach ($uiOps as [$t, $action, $prop, $value, $ct]) {
    $record('uiprefs', $action, [$db, $t, $prop, $value, $ct], static function () use ($dbi, $db, $t, $action, $prop, $value, $ct) {
        $table = $dbi->getTable($db, $t);
        $p = UiProperty::from($prop);
        $r = match ($action) {
            'set' => $table->setUiProp($p, $value, $ct),
            'get' => $table->getUiProp($p),
            'remove' => $table->removeUiProp($p),
        };

        return $r instanceof Message ? ['message' => $r->getMessage()] : $r;
    }, 'pma__table_uiprefs', $ucols, 'table_name');
    usleep(1100000);
}

$record('uiprefs', 'session', [], static fn () => $_SESSION['tmpval']['table_uiprefs'][1] ?? null);

// --- user preferences ----------------------------------------------------------------------
$clock = new class implements Psr\Clock\ClockInterface {
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('@1700000000');
    }
};
$prefs = new UserPreferences($dbi, $relation, new Template($config), $config, $clock);
$pcols = 'username, config_data';
$record('userprefs', 'load', [], static fn () => array_diff_key($prefs->load(), ['mtime' => 1]));
foreach (
    [
        ['save', [['MaxRows' => 50, 'Console/Mode' => 'collapse']]],
        ['save', [['2fa' => ['backend' => 'application', 'settings' => ['secret' => 'S']], 'lang' => 'cs']]],
        ['save', [['MaxRows' => 25]]],
        ['persistOption', ['Console/Mode', 'collapse', 'info']],
        ['persistOption', ['MaxRows', 25, 25]],
        ['persistOption', ['NavigationWidth', 240, 240]],
        ['save', [[]]],
    ] as [$fn, $args]
) {
    $record('userprefs', $fn, $args, static function () use ($prefs, $fn, $args) {
        $r = $prefs->$fn(...$args);

        return $r === true ? true : $r->getMessage();
    }, 'pma__userconfig', $pcols, 'username');
}

$record('userprefs', 'load', [], static fn () => array_diff_key($prefs->load(), ['mtime' => 1]));

// --- navigation hiding ---------------------------------------------------------------------
$nav = new Navigation(new Template($config), $relation, $dbi, $config);
$hidden = (new ReflectionMethod(Navigation::class, 'getHiddenItems'));
$ncols = 'username, item_name, item_type, db_name, table_name';
$record('navigation', 'hide', ['t', 'table', $db], static fn () => $nav->hideNavigationItem('t', 'table', $db), 'pma__navigationhiding', $ncols, 'item_name');
$record('navigation', 'hide', ['v', 'view', $db], static fn () => $nav->hideNavigationItem('v', 'view', $db), 'pma__navigationhiding', $ncols, 'item_name');
$record('navigation', 'hide', ['t', 'table', $db], static fn () => $nav->hideNavigationItem('t', 'table', $db), 'pma__navigationhiding', $ncols, 'item_name');
$record('navigation', 'hiddenItems', [$db], static fn () => $hidden->invoke($nav, $db));
$record('navigation', 'hiddenOfType', ['table', $db], static fn () => (new NodeDatabase($dbi, $config, $db))->getHiddenItems($rp, 'table'));
$record('navigation', 'hiddenCounts', [], static fn () => (new NodeDatabase($dbi, $config, $db))->getNavigationHidingData($rp->navigationItemsHidingFeature));
$record('navigation', 'unhide', ['t', 'table', $db], static fn () => $nav->unhideNavigationItem('t', 'table', $db), 'pma__navigationhiding', $ncols, 'item_name');

// --- relation readers ----------------------------------------------------------------------
$transformations = new Transformations($dbi, $relation);
$record('relation', 'getForeignersInternal', [$db, 't', ''], static fn () => $relation->getForeignersInternal($db, 't'));
$record('relation', 'getForeignersInternal', [$db, 't', 'num'], static fn () => $relation->getForeignersInternal($db, 't', 'num'));
$record('relation', 'getForeignersInternal', ['information_schema', 'TABLES', ''], static fn () => $relation->getForeignersInternal('information_schema', 'TABLES'));
$record('relation', 'getForeignersInternal', ['mysql', 'db', 'User'], static fn () => $relation->getForeignersInternal('mysql', 'db', 'User'));
$record('relation', 'getDisplayField', [$db, 't2'], static fn () => $relation->getDisplayField($db, 't2'));
$record('relation', 'getDisplayField', [$db, 't'], static fn () => $relation->getDisplayField($db, 't'));
$record('relation', 'getDisplayField', [$db, 'nochar'], static fn () => $relation->getDisplayField($db, 'nochar'));
$record('relation', 'getDisplayField', ['information_schema', 'TABLES'], static fn () => $relation->getDisplayField('information_schema', 'TABLES'));
$record('relation', 'getDbComment', [$db], static fn () => $relation->getDbComment($db));
$record('relation', 'setDbComment', [$db, "it's a db"], static fn () => $relation->setDbComment($db, "it's a db"), 'pma__column_info', 'db_name, table_name, column_name, comment', 'id');
$record('relation', 'getDbComment', [$db], static fn () => $relation->getDbComment($db));
$record('relation', 'setDbComment', [$db, ''], static fn () => $relation->setDbComment($db, ''), 'pma__column_info', 'db_name, table_name, column_name, comment', 'id');
$record('relation', 'getMime', [$db, 't', false, false], static fn () => $transformations->getMime($db, 't'));
$record('relation', 'getMime', [$db, 't', true, false], static fn () => $transformations->getMime($db, 't', true));
$record('relation', 'getMime', [$db, 't', false, true], static fn () => $transformations->getMime($db, 't', false, true));

// --- foreign keys (Relation::getForeigners / searchColumnInForeigners) ----------------------
$q('CREATE TABLE `m1meta_rpd`.`parent` (id INT, code CHAR(3), PRIMARY KEY (id), UNIQUE KEY (id, code)) ENGINE=InnoDB');
$q('CREATE TABLE `m1meta_rpd`.`child` (id INT PRIMARY KEY, pid INT NULL, pcode CHAR(3) NULL, other INT, plain INT,'
    . ' CONSTRAINT `fk_pc` FOREIGN KEY (pid, pcode) REFERENCES parent (id, code) ON DELETE CASCADE ON UPDATE SET NULL,'
    . ' CONSTRAINT `fk other` FOREIGN KEY (other) REFERENCES `m1meta_rpd`.`t2` (id) ON DELETE NO ACTION,'
    . ' FOREIGN KEY (plain) REFERENCES t2 (id)) ENGINE=InnoDB');
$q("INSERT INTO `m1meta_rp`.`pma__relation` VALUES ('m1meta_rpd', 'child', 'other', 'm1meta_rpd', 't', 'id')");
$fkView = static fn (array $keys) => array_map(static fn ($k) => [
    'constraint' => $k->constraint, 'indexList' => $k->indexList, 'refDbName' => $k->refDbName,
    'refTableName' => $k->refTableName, 'refIndexList' => $k->refIndexList, 'onUpdate' => $k->onUpdate,
    'onDelete' => $k->onDelete,
], $keys);
$showCreate = (string) $admin->query('SHOW CREATE TABLE `m1meta_rpd`.`child`')->fetch_row()[1];
Current::$database = $db;
$record('foreign', 'getForeigners', [$db, 'child', '', $showCreate], static function () use ($relation, $db, $fkView) {
    $f = $relation->getForeigners($db, 'child');
    $out = ['data' => $f->data, 'keysData' => $fkView($f->keysData), 'search' => []];
    foreach (['id', 'pid', 'pcode', 'other', 'plain'] as $col) {
        $out['search'][$col] = $relation->searchColumnInForeigners($f, $col);
    }

    return $out;
});
Current::$database = '';

$reset();

bma_write_fixture(__DIR__ . '/../test/fixtures/repositories.json', [
    'relationParameters' => $rp->toArray(),
    'createTime' => $createTime,
    'ops' => $ops,
]);
