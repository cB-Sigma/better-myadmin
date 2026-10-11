<?php
// Expected KB lookups computed by the library phpMyAdmin uses (williamdes/mariadb-mysql-kbs Search).
// Usage: php scripts/gen-fixtures.php /path/to/phpmyadmin > test/fixtures.json
declare(strict_types=1);

require ($argv[1] ?? '../phpmyadmin') . '/vendor/autoload.php';

use Williamdes\MariaDBMySQLKBS\KBException;
use Williamdes\MariaDBMySQLKBS\Search;

$names = [
    'max_connections', 'sql_mode', 'innodb_buffer_pool_size', 'collation_connection', 'character_set_server',
    'Aborted_clients', 'aria_block_size', 'wsrep_on', 'log_bin', 'general_log', 'version', 'gtid_mode',
    'aurora_lab_mode', 'not_a_variable', 'Innodb_buffer_pool_pages_data', 'tx_isolation', 'default_storage_engine', 'AuroraDb_commits',
];
$out = [];
foreach ($names as $n) {
    $row = [];
    foreach (['any' => Search::ANY, 'mysql' => Search::MYSQL, 'mariadb' => Search::MARIADB] as $k => $t) {
        try {
            $row[$k] = Search::getByName($n, $t);
        } catch (KBException) {
            $row[$k] = null;
        }
    }
    try {
        $row['type'] = Search::getVariableType($n);
    } catch (KBException) {
        $row['type'] = null;
    }
    $out[$n] = $row;
}
$out['__static_count'] = count(Search::getStaticVariables());
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
