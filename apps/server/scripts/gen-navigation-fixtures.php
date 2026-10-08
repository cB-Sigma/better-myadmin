<?php
// Generates test/unit/fixtures/navigation-php.json from PHP and phpMyAdmin's own code: the string
// ordering the navigation tree relies on, Util::pageselector and ShowGrants parsing.
// Usage: php scripts/gen-navigation-fixtures.php /path/to/phpmyadmin > test/unit/fixtures/navigation-php.json
declare(strict_types=1);
$pma = $argv[1] ?? '/home/user/ref/pma';
define('ROOT_PATH', $pma . '/');
require $pma . '/vendor/autoload.php';

use PhpMyAdmin\ShowGrants;
use PhpMyAdmin\Util;

$words = [
  '', 'a', 'A', 'a1', 'a01', 'a001', 'a2', 'a10', 'a10b', 'a 10', 'a  10', 'a9z', 'a0', 'a00', '0', '00', '007',
  '1', '10', '1.5', '1.05', 'x-1', 'x-10', 'x_1', 'x_10', 'X_2', 'db', 'DB_2', 'db_10', 'db10', 'db_1a', 'ä',
  'é1', 'É10', ' lead', 'lead', 'Tbl', 'tbl', 'tbl_', 'tbl__x', '_x', 'z', 'Z9', '9z', 'a01b', 'a1b', 'a001b2',
];
$pairs = [];
foreach ($words as $a) {
  foreach ($words as $b) {
    $pairs[] = [$a, $b, strnatcasecmp($a, $b), strcasecmp($a, $b) <=> 0, strnatcmp($a, $b)];
  }
}

$sortInputs = [
  ['information_schema', 'm1nav\\_%', 'mysql', 'performance_schema', 'sys', 'm1nav\\_10', 'm1nav\\_2%'],
  ['10', '9', '1e1', 'abc', '010', 'Abc', '9a'],
  ['b', 'a', 'B', 'A', '_a', '1', ''],
];
$sorts = [];
foreach ($sortInputs as $in) {
  $s = $in;
  sort($s);
  $sorts[] = [$in, $s];
}

$selectors = [];
foreach ([[50, 1, 2], [50, 2, 3], [25, 7, 12], [100, 1, 199], [100, 1, 200], [100, 57, 260], [50, 1, 1000],
  [50, 480, 1000], [50, 999, 1000], [50, 1000, 1000], [10, 3, 4000], [10, 2500, 4000], [250, 5, 201]] as [$rows, $now, $total]) {
  $html = Util::pageselector('pos', $rows, $now, $total);
  preg_match_all('/<option (selected style="font-weight: bold")?\s*value="([^"]*)">([^<]*)<\/option>/', $html, $m, PREG_SET_ORDER);
  $selectors[] = [
    'rows' => $rows, 'pageNow' => $now, 'total' => $total,
    'pages' => array_map(fn ($x) => [(int) $x[2], (int) $x[3], $x[1] !== ''], $m),
  ];
}

$grants = [];
foreach ([
  'GRANT USAGE ON *.* TO `u`@`%`',
  'GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION',
  'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, RELOAD ON *.* TO `u`@`localhost`',
  'GRANT ALL PRIVILEGES ON `m1nav\\_%`.* TO `m1nav_x`@`%`',
  'GRANT SELECT ON `db`.`tbl` TO `u`@`%`',
  'GRANT SELECT ON `my``db`.`t.b` TO `u`@`%`',
  'GRANT SELECT, INSERT ON `mysql`.`db` TO `u`@`%`',
  'GRANT CREATE ON `new\\_db`.* TO `u`@`%`',
  'GRANT `role1`@`%` TO `u`@`%`',
] as $line) {
  $g = new ShowGrants($line);
  $grants[] = [$line, $g->grants, $g->dbName, $g->tableName];
}

echo json_encode(['pairs' => $pairs, 'sorts' => $sorts, 'selectors' => $selectors, 'grants' => $grants],
  JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
