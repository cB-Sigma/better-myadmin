<?php

/**
 * Golden fixtures for the server-level pages, produced by EXECUTING phpMyAdmin code:
 *  - Collation::fromServer()->getDescription() for every collation of the live server plus MariaDB names
 *  - Processes-style title case (mb_convert_case MB_CASE_TITLE) of the Com_* names
 *  - Server\Status\Data::calculateValues / sortVariables on a recorded status set
 *
 *   php apps/server/scripts/gen-server-admin-fixtures.php
 *
 * Output: apps/server/test/unit/fixtures/server-admin.json
 */

declare(strict_types=1);

require __DIR__ . '/../../../packages/mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Charsets\Collation;
use PhpMyAdmin\Server\Status\Data;

$names = [];
$m = $GLOBALS['bma_mysqli'];
if ($m instanceof mysqli) {
    $res = $m->query('SELECT COLLATION_NAME FROM information_schema.COLLATIONS');
    while ($row = $res->fetch_row()) {
        $names[] = $row[0];
    }
}

// MariaDB 10.10+ / 11.x names and odd ones
array_push(
    $names,
    'uca1400_ai_ci', 'utf8mb4_uca1400_as_cs', 'utf8mb4_uca1400_swedish_nopad_ai_ci', 'utf8mb3_general_nopad_ci',
    'utf8mb4_german2_ci', 'utf8mb4_de_pb_0900_ai_ci', 'utf8mb4_es_trad_0900_as_cs', 'latin1_german1_ci',
    'ucs2_unicode_520_ci', 'utf8_general_mysql500_ci', 'utf32_bin', 'koi8u_bin', 'unknown_collation', 'binary',
    'gb18030_chinese_ci', 'gbk_chinese_ci', 'cp1250_croatian_ci', 'utf8mb4_ja_0900_as_cs_ks', 'utf8mb4_zh_0900_as_cs',
    'utf8mb4_la_0900_ai_ci', 'armscii8_general_ci', 'tis620_thai_ci', 'utf8mb4_vi_0900_as_cs', 'utf16le_general_ci',
);
$collations = [];
foreach (array_unique($names) as $name) {
    $collations[$name] = Collation::fromServer(['Collation' => $name])->getDescription();
}

$titles = [];
foreach (['Com_show_status', 'Com_select', 'Com_stmt_reprepare', 'Com_show_binlog_events', 'Com_alter_db_upgrade', 'Com_xa_start', 'Com_ha_open', 'Com_show_create_func'] as $key) {
    $titles[$key] = mb_convert_case(str_replace(['Com_', '_'], ['', ' '], $key), MB_CASE_TITLE);
}

$status = [
    'Key_blocks_unused' => '6000', 'Key_blocks_used' => '10', 'Key_writes' => '3', 'Key_write_requests' => '40',
    'Key_reads' => '7', 'Key_read_requests' => '100', 'Threads_created' => '5', 'Connections' => '120',
    'Com_select' => '4', 'Com_insert' => '0', 'Com_admin_commands' => '9', 'Com_prepare_sql' => '1', 'Com_stmt_prepare' => '2',
    'Innodb_rows_read' => '5', 'Handler_write' => '1', 'Ssl_cipher' => '', 'Slow_launch_threads' => '0', 'Uptime' => '99',
    'Open_tables' => '3', 'Not_flushed_delayed_rows' => '0', 'Rpl_status' => 'NULL', 'Tc_log_page_size' => '0', 'Foo' => '1',
];
$variables = ['key_cache_block_size' => '1024', 'key_buffer_size' => '8388608'];
$data = (new ReflectionClass(Data::class))->newInstanceWithoutConstructor();
$calc = (new ReflectionMethod(Data::class, 'calculateValues'))->invoke($data, Data::cleanDeprecated($status), $variables);
[$allocationMap, $sectionUsed, $usedQueries] = (new ReflectionMethod(Data::class, 'sortVariables'))->invoke($data, $calc);
unset($usedQueries['Com_admin_commands']);

bma_write_fixture(dirname(__DIR__) . '/test/unit/fixtures/server-admin.json', [
    'collations' => $collations,
    'titles' => $titles,
    'status' => [
        'input' => $status,
        'variables' => $variables,
        'calculated' => array_map(static fn ($v) => is_float($v) ? ['float' => $v] : $v, $calc),
        'allocationMap' => $allocationMap,
        'sectionUsed' => array_keys($sectionUsed),
        'usedQueries' => array_keys($usedQueries),
    ],
]);
