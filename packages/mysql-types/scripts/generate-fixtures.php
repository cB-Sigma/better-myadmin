<?php

/**
 * Golden fixtures for @bettermyadmin/mysql-types, produced by EXECUTING
 * phpMyAdmin code (Types, Util, Compatibility, Html\Generator, FieldMetadata).
 *
 *   php packages/mysql-types/scripts/generate-fixtures.php
 *
 * Output: packages/mysql-types/test/fixtures/*.json
 */

declare(strict_types=1);

require __DIR__ . '/pma-bootstrap.php';

use PhpMyAdmin\Config;
use PhpMyAdmin\FieldMetadata;
use PhpMyAdmin\Html\Generator;
use PhpMyAdmin\Query\Compatibility;
use PhpMyAdmin\TypeClass;
use PhpMyAdmin\Util;

$out = dirname(__DIR__) . '/test/fixtures';

$allTypes = [
    'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'REAL', 'BIT', 'BOOLEAN',
    'SERIAL', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR', 'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT',
    'LONGTEXT', 'BINARY', 'VARBINARY', 'TINYBLOB', 'MEDIUMBLOB', 'BLOB', 'LONGBLOB', 'ENUM', 'SET', 'GEOMETRY',
    'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION', 'JSON',
    'INET4', 'INET6', 'UUID', 'VECTOR', 'XMLTYPE', 'UNKNOWN', '', 'int', 'varchar', 'Timestamp', 'enum', 'uuid',
    'json', 'point', 'serial',
];

// ---------------------------------------------------------------------------
// Server dependent catalog
// ---------------------------------------------------------------------------
$servers = [];
foreach (bma_server_matrix() as $server) {
    $dbi = bma_dbi($server['vendor'], $server['version']);
    $types = $dbi->types;

    $columns = [];
    foreach ($types->getColumns() as $key => $value) {
        $columns[] = is_array($value) ? ['group' => (string) $key, 'types' => $value] : $value;
    }

    $functionsClass = [];
    foreach (TypeClass::cases() as $class) {
        $functionsClass[$class->value === '' ? 'UNKNOWN' : $class->value] = $types->getFunctionsClass($class);
    }

    $lengthSupport = [];
    foreach ($allTypes as $t) {
        foreach (['', '1', '2', '11'] as $len) {
            $lengthSupport[] = [$t, $len, Compatibility::isIntegersSupportLength($t, $len, $dbi)];
        }
    }

    // datatype <select> options (Generator::getSupportedDatatypes) parsed back into data
    $html = Generator::getSupportedDatatypes('VARCHAR');
    preg_match_all('@<optgroup label="([^"]*)">|</optgroup>|<option( disabled)?(?: data-length-restricted="(\d)" (selected)? title="([^"]*)")?>([^<]*)</option>@', $html, $m, PREG_SET_ORDER);
    $options = [];
    $group = null;
    foreach ($m as $match) {
        if (($match[1] ?? '') !== '') {
            $group = html_entity_decode($match[1]);
            continue;
        }

        if ($match[0] === '</optgroup>') {
            $group = null;
            continue;
        }

        if (($match[2] ?? '') !== '') {
            $options[] = ['group' => $group, 'separator' => true];
            continue;
        }

        $options[] = [
            'group' => $group,
            'type' => $match[6],
            'lengthRestricted' => $match[3] === '1',
            'selected' => $match[4] === 'selected',
            'description' => html_entity_decode($match[5], ENT_QUOTES),
        ];
    }

    $servers[] = [
        'server' => $server,
        'serverType' => Util::getServerType($dbi),
        'columns' => $columns,
        'supportedDatatypes' => Util::getSupportedDatatypes($dbi),
        'attributes' => $types->getAttributes(),
        'functionsClass' => $functionsClass,
        'allFunctions' => $types->getAllFunctions(),
        'datatypeOptions' => $options,
        'compat' => [
            'isMySqlOrPerconaDb' => Compatibility::isMySqlOrPerconaDb($dbi),
            'isMariaDb' => Compatibility::isMariaDb($dbi),
            'isCompatibleRenameIndex' => Compatibility::isCompatibleRenameIndex($dbi, $dbi->getVersion()),
            'isIntegersLengthRestricted' => Compatibility::isIntegersLengthRestricted($dbi),
            'supportsReferencesPrivilege' => Compatibility::supportsReferencesPrivilege($dbi),
            'isVirtualColumnsSupported' => Compatibility::isVirtualColumnsSupported($dbi, $dbi->getVersion()),
            'isJsonSupported' => Compatibility::isJsonSupported($dbi),
            'isUUIDSupported' => Compatibility::isUUIDSupported($dbi),
            'isUUIDv4Supported' => Compatibility::isUUIDv4Supported($dbi),
            'isUUIDv7Supported' => Compatibility::isUUIDv7Supported($dbi),
            'isVectorSupported' => Compatibility::isVectorSupported($dbi),
            'isXmlTypeSupported' => Compatibility::isXmlTypeSupported($dbi),
            'supportsStoredKeywordForVirtualColumns' => Compatibility::supportsStoredKeywordForVirtualColumns(
                $dbi,
                $dbi->getVersion(),
            ),
            'supportsCompressedColumns' => Compatibility::supportsCompressedColumns($dbi, $dbi->getVersion()),
            'hasAccountLocking' => Compatibility::hasAccountLocking($dbi->isMariaDB(), $dbi->getVersion()),
            'showBinLogStatusStmt' => Compatibility::getShowBinLogStatusStmt($dbi),
        ],
        'integersSupportLength' => $lengthSupport,
    ];
}

bma_write_fixture($out . '/catalog-by-server.json', ['servers' => $servers]);

// ---------------------------------------------------------------------------
// Server independent behaviour of Types
// ---------------------------------------------------------------------------
$dbi = bma_dbi('mysql', 80400);
$types = $dbi->types;

$descriptions = [];
$classes = [];
$operators = [];
foreach ($allTypes as $t) {
    $descriptions[$t] = $types->getTypeDescription($t);
    $classes[$t] = $types->getTypeClass($t)->value;
    $operators[] = [$t, false, $types->getTypeOperators($t, false)];
    $operators[] = [$t, true, $types->getTypeOperators($t, true)];
}

foreach (['enum(\'a\')', 'ENUM', 'enumx', 'set', 'char(10)', 'varchar'] as $t) {
    $operators[] = [$t, true, $types->getTypeOperators($t, true)];
    $classes[$t] = $types->getTypeClass($t)->value;
}

$ops = [
    '=', '>', '>=', '<', '<=', '!=', 'LIKE', 'LIKE %...%', 'NOT LIKE', 'NOT LIKE %...%', 'IN (...)', 'NOT IN (...)',
    'BETWEEN', 'NOT BETWEEN', 'REGEXP', 'REGEXP ^...$', 'NOT REGEXP', "= ''", "!= ''", 'IS NULL', 'IS NOT NULL',
    'is null', 'XX',
];
$unary = [];
$display = [];
foreach ($ops as $op) {
    $unary[$op] = $types->isUnaryOperator($op);
    $display[$op] = $types->displayOfOperator($op);
}

$ranges = [];
foreach (['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'INT', 'float', ''] as $t) {
    $ranges[] = [$t, true, $types->getIntegerRange($t, true)];
    $ranges[] = [$t, false, $types->getIntegerRange($t, false)];
}

$aliases = [];
foreach (
    [
        'BOOL', 'BOOLEAN', 'CHARACTER VARYING', 'FIXED', 'FLOAT4', 'FLOAT8', 'INT1', 'INT2', 'INT3', 'INT4', 'INT8',
        'LONG VARBINARY', 'LONG VARCHAR', 'LONG', 'MIDDLEINT', 'NUMERIC', 'INT', 'bool', 'VARCHAR',
    ] as $a
) {
    $aliases[$a] = $types->mapAliasToMysqlType($a);
}

$typesHtml = [];
foreach ([['int', false, null], ['enum', true, '!='], ['varchar', true, 'LIKE'], ['uuid', false, '=']] as [$t, $n, $sel]) {
    $typesHtml[] = [$t, $n, $sel, $types->getTypeOperatorsHtml($t, $n, $sel)];
}

bma_write_fixture($out . '/types.json', [
    'descriptions' => $descriptions,
    'classes' => $classes,
    'operators' => $operators,
    'unary' => $unary,
    'displayOfOperator' => $display,
    'integerTypes' => $types->getIntegerTypes(),
    'floatTypes' => $types->getFloatTypes(),
    'integerRanges' => $ranges,
    'aliases' => $aliases,
    'operatorsHtml' => $typesHtml,
]);

// ---------------------------------------------------------------------------
// Util helpers about column specs and values
// ---------------------------------------------------------------------------
$specs = [
    'int(11)', 'int(10) unsigned', 'int(10) unsigned zerofill', 'INT(10) UNSIGNED ZEROFILL', 'bigint unsigned',
    'tinyint(1)', 'decimal(10,2)', 'float', 'double(8,3) unsigned', 'varchar(255)', 'char(36)', 'varchar(20) binary',
    'char(5) BINARY', 'binary(16)', 'varbinary(255)', 'blob', 'tinyblob', 'longtext', 'text', 'mediumtext',
    'text /*!100301 COMPRESSED*/', 'varchar(100) /*M!100301 COMPRESSED*/', 'blob /*!100301 COMPRESSED*/',
    "enum('a','b','c')", "ENUM('a','b')", "set('x','y','z')", "enum('a,b','c''d','e\\\\f','g\\'h')",
    "set('','x')", "enum('&#8211;','&ldquo;')", "enum('one','two','three','four','five','six','seven','eight','nine')",
    'timestamp', 'timestamp(6)', 'datetime(3)', 'time', 'year(4)', 'date', 'bit(1)', 'bit(64)', 'json', 'point',
    'geometry', 'uuid', 'inet6', 'inet4', 'vector(3)', 'serial', 'mediumint(8) unsigned', 'varchar(12) character set utf8',
    "enum('a','b') character set utf8mb4", 'something', '', 'xmltype',
    'varchar(255) COLLATE utf8mb4_unicode_ci', 'double precision', 'long varbinary',
];
$extracted = [];
foreach ($specs as $spec) {
    $extracted[$spec] = Util::extractColumnSpec($spec);
}

$limitChars = 20;
Config::getInstance()->set('LimitChars', $limitChars);
$extractedShortLimit = [];
foreach (["enum('one','two','three','four','five','six','seven','eight','nine')", 'varchar(255) character set utf8mb4 collate utf8mb4_unicode_ci', "enum('<b>','\"x\"')"] as $spec) {
    $extractedShortLimit[$spec] = Util::extractColumnSpec($spec);
}

Config::getInstance()->set('LimitChars', 50);

$enumDefs = [
    "enum('a','b')", "set('a','b','c')", "enum('a,b','c')", "enum('it''s','b')", "enum('a\\'b')",
    "enum('back\\\\slash','x')", "enum('<script>','&amp;')", "enum('')", "enum('a','')", "set('a', 'b')",
    "enum('x\"y')", "ENUM('1','2','3')",
];
$enumValues = [];
foreach ($enumDefs as $def) {
    $enumValues[] = [$def, Util::parseEnumSetValues($def, false), Util::parseEnumSetValues($def, true)];
}

$bits = [];
foreach ([[0, 1], [1, 1], [5, 4], [5, 8], [255, 8], [256, 8], [1024, 12], [PHP_INT_MAX, 64], [-1, 64], [7, 2], [3, 0]] as [$v, $l]) {
    $bits[] = [(string) $v, $l, Util::printableBitValue($v, $l)];
}

$bitDefaults = [];
foreach (["b'010'", "b'0'", "b''", "b'", "b'101", '0101', "B'01'", "b&#039;01&#039;", null, '', "b'12'", "b'1'x"] as $v) {
    $bitDefaults[] = [$v, Util::convertBitDefaultValue($v)];
}

$unquote = [];
foreach (["'abc'", '"abc"', '`abc`', "'ab''c'", '"a""b"', '`a``b`', 'abc', "'abc", "'", "''", "'é'"] as $v) {
    $unquote[] = [$v, null, Util::unQuote($v)];
    $unquote[] = [$v, "'", Util::unQuote($v, "'")];
    $unquote[] = [$v, '"', Util::unQuote($v, '"')];
}

$unquoteDefault = [];
foreach (["'abc'", "'it''s'", "'it\\'s'", "'back\\\\slash'", 'abc', 'NULL', "'0'", "''", 'current_timestamp()', "'"] as $v) {
    $unquoteDefault[] = [$v, Util::unquoteDefaultValue($v)];
}

$charsetParts = [];
foreach (['utf8mb4_general_ci', 'utf8mb4', 'latin1_swedish_ci', 'binary', 'utf8mb4_0900_ai_ci', 'armscii8'] as $c) {
    $charsetParts[] = [$c, false, Util::getCharsetQueryPart($c)];
    $charsetParts[] = [$c, true, Util::getCharsetQueryPart($c, true)];
}

$micro = [];
foreach (['', 'current_timestamp()', 'CURRENT_TIMESTAMP(6)', 'current_timestamp', '12:00:00', '2024-01-01 10:00:00.5', '10:00:00.1234567', '2024-01-01 10:00:00.123456', '1.'] as $v) {
    $micro[] = [$v, Util::addMicroseconds($v)];
}

$csv = [];
foreach (
    [
        "'a','b'", "'a', 'b'", "  'a'  ,  'b'  ", "a,b", "'a''b','c'", "'a\\'b'", "'a\\\\','b'", "'unterminated",
        "''", "", ",", "'a',", "'a'x,'b'", "'a\nb','c'", "'a'\n", "x\r\n", "'x'\r\n", "'\\", "'a\\''b'",
        "'é','ü'", "\t'a'", "'a' 'b'", "'',''", "'a',,'b'",
    ] as $line
) {
    $csv[] = [$line, str_getcsv($line, ',', "'", '\\')];
}

bma_write_fixture($out . '/util.json', [
    'strGetCsv' => $csv,
    'extractColumnSpec' => $extracted,
    'extractColumnSpecLimitChars' => ['limitChars' => $limitChars, 'cases' => $extractedShortLimit],
    'parseEnumSetValues' => $enumValues,
    'printableBitValue' => $bits,
    'convertBitDefaultValue' => $bitDefaults,
    'unQuote' => $unquote,
    'unquoteDefaultValue' => $unquoteDefault,
    'getCharsetQueryPart' => $charsetParts,
    'addMicroseconds' => $micro,
]);

// ---------------------------------------------------------------------------
// Insert/edit function dropdown
// ---------------------------------------------------------------------------
$defaultFunctionCases = [];
$configs = [
    'default' => null,
    'custom' => [
        'FUNC_CHAR' => 'UPPER',
        'FUNC_DATE' => 'NOW',
        'FUNC_NUMBER' => 'ABS',
        'FUNC_SPATIAL' => 'ST_GeomFromText',
        'FUNC_UUID' => 'UUID',
        'FUNC_JSON' => 'QUOTE',
        'first_timestamp' => 'UTC_TIMESTAMP',
    ],
    'spatialNoPrefix' => ['FUNC_SPATIAL' => 'PointFromText', 'FUNC_UUID' => ''],
];
$trueTypes = [
    ['int', 'int(11)'], ['varchar', 'varchar(36)'], ['char', 'char(36)'], ['char', 'char(10)'], ['text', 'text'],
    ['timestamp', 'timestamp'], ['datetime', 'datetime'], ['date', 'date'], ['point', 'point'],
    ['geometry', 'geometry'], ['json', 'json'], ['uuid', 'uuid'], ['enum', "enum('a')"], ['blob', 'blob'],
    ['vector', 'vector(3)'], ['decimal', 'decimal(10,2)'], ['timestamp', 'timestamp(6)'],
];
foreach ([['mysql', 50500], ['mysql', 80400], ['mariadb', 110700]] as [$vendor, $version]) {
    foreach ($configs as $configName => $configValue) {
        $dbi = bma_dbi($vendor, $version);
        $config = Config::getInstance();
        $defaults = $config->settings['DefaultFunctions'];
        if ($configValue !== null) {
            $config->settings['DefaultFunctions'] = array_replace($defaults, $configValue);
        }

        $cases = [];
        foreach ($trueTypes as [$trueType, $type]) {
            foreach ([['', '', false], [null, '', false], ['CURRENT_TIMESTAMP', '', false], [null, 'on update CURRENT_TIMESTAMP', false], [null, '', true], ['x', 'auto_increment', false]] as [$default, $extra, $isNull]) {
                foreach (['', 'PRI', 'UNI'] as $key) {
                    foreach ([true, false] as $insertMode) {
                        $cases[] = [
                            $trueType,
                            $trueType === 'timestamp',
                            $default,
                            $extra,
                            $isNull,
                            $key,
                            $type,
                            $insertMode,
                            Generator::getDefaultFunctionForField(
                                $trueType,
                                $trueType === 'timestamp',
                                $default,
                                $extra,
                                $isNull,
                                $key,
                                $type,
                                $insertMode,
                            ),
                        ];
                    }
                }
            }
        }

        $defaultFunctionCases[] = [
            'server' => ['vendor' => $vendor, 'version' => $version],
            'config' => $configName,
            'cases' => $cases,
        ];
    }
}

$functionsForField = [];
foreach ([['mysql', 50500], ['mysql', 50603], ['mysql', 80400], ['mariadb', 100011], ['mariadb', 110700]] as [$vendor, $version]) {
    bma_dbi($vendor, $version);
    foreach ([['', false], ['NOW', false], ['NOW', true], ['ST_GeomFromText', false], ['UUID', false], ['nonexistent', false]] as [$default, $foreign]) {
        $html = Generator::getFunctionsForField($default, $foreign);
        preg_match_all('@<option( selected)?( value="([^"]*)" title="([^"]*)")?>([^<]*)</option>@', $html, $m, PREG_SET_ORDER);
        $opts = [];
        foreach ($m as $match) {
            $o = ['label' => html_entity_decode($match[5], ENT_QUOTES)];
            if (($match[2] ?? '') !== '') {
                $o['value'] = $match[3];
                $o['title'] = html_entity_decode($match[4], ENT_QUOTES);
            }

            if ($match[1] === ' selected') {
                $o['selected'] = true;
            }

            $opts[] = $o;
        }

        $functionsForField[] = [
            'server' => ['vendor' => $vendor, 'version' => $version],
            'defaultFunction' => $default,
            'hasForeignField' => $foreign,
            'options' => $opts,
        ];
    }
}

bma_write_fixture($out . '/insert-edit-functions.json', [
    'defaultFunctionsConfig' => array_map(
        static fn ($c) => $c === null ? null : $c,
        $configs,
    ),
    'defaultFunctionForField' => $defaultFunctionCases,
    'functionsForField' => $functionsForField,
]);

// ---------------------------------------------------------------------------
// FieldMetadata (mysqli field packet -> flags/mapped type)
// ---------------------------------------------------------------------------
$fieldCases = [];
$typeCodes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 242];
foreach ($typeCodes as $code) {
    foreach ([[0, 33], [MYSQLI_PRI_KEY_FLAG | MYSQLI_NOT_NULL_FLAG | MYSQLI_NUM_FLAG, 63], [MYSQLI_UNIQUE_KEY_FLAG | MYSQLI_BLOB_FLAG | MYSQLI_BINARY_FLAG, 63], [MYSQLI_MULTIPLE_KEY_FLAG | MYSQLI_UNSIGNED_FLAG | MYSQLI_ZEROFILL_FLAG | MYSQLI_ENUM_FLAG | MYSQLI_SET_FLAG, 8]] as [$flags, $charset]) {
        $meta = new FieldMetadata((object) [
            'name' => 'c',
            'orgname' => 'c',
            'table' => 't',
            'orgtable' => 't',
            'max_length' => 0,
            'length' => 10,
            'charsetnr' => $charset,
            'flags' => $flags,
            'type' => $code,
            'decimals' => 0,
            'db' => 'db',
            'def' => '',
            'catalog' => 'def',
        ]);
        $fieldCases[] = [
            'type' => $code,
            'flags' => $flags,
            'charsetnr' => $charset,
            'mappedType' => $meta->getMappedType(),
            'isMultipleKey' => $meta->isMultipleKey,
            'isPrimaryKey' => $meta->isPrimaryKey,
            'isUniqueKey' => $meta->isUniqueKey,
            'isNotNull' => $meta->isNotNull,
            'isUnsigned' => $meta->isUnsigned,
            'isZerofill' => $meta->isZerofill,
            'isNumeric' => $meta->isNumeric,
            'isBlob' => $meta->isBlob,
            'isBinary' => $meta->isBinary,
            'isEnum' => $meta->isEnum,
            'isSet' => $meta->isSet,
            'isMappedTypeBit' => $meta->isMappedTypeBit,
            'isMappedTypeGeometry' => $meta->isMappedTypeGeometry,
            'isMappedTypeTimestamp' => $meta->isMappedTypeTimestamp,
            'isDateTimeType' => $meta->isDateTimeType(),
            'isTimeType' => $meta->isTimeType(),
        ];
    }
}

bma_write_fixture($out . '/field-metadata.json', ['cases' => $fieldCases]);
