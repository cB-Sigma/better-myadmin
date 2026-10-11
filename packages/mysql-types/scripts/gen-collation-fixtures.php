<?php
// Collation descriptions as phpMyAdmin computes them (Charsets\Collation::buildDescription), for every
// collation of the connected server plus MariaDB-only names.
// Usage: php scripts/gen-collation-fixtures.php > test/fixtures/collation-descriptions.json
declare(strict_types=1);

require __DIR__ . '/pma-bootstrap.php';

use PhpMyAdmin\Charsets\Collation;

$names = [];
$host = getenv('BMA_MYSQL_HOST') ?: '127.0.0.1';
$m = @new mysqli($host, getenv('BMA_MYSQL_USER') ?: 'root', getenv('BMA_MYSQL_PASSWORD') ?: 'root', '', (int) (getenv('BMA_MYSQL_PORT') ?: 3306));
if (! $m->connect_errno) {
    $r = $m->query('SELECT COLLATION_NAME FROM information_schema.COLLATIONS');
    while ($row = $r->fetch_row()) {
        $names[] = $row[0];
    }
}
// MariaDB, legacy and odd names
array_push(
    $names,
    'utf8mb3_general_ci', 'utf8mb4_uca1400_ai_ci', 'utf8mb4_german2_ci', 'latin1_german1_ci', 'utf8_unicode_520_ci',
    'utf8mb4_es_trad_0900_ai_ci', 'utf8mb4_de_pb_0900_ai_ci', 'utf8mb4_nopad_bin', 'ucs2_general_mysql500_ci',
    'foo_unicode_ci', 'binary', 'armscii_general_ci', 'utf8mb4_unicode_nopad_ci', 'utf8mb4_croatian_mysql561_ci',
);
sort($names);
$out = [];
foreach (array_unique($names) as $n) {
    $out[$n] = Collation::fromServer(['Collation' => $n])->getDescription();
}
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
