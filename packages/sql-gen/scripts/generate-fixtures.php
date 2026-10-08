<?php

/**
 * Golden fixtures for @bettermyadmin/sql-gen, produced by EXECUTING phpMyAdmin
 * (Util::backquote, DatabaseInterface::quoteString via real mysqli,
 * UniqueCondition, Table::generateFieldSpec/generateAlter, CreateAddField,
 * InsertEdit::getQueryValueForInsert/ForUpdate).
 *
 *   php packages/sql-gen/scripts/generate-fixtures.php
 *
 * A reachable MySQL server (see mysql-types/scripts/pma-bootstrap.php) makes the
 * escaping fixtures authoritative (mysqlnd real_escape_string per charset).
 */

declare(strict_types=1);

require dirname(__DIR__, 2) . '/mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Config;
use PhpMyAdmin\ConfigStorage\Relation;
use PhpMyAdmin\CreateAddField;
use PhpMyAdmin\Current;
use PhpMyAdmin\EditField;
use PhpMyAdmin\FieldMetadata;
use PhpMyAdmin\FileListing;
use PhpMyAdmin\InsertEdit;
use PhpMyAdmin\ResponseRenderer;
use PhpMyAdmin\SqlParser\Components\CaseExpression;
use PhpMyAdmin\SqlParser\Components\Expression;
use PhpMyAdmin\Table\Table;
use PhpMyAdmin\Template;
use PhpMyAdmin\Transformations;
use PhpMyAdmin\UniqueCondition;
use PhpMyAdmin\Util;

$out = dirname(__DIR__) . '/test/fixtures';

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------
$identifiers = ['', '*', 'a', 'my table', 'owner`s db', '``', 'a.b', 'é', '"quoted"', '0', ' lead', 'x`y`z', "new\nline"];
$backquote = [];
foreach ($identifiers as $id) {
    $backquote[] = [$id, Util::backquote($id), Util::backquoteCompat($id, 'MSSQL'), Util::backquoteCompat($id, 'NONE')];
}

$strings = [
    '', 'abc', "it's", 'say "hi"', 'back\\slash', "nul\0byte", "line\nfeed", "carriage\rreturn", "ctrl\x1aZ",
    "all '\"\\\0\n\r\x1a", 'é ü 漢字 😀', '%_wild_%', "\x7f\x80\xff", "\xc3'", "\xbf\x5c'", "\x81\x5c'", "\xa1\x5c'",
    "\x8e\xa1'", "\x8f\xa1\xa1'", "\xe2\x82'", "\xf0\x9f'", "\x81\x30\x81\x30'", "\xed\xa0\x80'", "''", '\\\'',
];
$charsets = ['utf8mb4', 'utf8mb3', 'utf8', 'latin1', 'binary', 'ascii', 'gbk', 'big5', 'sjis', 'cp932', 'gb18030', 'gb2312', 'euckr', 'ujis', 'eucjpms', 'cp1250', 'koi8r'];
$escape = [];
$m = $GLOBALS['bma_mysqli'];
foreach ($charsets as $cs) {
    if ($m instanceof mysqli) {
        try {
            if (! @$m->set_charset($cs)) {
                continue;
            }
        } catch (Throwable) {
            continue;
        }
    } elseif (! in_array($cs, ['utf8mb4', 'latin1', 'binary'], true)) {
        continue;
    }

    foreach ($strings as $s) {
        $escaped = $m instanceof mysqli ? $m->real_escape_string($s) : bma_php_escape($s);
        $escape[] = ['charset' => $cs, 'input' => bma_bytes($s), 'escaped' => bma_bytes($escaped)];
    }
}

$escapeNoBackslash = [];
if ($m instanceof mysqli) {
    $m->query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'");
    foreach (['utf8mb4', 'latin1', 'gbk', 'sjis', 'big5'] as $cs) {
        $m->set_charset($cs);
        $m->query('SELECT 1')->free();
        foreach ($strings as $s) {
            $escapeNoBackslash[] = ['charset' => $cs, 'input' => bma_bytes($s), 'escaped' => bma_bytes($m->real_escape_string($s))];
        }
    }

    $m->query("SET SESSION sql_mode = DEFAULT");
    $m->set_charset('utf8mb4');
}

bma_write_fixture($out . '/quote.json', ['backquote' => $backquote, 'escape' => $escape, 'escapeNoBackslashEscapes' => $escapeNoBackslash]);

// ---------------------------------------------------------------------------
// Unique conditions
// ---------------------------------------------------------------------------
/**
 * @param array{0:string,1:string,2:string,3:string,4:int,5?:int,6?:int,7?:int} $f
 */
function bma_field(array $f): FieldMetadata
{
    return new FieldMetadata((object) [
        'name' => $f[0],
        'orgname' => $f[1],
        'table' => $f[2],
        'orgtable' => $f[3],
        'max_length' => 0,
        'length' => $f[7] ?? 0,
        'charsetnr' => $f[6] ?? 33,
        'flags' => $f[5] ?? 0,
        'type' => $f[4],
        'decimals' => 0,
        'db' => 'db',
        'def' => '',
        'catalog' => 'def',
    ]);
}

$uniqueCases = [];
/**
 * @param list<array> $fields field specs [name, orgname, table, orgtable, type, flags, charsetnr, length]
 * @param list<string|null> $row
 * @param list<string> $views table aliases that are views
 * @param list<array{0:string|null,1:string|null,2?:bool}> $expressions [alias, column, isCase]
 */
$addUnique = static function (
    string $label,
    array $fields,
    array $row,
    bool $forceUnique = false,
    string $restrictToTable = '',
    array $expressions = [],
    array $views = [],
) use (&$uniqueCases): void {
    bma_dbi('mysql', 80400, $ext);
    $metas = array_map('bma_field', $fields);
    foreach ($metas as $meta) {
        if ($meta->table === $meta->orgtable || $meta->table === '') {
            continue;
        }

        $q = 'SELECT 1 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = \'db\' AND TABLE_NAME = '
            . "'" . bma_escape($meta->table) . "'";
        $ext->addResult($q, in_array($meta->table, $views, true) ? [['1']] : []);
    }

    $exprObjects = [];
    foreach ($expressions as $e) {
        $o = ($e[2] ?? false) ? new CaseExpression() : new Expression();
        $o->alias = $e[0];
        if (! ($o instanceof CaseExpression)) {
            $o->column = $e[1];
        }

        $exprObjects[] = $o;
    }

    $uc = new UniqueCondition($metas, $row, $forceUnique, $restrictToTable, $exprObjects);
    $condArray = [];
    foreach ($uc->getConditionArray() as $k => $v) {
        $condArray[] = [bma_bytes((string) $k), bma_bytes($v)];
    }

    $uniqueCases[] = [
        'label' => $label,
        'fields' => $fields,
        'row' => array_map('bma_bytes', $row),
        'forceUnique' => $forceUnique,
        'restrictToTable' => $restrictToTable,
        'expressions' => $expressions,
        'views' => $views,
        'expected' => [
            'whereClause' => bma_bytes($uc->getWhereClause()),
            'isClauseUnique' => $uc->isClauseUnique(),
            'conditionArray' => $condArray,
        ],
    ];
};

const MT_DECIMAL = 0;
const MT_TINY = 1;
const MT_SHORT = 2;
const MT_LONG = 3;
const MT_FLOAT = 4;
const MT_DOUBLE = 5;
const MT_TIMESTAMP = 7;
const MT_LONGLONG = 8;
const MT_DATE = 10;
const MT_TIME = 11;
const MT_DATETIME = 12;
const MT_YEAR = 13;
const MT_BIT = 16;
const MT_JSON = 245;
const MT_NEWDECIMAL = 246;
const MT_ENUM = 247;
const MT_BLOB = 252;
const MT_VAR_STRING = 253;
const MT_STRING = 254;
const MT_GEOMETRY = 255;
const F_PRI = MYSQLI_PRI_KEY_FLAG | MYSQLI_NOT_NULL_FLAG;
const F_UNI = MYSQLI_UNIQUE_KEY_FLAG;
const F_NUM = MYSQLI_NUM_FLAG;

// --- the PHPUnit cases of tests/unit/UniqueConditionTest.php (values as mysqli strings)
$addUnique('phpunit: empty', [], []);
$addUnique('phpunit: empty forceUnique', [], [], true);
$addUnique('phpunit: multiple fields', [
    ['field1', '', 'table', 'table', MT_STRING, 0, -1],
    ['field2', '', 'table', 'table', MT_STRING, 0, -1],
    ['field3', '', 'table', 'table', MT_SHORT, F_NUM, -1],
    ['field4', '', 'table', 'table', MT_LONG, F_NUM, -1],
    ['field5', '', 'table', 'table', MT_STRING, 0, 63],
    ['field6', '', 'table', 'table', MT_STRING, 0, 63],
    ['field7', '', 'table', 'table', MT_STRING, 0, 32],
    ['field8', '', 'table', 'table', MT_STRING, 0, 48],
    ['field9', '', 'table', 'table', MT_STRING, 0, 63],
    ['field10', '', 'table', 'table', MT_GEOMETRY, 0, -1],
    ['field11', '', 'table2', 'table2', MT_STRING, 0, -1],
    ['field12', '', 'table', 'table', MT_BIT, 0, -1, 4],
], [null, 'value\'s', '123456', '123.456', 'value', str_repeat('*', 1001), 'value', 'value', 'value', 'value', 'value', '1'], false, 'table');
$addUnique('phpunit: single big binary field', [['field', '', 'table', 'table', MT_STRING, 0, 63]], [str_repeat('*', 1001)]);
$addUnique('phpunit: primary key', [['id', '', 'table', 'table', MT_LONG, MYSQLI_PRI_KEY_FLAG | F_NUM, -1], ['field', '', 'table', 'table', MT_STRING, 0, -1]], ['1', 'value']);
$addUnique('phpunit: unique key', [['id', '', 'table', 'table', MT_STRING, F_UNI, -1], ['field', '', 'table', 'table', MT_STRING, 0, -1]], ['unique', 'value']);
$addUnique('phpunit: group flag integer', [['col', '', 'table', 'table', MT_TINY, F_NUM, -1]], ['123']);
$addUnique('phpunit: group flag unknown type', [['col', '', 'table', 'table', -1, F_NUM, -1]], ['test']);
$addUnique('phpunit: group flag varchar', [['col', '', 'table', 'table', MT_VAR_STRING, F_NUM, -1]], ['test']);
$addUnique('phpunit: group flag double quote', [['col', '', 'table', 'table', MT_VAR_STRING, F_NUM, -1]], ['"test"']);
$addUnique('phpunit: group flag single quote', [['col', '', 'table', 'table', MT_VAR_STRING, F_NUM, -1]], ["'test'"]);
$addUnique('phpunit: group by mixed', [['col', '', 'table', 'table', MT_VAR_STRING, F_NUM, -1], ['status_id', '', 'table', 'table', MT_TINY, F_NUM, -1]], ['test', '2']);

// --- single-column matrix
$columnKinds = [
    'tinyint' => [MT_TINY, 33, 4],
    'int' => [MT_LONG, 63, 11],
    'bigint' => [MT_LONGLONG, 63, 20],
    'decimal' => [MT_NEWDECIMAL, 63, 12],
    'olddecimal' => [MT_DECIMAL, 63, 12],
    'float' => [MT_FLOAT, 63, 12],
    'double' => [MT_DOUBLE, 63, 22],
    'char' => [MT_STRING, 255, 40],
    'varchar' => [MT_VAR_STRING, 255, 400],
    'binary' => [MT_STRING, 63, 16],
    'varbinary' => [MT_VAR_STRING, 63, 255],
    'text' => [MT_BLOB, 255, 262140],
    'blob' => [MT_BLOB, 63, 65535],
    'geometry' => [MT_GEOMETRY, 63, 4294967295],
    'bit1' => [MT_BIT, 63, 1],
    'bit8' => [MT_BIT, 63, 8],
    'bit64' => [MT_BIT, 63, 64],
    'json' => [MT_JSON, 63, 4294967295],
    'date' => [MT_DATE, 63, 10],
    'datetime' => [MT_DATETIME, 63, 19],
    'timestamp' => [MT_TIMESTAMP, 63, 19],
    'time' => [MT_TIME, 63, 10],
    'year' => [MT_YEAR, 63, 4],
    'enum' => [MT_STRING, 255, 4],
];
$values = [
    null, '', '0', '00', '0.0', '-0', ' 0', '0 ', '0e3', '1', '42', '-1.5e3', '123.456', '18446744073709551615',
    'abc', "it's", 'a"b\\c', "nl\ncr\rz\x1anul\0", 'é漢😀', "\x00\x01\xff", "\xff", '%_', str_repeat('*', 999),
    str_repeat('*', 1000), str_repeat('é', 999), str_repeat('é', 1000), str_repeat('g', 4999), str_repeat('g', 5000),
    "\x00\x00\x00\x00\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\xf0\x3f\x00\x00\x00\x00\x00\x00\x00\x40",
    '2024-01-31 12:34:56', '5', '2561', '9223372036854775808', 'abc5', '{"a": 1}', "0x00",
];
foreach ($columnKinds as $kind => [$type, $cs, $len]) {
    foreach ([0 => 'none', F_PRI => 'pri', F_UNI => 'uni'] as $flags => $flagName) {
        foreach ($values as $vi => $v) {
            if ($flagName !== 'none' && $vi % 3 !== 0) {
                continue; // keep the matrix reasonable
            }

            if ($v !== null && strlen($v) > 100 && ! in_array($kind, ['binary', 'varbinary', 'blob', 'geometry', 'text'], true)) {
                continue;
            }

            $addUnique("single $kind $flagName #$vi", [['c', 'c', 't', 't', $type, $flags | ($type === MT_LONG ? F_NUM : 0), $cs, $len]], [$v]);
        }
    }
}

// --- multi-column and option cases
$pk = ['id', 'id', 't', 't', MT_LONG, F_PRI | F_NUM, 63, 11];
$uni = ['email', 'email', 't', 't', MT_VAR_STRING, F_UNI, 255, 400];
$txt = ['name', 'name', 't', 't', MT_VAR_STRING, 0, 255, 400];
$flt = ['price', 'price', 't', 't', MT_DOUBLE, 0, 63, 22];
$blob = ['data', 'data', 't', 't', MT_BLOB, 0, 63, 65535];
$geo = ['shape', 'shape', 't', 't', MT_GEOMETRY, 0, 63, 0];
$addUnique('pk + others', [$pk, $txt, $flt], ['7', "O'Brien", '1.1']);
$addUnique('pk null', [$pk, $txt], [null, 'x']);
$addUnique('two pk parts', [$pk, ['lang', 'lang', 't', 't', MT_STRING, F_PRI, 255, 8]], ['3', 'en']);
$addUnique('unique + other', [$uni, $txt], ['a@b.c', 'x']);
$addUnique('unique null falls back', [$uni, $txt], [null, 'x']);
$addUnique('pk + unique', [$uni, $pk], ['a@b.c', '9']);
$addUnique('no key all columns', [$txt, $flt, $blob], ['n', '0.30000000000000004', "\x01\x02"]);
$addUnique('no key forceUnique', [$txt, $flt], ['n', '1.5'], true);
$addUnique('pk forceUnique', [$pk, $txt], ['1', 'n'], true);
$addUnique('big blob among others is skipped', [$txt, $blob], ['n', str_repeat("\x01", 1500)]);
$addUnique('empty blob', [$txt, $blob], ['n', '']);
$addUnique('zero binary string', [['b', 'b', 't', 't', MT_STRING, 0, 63, 1]], ['0']);
$addUnique('big geometry among others', [$txt, $geo], ['n', str_repeat("\x02", 5000)]);
$addUnique('big geometry only', [$geo], [str_repeat("\x02", 6000)]);
$addUnique('geometry + pk', [$pk, $geo], ['4', "\x01\x02"]);
$addUnique('restrict to table', [$pk, ['oid', 'id', 'o', 'o', MT_LONG, F_PRI | F_NUM, 63, 11]], ['1', '2'], false, 'o');
$addUnique('restrict to missing table', [$pk, $txt], ['1', 'a'], false, 'zzz');
$addUnique('table alias not a view', [['id', 'id', 'x', 'galerie', MT_LONG, F_PRI | F_NUM, 63, 11]], ['5']);
$addUnique('table alias is a view', [['id', 'id', 'v', 'base', MT_LONG, F_PRI | F_NUM, 63, 11]], ['5'], false, '', [], ['v']);
$addUnique('alias restrict uses resolved table', [['id', 'id', 'x', 'galerie', MT_LONG, F_PRI | F_NUM, 63, 11], ['n', 'n', 'x', 'galerie', MT_STRING, 0, 255, 4]], ['5', 'a'], false, 'galerie');
$addUnique('column alias resolved by expression', [['alias_col', '', 't', 't', MT_VAR_STRING, 0, 255, 40]], ['v'], false, '', [['ALIAS_COL', 'real_col']]);
$addUnique('column alias without matching expression', [['alias_col', '', 't', 't', MT_VAR_STRING, 0, 255, 40]], ['v'], false, '', [['other', 'real_col'], [null, 'x'], ['alias_col', null], ['alias_col', '']]);
$addUnique('case expression alias ignored', [['alias_col', '', 't', 't', MT_VAR_STRING, 0, 255, 40]], ['v'], false, '', [['alias_col', null, true], ['alias_col', 'second']]);
$addUnique('expression column without table', [['COUNT(*)', '', '', '', MT_LONGLONG, F_NUM, 63, 21]], ['3']);
$addUnique('names with backticks', [['we`ird', 'we`ird', 'ta`ble', 'ta`ble', MT_LONG, F_PRI | F_NUM, 63, 11]], ['1']);
$addUnique('missing row values', [$pk, $txt], ['1']);
$addUnique('bit values', [['b', 'b', 't', 't', MT_BIT, 0, 63, 12], ['c', 'c', 't', 't', MT_BIT, 0, 63, 3]], ['2561', '7']);
$addUnique('decimal pk', [['d', 'd', 't', 't', MT_NEWDECIMAL, F_PRI, 63, 12]], ['10.50']);
$addUnique('unique float', [['f', 'f', 't', 't', MT_FLOAT, F_UNI, 63, 12]], ['0.1']);

bma_write_fixture($out . '/unique-condition.json', ['cases' => $uniqueCases]);

// ---------------------------------------------------------------------------
// Column definitions (Table::generateFieldSpec / generateAlter)
// ---------------------------------------------------------------------------
$specCases = [];
$addSpec = static function (array $server, array $args, string|null $oldcol = null) use (&$specCases): void {
    bma_dbi($server[0], $server[1]);
    $a = $args + [
        'name' => 'col', 'type' => 'INT', 'length' => '', 'attribute' => '', 'collation' => '', 'null' => false,
        'defaultType' => 'USER_DEFINED', 'defaultValue' => '', 'extra' => '', 'comment' => '', 'virtuality' => '',
        'expression' => '', 'moveTo' => '', 'columnsWithIndex' => null, 'oldColumnName' => null,
    ];
    $spec = Table::generateFieldSpec(
        $a['name'], $a['type'], $a['length'], $a['attribute'], $a['collation'], $a['null'], $a['defaultType'],
        $a['defaultValue'], $a['extra'], $a['comment'], $a['virtuality'], $a['expression'], $a['moveTo'],
        $a['columnsWithIndex'], $a['oldColumnName'],
    );
    // compact positional form: [vendor, version, args (generateFieldSpec order), spec, oldcol?, alter?]
    $ordered = [];
    foreach (['name', 'type', 'length', 'attribute', 'collation', 'null', 'defaultType', 'defaultValue', 'extra', 'comment', 'virtuality', 'expression', 'moveTo', 'columnsWithIndex', 'oldColumnName'] as $key) {
        $ordered[] = $a[$key];
    }

    $case = [$server[0], $server[1], $ordered, $spec];
    if ($oldcol !== null) {
        $alter = Table::generateAlter(
            $oldcol, $a['name'], $a['type'], $a['length'], $a['attribute'], $a['collation'], $a['null'],
            $a['defaultType'], $a['defaultValue'], $a['extra'], $a['comment'], $a['virtuality'], $a['expression'],
            $a['moveTo'], $a['columnsWithIndex'],
        );
        $case[] = $oldcol;
        $case[] = $alter;
    }

    $specCases[] = $case;
};

$mysql = ['mysql', 80400];
// TableTest::testGenerateFieldSpec inputs (mocked dbi there reports MySQL 5.5)
$t = ['name' => 'PMA_name', 'type' => 'BIT', 'length' => '12', 'attribute' => 'PMA_attribute', 'collation' => 'PMA_collation', 'null' => 'YES', 'defaultType' => 'USER_DEFINED', 'defaultValue' => '12', 'extra' => 'AUTO_INCREMENT', 'comment' => 'PMA_comment', 'moveTo' => '-first'];
$phpunitServer = ['mysql', 55000];
$addSpec($phpunitServer, $t);
$addSpec($phpunitServer, ['type' => 'DOUBLE'] + $t);
$addSpec($phpunitServer, ['type' => 'BOOLEAN'] + $t);
$addSpec($phpunitServer, ['type' => 'BOOLEAN', 'defaultType' => 'NULL'] + $t);
$addSpec($phpunitServer, ['type' => 'BOOLEAN', 'defaultType' => 'CURRENT_TIMESTAMP'] + $t);
$addSpec($phpunitServer, ['type' => 'BOOLEAN', 'defaultType' => 'current_timestamp()'] + $t);
$addSpec($phpunitServer, ['type' => 'TIMESTAMP', 'length' => '3', 'extra' => '', 'defaultType' => 'CURRENT_TIMESTAMP'] + $t);
foreach (["'0000-00-00 00:00:00'", "'0000-00-00 00:00:00.0'", "'0000-00-00 00:00:00.000000'"] as $dv) {
    $addSpec($phpunitServer, ['type' => 'TIMESTAMP', 'length' => '', 'extra' => '', 'defaultValue' => $dv] + $t);
}
foreach (['UUID', 'uuid()', 'UUID_v4', 'uuid_v4()', 'UUID_v7', 'uuid_v7()'] as $dt) {
    $addSpec($phpunitServer, ['type' => 'UUID', 'length' => '', 'extra' => '', 'defaultType' => $dt, 'defaultValue' => "'0000-00-00 00:00:00.000000'", 'comment' => '', 'moveTo' => ''] + $t);
}
$addSpec($phpunitServer, ['type' => 'BOOLEAN', 'length' => '', 'defaultType' => 'NONE', 'extra' => 'INCREMENT'] + $t);
$addSpec($phpunitServer, ['name' => 'ids', 'type' => 'INT', 'length' => '11', 'defaultType' => 'NONE', 'extra' => 'AUTO_INCREMENT', 'columnsWithIndex' => ['id'], 'oldColumnName' => 'id'] + $t);
$addSpec($phpunitServer, ['name' => 'ids', 'type' => 'INT', 'length' => '11', 'defaultType' => 'NONE', 'extra' => 'AUTO_INCREMENT', 'columnsWithIndex' => ['othercol'], 'oldColumnName' => 'id'] + $t);
$addSpec($phpunitServer, ['name' => 'id', 'type' => 'INT', 'length' => '11', 'defaultType' => 'NONE', 'extra' => 'DEF', 'columnsWithIndex' => ['id'], 'oldColumnName' => 'id'] + $t);
$addSpec($phpunitServer, ['name' => 'ids', 'type' => 'INT', 'length' => '11', 'defaultType' => 'NONE', 'extra' => 'DEF', 'columnsWithIndex' => ['id'], 'oldColumnName' => 'id'] + $t);
$addSpec($phpunitServer, ['name' => 'ids', 'type' => 'INT', 'length' => '11', 'defaultType' => 'NONE', 'extra' => 'DEF', 'columnsWithIndex' => ['ids'], 'oldColumnName' => 'id'] + $t);
$addSpec($phpunitServer, ['name' => 'ids', 'type' => 'INT', 'length' => '11', 'defaultType' => 'NONE', 'extra' => 'USER_DEFINED', 'virtuality' => 'VIRTUAL', 'expression' => '1', 'columnsWithIndex' => ['othercol'], 'oldColumnName' => 'id'] + $t);
// TableTest::testGenerateFieldSpecForRename + testGenerateAlter
$addSpec($phpunitServer, ['name' => 'created_ts', 'type' => 'TIMESTAMP', 'length' => '6', 'null' => 'NO', 'defaultValue' => 'current_timestamp(6)']);
$addSpec($phpunitServer, ['name' => 'name', 'type' => 'VARCHAR', 'length' => '2', 'attribute' => 'new_name', 'collation' => 'charset1', 'null' => 'YES', 'defaultType' => 'USER_DEFINED', 'defaultValue' => 'VARCHAR', 'extra' => 'AUTO_INCREMENT', 'comment' => 'PMA comment', 'virtuality' => 'VIRTUAL', 'expression' => 'expr', 'moveTo' => 'new_name'], 'old_name');

// combinatorial matrix
$servers = [['mysql', 50500], ['mysql', 80017], ['mysql', 80400], ['percona', 80036], ['mariadb', 100236], ['mariadb', 100237], ['mariadb', 100417], ['mariadb', 100418], ['mariadb', 100508], ['mariadb', 100509], ['mariadb', 110700]];
$typeLengths = [
    ['INT', '11'], ['INT', ''], ['TINYINT', '1'], ['TINYINT', '4'], ['BIGINT', '20'], ['SMALLINT', '6'], ['DECIMAL', '10,2'],
    ['FLOAT', '7,3'], ['VARCHAR', '255'], ['CHAR', '36'], ['TEXT', '100'], ['ENUM', "'a','b''c'"], ['SET', "'x','y'"],
    ['BIT', '8'], ['BOOLEAN', '1'], ['SERIAL', '5'], ['DATE', '3'], ['DATETIME', '6'], ['TIMESTAMP', ''], ['TIMESTAMP', '3'],
    ['TIME', '2'], ['YEAR', '4'], ['BINARY', '16'], ['VARBINARY', '32'], ['BLOB', '10'], ['JSON', '5'], ['UUID', '4'],
    ['POINT', ''], ['VECTOR', '3'], ['INET6', ''], ['timestamp', '2'], ['varchar', '20'], ['longtext', ''],
];
$defaults = [
    ['NONE', ''], ['USER_DEFINED', ''], ['USER_DEFINED', '0'], ['USER_DEFINED', 'abc'], ['USER_DEFINED', "it's \\ \"q\" \n"],
    ['USER_DEFINED', '1'], ['USER_DEFINED', 'TRUE'], ['USER_DEFINED', 'no'], ['USER_DEFINED', 'maybe'], ['USER_DEFINED', 'NOT'],
    ['USER_DEFINED', '0101'], ['USER_DEFINED', '12a'], ['USER_DEFINED', 'DEADBEEF'], ['USER_DEFINED', 'uuid_v4()'],
    ['USER_DEFINED', 'uuid_v7()'], ['USER_DEFINED', 'unix_timestamp()'], ['USER_DEFINED', 'UNIX_TIMESTAMP()'],
    ['USER_DEFINED', 'current_timestamp()'], ['USER_DEFINED', 'CURRENT_TIMESTAMP'], ['USER_DEFINED', "'2024-01-02 03:04:05'"],
    ['USER_DEFINED', "'2024-01-02 03:04:05.123'"], ['USER_DEFINED', '2024-01-02 03:04:05'], ['USER_DEFINED', 'NULL'],
    ['NULL', ''], ['CURRENT_TIMESTAMP', ''], ['current_timestamp()', ''], ['UUID', ''], ['uuid()', ''], ['UUID_v4', ''],
    ['uuid_v4()', ''], ['UUID_v7', ''], ['uuid_v7()', ''], ['something', 'x'],
];
$fullMatrix = [['mysql', 50500], ['mysql', 80400], ['mariadb', 110700]];
foreach ($servers as $si => $server) {
    $isFull = in_array($server, $fullMatrix, true);
    foreach ($typeLengths as $ti => [$type, $length]) {
        foreach ($defaults as $di => [$defaultType, $defaultValue]) {
            if (! $isFull && ($ti + $di) % 5 !== 0) {
                continue;
            }

            // rotate through null/attribute/collation/extra/comment/move choices to keep the matrix bounded
            $k = $si + $ti * 3 + $di * 7;
            $nulls = [false, 'YES', 'NO', ''];
            $attrs = ['', 'UNSIGNED', 'UNSIGNED ZEROFILL', 'BINARY', 'on update CURRENT_TIMESTAMP', 'COMPRESSED=zlib'];
            $colls = ['', 'utf8mb4_unicode_ci', 'NULL', 'latin1', 'utf8mb4_0900_ai_ci'];
            $extras = ['', 'AUTO_INCREMENT', 'auto_increment', 'on update CURRENT_TIMESTAMP'];
            $comments = ['', "Bob's \"col\" \\n"];
            $moves = ['', '-first', 'prev`col'];
            $addSpec($server, [
                'name' => $k % 5 === 0 ? 'we`ird name' : 'c' . $ti,
                'type' => $type,
                'length' => $length,
                'attribute' => $attrs[$k % count($attrs)],
                'collation' => $colls[$k % count($colls)],
                'null' => $nulls[$k % count($nulls)],
                'defaultType' => $defaultType,
                'defaultValue' => $defaultValue,
                'extra' => $extras[($k >> 1) % count($extras)],
                'comment' => $comments[$k % 2],
                'moveTo' => $moves[$k % 3],
                'columnsWithIndex' => $k % 4 === 0 ? null : ($k % 4 === 1 ? [] : ['c' . $ti, 'other']),
                'oldColumnName' => $k % 3 === 0 ? null : 'c' . $ti,
            ], $k % 6 === 0 ? 'old`name' : null);
        }
    }

    // virtual columns
    foreach (['VIRTUAL', 'STORED', 'PERSISTENT', 'VIRTUAL GENERATED'] as $virt) {
        foreach ([['VARCHAR', '20', 'utf8mb4_unicode_ci'], ['TEXT', '', 'latin1_swedish_ci'], ['INT', '11', '']] as [$type, $length, $coll]) {
            foreach ([['', 'NONE', ''], ['YES', 'USER_DEFINED', 'x'], ['NO', 'NULL', '']] as [$null, $dt, $dv]) {
                foreach (['', 'AUTO_INCREMENT', ' auto_increment UNIQUE', 'INVISIBLE'] as $extra) {
                    $addSpec($server, [
                        'name' => 'v', 'type' => $type, 'length' => $length, 'collation' => $coll, 'null' => $null,
                        'defaultType' => $dt, 'defaultValue' => $dv, 'extra' => $extra, 'virtuality' => $virt,
                        'expression' => "CONCAT(a, 'x')", 'comment' => 'gen', 'moveTo' => 'a',
                        'columnsWithIndex' => ['z'],
                    ]);
                }
            }
        }
    }
}

// loose in_array with integer index lists
$addSpec($mysql, ['name' => '1', 'type' => 'INT', 'extra' => 'AUTO_INCREMENT', 'defaultType' => 'NONE', 'columnsWithIndex' => [1, 2]]);
$addSpec($mysql, ['name' => 'abc', 'type' => 'INT', 'extra' => 'AUTO_INCREMENT', 'defaultType' => 'NONE', 'columnsWithIndex' => [0]]);
$addSpec($mysql, ['name' => '01', 'type' => 'INT', 'extra' => 'AUTO_INCREMENT', 'defaultType' => 'NONE', 'columnsWithIndex' => [1]]);

bma_write_fixture($out . '/field-spec.json', [
    'format' => '[vendor, version, [name, type, length, attribute, collation, null, defaultType, defaultValue, extra, comment, virtuality, expression, moveTo, columnsWithIndex, oldColumnName], spec, oldcol?, alter?]',
    'cases' => $specCases,
]);

// ---------------------------------------------------------------------------
// CreateAddField
// ---------------------------------------------------------------------------
$createCases = [];
$partitionCases = [];
$alterCases = [];
$phpunitPartitions = \PhpMyAdmin\Tests\CreateAddFieldTest::providerGetPartitionsDefinition();
$phpunitCreate = \PhpMyAdmin\Tests\CreateAddFieldTest::providerGetTableCreationQuery();
$phpunitAlter = \PhpMyAdmin\Tests\CreateAddFieldTest::providerGetColumnCreationQueryRequest();
$phpunitAlter[] = [
    'ALTER TABLE `my_table` ADD `dd` INT NOT NULL AFTER `d`;',
    ['db' => '2fa', 'field_where' => 'after', 'after_field' => 'd', 'table' => 'aes', 'orig_num_fields' => '1', 'orig_field_where' => 'after', 'orig_after_field' => 'd', 'field_name' => ['dd'], 'field_type' => ['INT'], 'field_length' => [''], 'field_default_type' => ['NONE'], 'field_default_value' => [''], 'field_collation' => [''], 'field_attribute' => [''], 'field_key' => ['none_0'], 'field_comments' => [''], 'field_virtuality' => [''], 'field_expression' => [''], 'field_move_to' => [''], 'field_mimetype' => [''], 'field_transformation' => [''], 'field_transformation_options' => [''], 'field_input_transformation' => [''], 'field_input_transformation_options' => [''], 'do_save_data' => '1', 'preview_sql' => '1', 'ajax_request' => '1'],
];
$extraPartitions = [
    ['partition_by' => 'RANGE', 'partition_expr' => 'YEAR(d)', 'partition_count' => '1'],
    ['partition_by' => 'RANGE', 'partition_expr' => 'YEAR(d)', 'partition_count' => 'abc'],
    ['partition_by' => 'KEY', 'partition_expr' => 'id', 'partition_count' => '3', 'subpartition_by' => 'HASH', 'subpartition_expr' => 'id', 'subpartition_count' => '0'],
    ['partition_by' => 'RANGE', 'partition_expr' => 'id', 'partition_count' => '2', 'partitions' => [
        ['name' => 'p0', 'value_type' => 'LESS THAN', 'value' => '10', 'engine' => 'InnoDB', 'comment' => "it's", 'data_directory' => '', 'index_directory' => '', 'max_rows' => '0', 'min_rows' => '', 'tablespace' => '', 'node_group' => ''],
        ['name' => 'p1', 'value_type' => 'LESS THAN MAXVALUE', 'value' => '99', 'engine' => '', 'comment' => '', 'data_directory' => '/d', 'index_directory' => '/i', 'max_rows' => '5', 'min_rows' => '1', 'tablespace' => 'ts', 'node_group' => '0', 'subpartitions' => []],
    ]],
    ['partition_by' => 'LIST', 'partition_expr' => 'id', 'partition_count' => '1', 'partitions' => [['name' => 'p0', 'value_type' => 'IN', 'value' => '1,2', 'subpartitions' => [['name' => 's0', 'engine' => 'MyISAM'], ['name' => 's1', 'comment' => 'c']]]]],
];
$phpunit = [
    'partitions' => array_map(static fn ($c) => $c[1], $phpunitPartitions),
    'extraPartitions' => $extraPartitions,
    'create' => array_map(static fn ($c) => ['db' => $c[1], 'table' => $c[2], 'post' => $c[3], 'expected' => $c[0]], $phpunitCreate),
    'alter' => array_map(static fn ($c) => $c[1], $phpunitAlter),
];
$phpunitExpected = [
    'partitions' => array_map(static fn ($c) => $c[0], $phpunitPartitions),
    'create' => array_map(static fn ($c) => $c[0], $phpunitCreate),
    'alter' => array_map(static fn ($c) => $c[0], $phpunitAlter),
];

$runCreate = static function (string $label, array $server, string $db, string $table, array $post) use (&$createCases): void {
    $dbi = bma_dbi($server[0], $server[1]);
    $_POST = $post;
    $createCases[] = [
        'label' => $label,
        'server' => ['vendor' => $server[0], 'version' => $server[1]],
        'db' => $db,
        'table' => $table,
        'post' => $post,
        'storageEngines' => ['dummy', 'dummy2', 'FEDERATED', 'Pbxt'],
        'sql' => (new CreateAddField($dbi))->getTableCreationQuery($db, $table),
    ];
};
$runAlter = static function (string $label, array $server, string $table, array $post) use (&$alterCases): void {
    $dbi = bma_dbi($server[0], $server[1]);
    $_POST = $post;
    $alterCases[] = [
        'label' => $label,
        'server' => ['vendor' => $server[0], 'version' => $server[1]],
        'table' => $table,
        'post' => $post,
        'sql' => (new CreateAddField($dbi))->getColumnCreationQuery($table),
    ];
};

foreach ($phpunit['partitions'] as $i => $post) {
    bma_dbi('mysql', 80400);
    $_POST = $post;
    $partitionCases[] = ['label' => "phpunit #$i", 'post' => $post, 'sql' => (new CreateAddField(bma_dbi()))->getPartitionsDefinition()];
}

foreach ($phpunit['extraPartitions'] as $i => $post) {
    $_POST = $post;
    $partitionCases[] = ['label' => "extra #$i", 'post' => $post, 'sql' => (new CreateAddField(bma_dbi()))->getPartitionsDefinition()];
}

foreach ($phpunit['create'] as $i => $c) {
    $runCreate("phpunit #$i", ['mysql', 55000], $c['db'], $c['table'], $c['post']);
}

foreach ($phpunit['alter'] as $i => $c) {
    $runAlter("phpunit #$i", ['mysql', 55000], 'my_table', $c);
}

// richer CREATE TABLE inputs
$columns = [
    'field_name' => ['id', 'name ', '', 'price', 'created', 'tags', 'geo', 'flag'],
    'field_type' => ['INT', 'VARCHAR', 'INT', 'DECIMAL', 'TIMESTAMP', 'SET', 'POINT', 'BIT'],
    'field_length' => ['11', '100', '', '10,2', '', "'a','b'", '', '1'],
    'field_attribute' => ['UNSIGNED', '', '', '', 'on update CURRENT_TIMESTAMP', '', '', ''],
    'field_collation' => ['', 'utf8mb4_unicode_ci', '', '', '', 'latin1_swedish_ci', '', ''],
    'field_null' => [1 => 'YES', 5 => 'YES'],
    'field_default_type' => ['NONE', 'USER_DEFINED', 'NONE', 'USER_DEFINED', 'CURRENT_TIMESTAMP', 'NULL', 'NONE', 'USER_DEFINED'],
    'field_default_value' => ['', "it's", '', '0.00', '', '', '', '1'],
    'field_extra' => ['AUTO_INCREMENT'],
    'field_comments' => ['', 'the name', '', '', '', '', '', ''],
];
$indexes = [
    'primary_indexes' => json_encode([['Key_name' => 'PRIMARY', 'Index_comment' => '', 'Index_choice' => 'PRIMARY', 'Key_block_size' => '', 'Parser' => '', 'Index_type' => '', 'columns' => [['col_index' => '0', 'size' => '']]]]),
    'unique_indexes' => json_encode([['Key_name' => 'uq_name', 'Index_comment' => "uniq'", 'Index_choice' => 'UNIQUE', 'Key_block_size' => '8', 'Parser' => '', 'Index_type' => 'HASH', 'columns' => [['col_index' => '1', 'size' => '10'], ['col_index' => 3, 'size' => '0']]]]),
    'indexes' => json_encode([['Key_name' => '', 'Index_comment' => '', 'Index_choice' => 'INDEX', 'Key_block_size' => '0', 'Parser' => '', 'Index_type' => 'BTREE', 'columns' => [['col_index' => '4', 'size' => '']]], ['Key_name' => 'idx`2', 'Index_comment' => '', 'Index_choice' => 'INDEX', 'Key_block_size' => 'abc', 'Parser' => '', 'Index_type' => 'RTREE', 'columns' => [['col_index' => '3', 'size' => '']]]]),
    'fulltext_indexes' => json_encode([['Key_name' => 'ft', 'Index_comment' => '', 'Index_choice' => 'FULLTEXT', 'Key_block_size' => '', 'Parser' => 'ngram', 'Index_type' => 'BTREE', 'columns' => [['col_index' => '1', 'size' => '']]]]),
    'spatial_indexes' => json_encode([['Key_name' => 'sp', 'Index_comment' => 'geo', 'Index_choice' => 'SPATIAL', 'Key_block_size' => '', 'Parser' => 'x', 'Index_type' => 'BTREE', 'columns' => [['col_index' => '6', 'size' => '']]]]),
];
foreach ([['mysql', 80400], ['mysql', 50500], ['mariadb', 110700]] as $server) {
    $runCreate('rich table', $server, 'shop', ' orders ', $columns + $indexes + [
        'tbl_storage_engine' => 'dummy', 'tbl_collation' => 'utf8mb4_unicode_ci', 'comment' => "Bob's orders",
        'partition_by' => 'HASH', 'partition_expr' => 'id', 'partition_count' => '4',
    ]);
    $runCreate('federated', $server, 'db', 'fed', ['field_name' => ['a'], 'field_type' => ['INT'], 'field_length' => [''], 'field_attribute' => [''], 'field_default_type' => ['NONE'], 'field_default_value' => [''], 'tbl_storage_engine' => 'FEDERATED', 'connection' => "mysql://u:p@h/db/t'x"]);
    $runCreate('default engine and collation only charset', $server, 'db', 't', ['field_name' => ['a'], 'field_type' => ['INT'], 'field_length' => [''], 'field_attribute' => [''], 'field_default_type' => ['NONE'], 'field_default_value' => [''], 'tbl_storage_engine' => 'Default', 'tbl_collation' => 'utf8mb4', 'comment' => '0']);
    $runCreate('unknown engine skipped, PBMS valid', $server, 'db', 't', ['field_name' => ['a'], 'field_type' => ['INT'], 'field_length' => [''], 'field_attribute' => [''], 'field_default_type' => ['NONE'], 'field_default_value' => [''], 'tbl_storage_engine' => 'PBMS']);
    $runCreate('only empty names', $server, 'db', 't', ['field_name' => ['', ''], 'field_type' => ['INT', 'INT'], 'field_length' => ['', ''], 'field_attribute' => ['', ''], 'field_default_type' => ['NONE', 'NONE'], 'field_default_value' => ['', ''], 'indexes' => json_encode([['Key_name' => 'k', 'Index_comment' => '', 'Index_choice' => 'INDEX', 'Key_block_size' => '', 'Parser' => '', 'Index_type' => '', 'columns' => [['col_index' => '0', 'size' => '']]]])]);
    $runCreate('virtual column', $server, 'db', 't', ['field_name' => ['a', 'b'], 'field_type' => ['INT', 'VARCHAR'], 'field_length' => ['', '20'], 'field_attribute' => ['', ''], 'field_collation' => ['', 'utf8mb4_bin'], 'field_null' => ['YES', 'NO'], 'field_default_type' => ['NONE', 'NONE'], 'field_default_value' => ['', ''], 'field_extra' => ['', 'AUTO_INCREMENT'], 'field_virtuality' => ['', 'STORED'], 'field_expression' => ['', 'CONCAT(a)']]);

    $runAlter('add first + after previous', $server, 't', $columns + $indexes + ['field_where' => 'first']);
    $runAlter('add after field', $server, 't`x', ['field_name' => ['a', 'b'], 'field_type' => ['INT', 'INT'], 'field_length' => ['', ''], 'field_attribute' => ['', ''], 'field_default_type' => ['NONE', 'NONE'], 'field_default_value' => ['', ''], 'field_where' => 'after', 'after_field' => 'z`z']);
    $runAlter('add last', $server, 't', ['field_name' => ['a', 'b'], 'field_type' => ['INT', 'INT'], 'field_length' => ['', ''], 'field_attribute' => ['', ''], 'field_default_type' => ['NONE', 'NONE'], 'field_default_value' => ['', ''], 'field_where' => 'last']);
    $runAlter('add after empty after_field', $server, 't', ['field_name' => ['a'], 'field_type' => ['INT'], 'field_length' => [''], 'field_attribute' => [''], 'field_default_type' => ['NONE'], 'field_default_value' => [''], 'field_where' => 'after', 'after_field' => '0', 'online_transaction' => '']);
    $runAlter('add with primary', $server, 't', ['field_name' => ['id'], 'field_type' => ['INT'], 'field_length' => [''], 'field_attribute' => [''], 'field_default_type' => ['NONE'], 'field_default_value' => [''], 'field_extra' => ['AUTO_INCREMENT'], 'field_where' => 'first', 'primary_indexes' => $indexes['primary_indexes']]);
}

bma_write_fixture($out . '/create-add-field.json', [
    'phpunitExpected' => $phpunitExpected,
    'partitions' => $partitionCases,
    'create' => $createCases,
    'alter' => $alterCases,
]);

// ---------------------------------------------------------------------------
// InsertEdit value generation
// ---------------------------------------------------------------------------
$valueCases = [];
$fields = [];
$functions = ['', 'MD5', 'AES_ENCRYPT', 'AES_DECRYPT', 'SHA2', 'DES_ENCRYPT', 'ENCRYPT', 'NOW', 'RAND', 'UNIX_TIMESTAMP', 'CURRENT_USER', 'UUID_SHORT', 'UUID_v4', 'ST_GeomFromText', 'GeomFromText', 'ST_PointFromWKB', 'ABS', 'CHAR', 'UUID'];
$fieldValues = ['', 'foo', "it's", '0', '3', '6', '7', '-1', '1.5', 'current_timestamp()', 'CURRENT_TIMESTAMP(3)', "'POINT(3 4)',4326", 'POINT(1 2)', "'uuid()'", 'uuid()', "'uuid_v4()'", "'uuid_v7()'", "''", '0x1A', '1A', '10201', "a\nb"];
$fieldTypes = ['', 'protected', 'uuid', 'hex', 'bit', 'datetime', 'timestamp', 'date', 'time', 'int'];
$k = 0;
foreach ($fieldTypes as $type) {
    foreach ($fieldValues as $value) {
        foreach ($functions as $fn) {
            $k++;
            if ($fn !== '' && $k % 3 !== 0) {
                continue;
            }

            $fields[] = [
                'columnName' => 'col',
                'value' => $value,
                'type' => $type,
                'autoIncrement' => $k % 5 === 0,
                'isNull' => $k % 7 === 0,
                'wasPreviouslyNull' => $k % 4 === 0,
                'function' => $fn,
                'salt' => $k % 2 === 0 ? null : ($k % 3 === 0 ? '' : 'pepper'),
                'previousValue' => $k % 6 === 0 ? $value : ($k % 6 === 1 ? null : 'old'),
                'isUploaded' => $k % 11 === 0,
            ];
        }
    }
}

// the PHPUnit cases of InsertEditTest::testGetQueryValuesForInsert/ForUpdate
$fields[] = ['columnName' => 'fld', 'value' => 'foo', 'type' => '', 'autoIncrement' => false, 'isNull' => false, 'wasPreviouslyNull' => false, 'function' => '', 'salt' => null, 'previousValue' => null, 'isUploaded' => false];
$fields[] = ['columnName' => '', 'value' => '0x123', 'type' => '', 'autoIncrement' => false, 'isNull' => false, 'wasPreviouslyNull' => false, 'function' => '', 'salt' => null, 'previousValue' => null, 'isUploaded' => true];
$fields[] = ['columnName' => '', 'value' => "'", 'type' => '', 'autoIncrement' => false, 'isNull' => false, 'wasPreviouslyNull' => false, 'function' => 'AES_ENCRYPT', 'salt' => '', 'previousValue' => null, 'isUploaded' => false];

$uuidValue = '9f0c7c6e-3a4b-11ef-9f3e-0242ac120002';
$protectedValue = "\x01\x02abc";
foreach ([['mariadb', 100903], ['mysql', 50500]] as $server) {
    foreach ($fields as $i => $f) {
        $dbi = bma_dbi($server[0], $server[1], $ext);
        Current::$table = 'test_table';
        $config = Config::getInstance();
        $relation = new Relation($dbi);
        $insertEdit = new InsertEdit($dbi, $relation, new Transformations($dbi, $relation), new FileListing(), new Template($config), $config, new \PhpMyAdmin\Tests\Stubs\ResponseRenderer());
        $editField = new EditField($f['columnName'], $f['value'], $f['type'], $f['autoIncrement'], $f['isNull'], $f['wasPreviouslyNull'], $f['function'], $f['salt'], $f['previousValue'], $f['isUploaded']);

        $usingKey = $i % 2 === 0;
        $whereClause = $usingKey ? '`id` = 4' : '';
        $hasProtected = $i % 3 !== 0;
        if ($f['type'] === 'protected' && $usingKey) {
            $ext->addResult('SELECT `col` FROM `test_table` WHERE `id` = 4 LIMIT 1;', $hasProtected ? [[$protectedValue]] : [[null]]);
        }

        if ($f['function'] === 'UUID') {
            $ext->addResult('SELECT UUID()', [[$uuidValue]]);
            $ext->addResult('SELECT UUID()', [[$uuidValue]]);
        }

        // phpMyAdmin fails hard (TypeError) on some inputs, e.g. a GIS function with a multi-line value
        try {
            $insert = $insertEdit->getQueryValueForInsert($editField, $usingKey, $whereClause);
        } catch (Throwable $e) {
            $insert = ['error' => get_class($e)];
        }

        try {
            $update = $insertEdit->getQueryValueForUpdate($editField);
        } catch (Throwable $e) {
            $update = ['error' => get_class($e)];
        }
        $valueCases[] = [
            'server' => ['vendor' => $server[0], 'version' => $server[1]],
            'field' => $f,
            'usingKey' => $usingKey,
            'whereClause' => $whereClause,
            'protectedValue' => $f['type'] === 'protected' && $usingKey ? ($hasProtected ? bma_bytes($protectedValue) : null) : null,
            'uuid' => $uuidValue,
            'insert' => is_array($insert) ? $insert : bma_bytes($insert),
            'update' => is_array($update) ? $update : bma_bytes($update),
        ];
    }
}

bma_write_fixture($out . '/insert-edit-values.json', ['cases' => $valueCases]);
