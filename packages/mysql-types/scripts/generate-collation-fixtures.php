<?php

/**
 * Golden fixtures for collationDescription(): Charsets\Collation::fromServer()->getDescription()
 * for every collation of the reachable MySQL server plus MariaDB / legacy names.
 *
 *   php packages/mysql-types/scripts/generate-collation-fixtures.php
 */

declare(strict_types=1);

require __DIR__ . '/pma-bootstrap.php';

use PhpMyAdmin\Charsets\Collation;

$names = [
    'binary', 'utf8_general_ci', 'utf8_general_mysql500_ci', 'utf8mb3_unicode_ci', 'utf8mb4_unicode_520_ci',
    'utf8mb4_german2_ci', 'latin1_german1_ci', 'utf8mb4_de_pb_0900_ai_ci', 'utf8mb4_es_trad_0900_ai_ci',
    'utf8mb4_es_0900_ai_ci', 'utf8mb4_de_0900_ai_ci', 'utf8mb4_uca1400_ai_ci', 'utf8mb4_uca1400_swedish_nopad_ai_ci',
    'ucs2_unicode_ci', 'ucs2_vietnamese_ci', 'gb18030_chinese_ci', 'gbk_chinese_ci', 'big5_chinese_ci',
    'unknownx_unicode_ci', 'unknownx_foo_bar', 'latin1_spanish_ci', 'latin1_spanish2_ci', 'cp1250_polish_ci',
    'utf8mb4_ja_0900_as_cs_ks', 'utf8mb4_0900_bin', 'utf16_unicode_520_nopad_ci', 'armscii8_general_ci',
    'koi8u_general_ci', 'utf8mb4_la_0900_ai_ci', 'utf8mb4_zh_0900_as_cs', 'latin1_general_w2', 'latin1_general_l2',
    '', 'utf8mb4', 'utf8mb4_', 'x_y_z_ci',
];
$m = $GLOBALS['bma_mysqli'];
if ($m instanceof mysqli) {
    foreach ($m->query('SELECT COLLATION_NAME FROM information_schema.COLLATIONS ORDER BY 1')->fetch_all() as [$name]) {
        $names[] = $name;
    }
}

$cases = [];
foreach (array_values(array_unique($names)) as $name) {
    $cases[] = [$name, Collation::fromServer(['Collation' => $name])->getDescription()];
}

bma_write_fixture(dirname(__DIR__) . '/test/fixtures/collations.json', ['cases' => $cases]);
