<?php

/**
 * Golden fixtures for the advisor port: runs phpMyAdmin's Advisor (Symfony ExpressionLanguage and
 * the registered ADVISOR_* functions) on recorded and crafted SHOW GLOBAL STATUS / VARIABLES sets.
 *
 *   php packages/kbs/scripts/advisor-fixtures.php          # records the live server (127.0.0.1:3306) too
 *
 * Output: packages/kbs/test/fixtures/advisor.json
 */

declare(strict_types=1);

require __DIR__ . '/../../mysql-types/scripts/pma-bootstrap.php';

use PhpMyAdmin\Advisory\Advisor;
use PhpMyAdmin\Server\SysInfo\Base;
use PhpMyAdmin\Server\SysInfo\SysInfo;
use Symfony\Component\ExpressionLanguage\ExpressionLanguage;

/** @return array<string, string> */
function bma_key_pairs(string $sql): array
{
    $m = $GLOBALS['bma_mysqli'];
    if (! $m instanceof mysqli) {
        return [];
    }

    $out = [];
    $res = $m->query($sql);
    while ($row = $res->fetch_row()) {
        $out[$row[0]] = $row[1];
    }

    return $out;
}

function bma_memory(int|null $total): void
{
    $sysInfo = new class ($total) extends Base {
        public function __construct(private int|null $total)
        {
        }

        public function memory(): array
        {
            return $this->total === null ? [] : ['MemTotal' => $this->total];
        }
    };
    (new ReflectionProperty(SysInfo::class, 'instance'))->setValue(null, $sysInfo);
}

/**
 * @param array<string, string> $status
 * @param array<string, string> $variables
 */
function bma_run_advisor(string $vendor, int $version, array $status, array $variables, int|null $memory): array
{
    $extension = null;
    $dbi = bma_dbi($vendor, $version, $extension);
    $extension->removeDefaultResults();
    $rows = static fn (array $kv): array => array_map(null, array_keys($kv), array_values($kv));
    $extension->addResult('SHOW GLOBAL STATUS', $rows($status), ['Variable_name', 'Value']);
    $extension->addResult('SHOW GLOBAL VARIABLES', $rows($variables), ['Variable_name', 'Value']);
    bma_memory($memory);

    $advisor = new Advisor($dbi, new ExpressionLanguage());
    $result = $advisor->run();
    $rule = static fn (array $r): array => [
        'id' => $r['id'],
        'name' => $r['name'],
        'issue' => $r['issue'],
        'recommendation' => $r['recommendation'],
        'justification' => $r['justification'],
        'formula' => $r['formula'],
        'test' => $r['test'],
    ];

    return [
        'fired' => array_map($rule, $result['fired']),
        'notfired' => array_map($rule, $result['notfired']),
        'unchecked' => array_map(static fn (array $r): string => $r['id'], $result['unchecked']),
        'errors' => array_map(
            // file paths in PHP error messages are machine specific
            static fn (string $e): string => str_replace(ROOT_PATH, '{ROOT}/', $e),
            $result['errors'],
        ),
    ];
}

$liveStatus = bma_key_pairs('SHOW GLOBAL STATUS');
$liveVariables = bma_key_pairs('SHOW GLOBAL VARIABLES');

// a deterministic base set (the subset of variables the rules read), MySQL 8.4 shaped
$base = [
    'status' => [
        'Uptime' => '3600', 'Questions' => '5000', 'Slow_queries' => '10', 'Sort_merge_passes' => '3',
        'Sort_scan' => '100', 'Sort_range' => '20', 'Sort_rows' => '12000', 'Select_range_check' => '0',
        'Select_scan' => '250', 'Select_full_join' => '4', 'Handler_read_first' => '75', 'Handler_read_rnd' => '9',
        'Handler_read_rnd_next' => '80000', 'Created_tmp_tables' => '400', 'Created_tmp_disk_tables' => '12',
        'Key_blocks_used' => '10', 'Key_blocks_unused' => '6000', 'Key_read_requests' => '100', 'Key_reads' => '7',
        'Opened_tables' => '300', 'Open_files' => '20', 'Table_locks_waited' => '0', 'Table_locks_immediate' => '900',
        'Threads_created' => '5', 'Connections' => '120', 'Slow_launch_threads' => '0', 'Max_used_connections' => '9',
        'Aborted_connects' => '3', 'Aborted_clients' => '1', 'Com_select' => '1500', 'Qcache_hits' => '0',
    ],
    'variables' => [
        'version' => '8.4.11', 'version_comment' => 'MySQL Community Server - GPL',
        'version_compile_machine' => 'x86_64', 'version_compile_os' => 'Linux', 'long_query_time' => '10.000000',
        'slow_query_log' => 'OFF', 'tmp_table_size' => '16777216', 'max_heap_table_size' => '16777216',
        'key_buffer_size' => '8388608', 'key_cache_block_size' => '1024', 'open_files_limit' => '1048576',
        'thread_cache_size' => '9', 'slow_launch_time' => '2', 'max_connections' => '151',
        'innodb_buffer_pool_size' => '134217728', 'innodb_log_file_size' => '50331648',
        'innodb_log_files_in_group' => '2', 'concurrent_insert' => 'AUTO', 'table_open_cache' => '4000',
    ],
];

$qcache = [
    'status' => [
        'Qcache_hits' => '20', 'Qcache_free_memory' => '1031000', 'Qcache_free_blocks' => '40',
        'Qcache_total_blocks' => '100', 'Qcache_inserts' => '500', 'Qcache_lowmem_prunes' => '3',
    ],
    'variables' => [
        'query_cache_size' => '1048576', 'query_cache_type' => 'ON', 'query_cache_limit' => '1048576',
        'query_cache_min_res_unit' => '4096',
    ],
];

$merge = static function (array ...$sets): array {
    $out = ['status' => [], 'variables' => []];
    foreach ($sets as $set) {
        $out['status'] = array_merge($out['status'], $set['status'] ?? []);
        $out['variables'] = array_merge($out['variables'], $set['variables'] ?? []);
    }

    return $out;
};

$cases = [];
$add = static function (string $name, string $vendor, int $version, array $set, int|null $memory) use (&$cases): void {
    $cases[] = [
        'name' => $name,
        'vendor' => $vendor,
        'version' => $version,
        'memory' => $memory,
        'status' => $set['status'],
        'variables' => $set['variables'],
        'result' => bma_run_advisor($vendor, $version, $set['status'], $set['variables'], $memory),
    ];
};

if ($liveStatus !== []) {
    $add('live server', 'mysql', (int) sprintf('%d%02d%02d', ...array_map(intval(...), explode('.', explode('-', $liveVariables['version'])[0]))), ['status' => $liveStatus, 'variables' => $liveVariables], 16_000_000);
}

$add('base MySQL 8.4', 'mysql', 80411, $base, 16_000_000);
$add('base without system memory', 'mysql', 80411, $base, null);
$add('MySQL 8.0.2 gets the query cache rules', 'mysql', 80002, $merge($base, $qcache, ['variables' => ['version' => '8.0.2-dmr']]), 4_000_000);
$add('MariaDB 10.6 query cache on', 'mariadb', 100612, $merge($base, $qcache, ['variables' => ['version' => '10.6.12-MariaDB-log']]), 4_000_000);
$add('MariaDB 10.6 query cache off', 'mariadb', 100612, $merge($base, $qcache, ['variables' => ['version' => '10.6.12-MariaDB', 'query_cache_type' => 'OFF']]), 4_000_000);
$add('MariaDB query cache size 0', 'mariadb', 100500, $merge($base, $qcache, ['variables' => ['version' => '10.5.0-MariaDB', 'query_cache_size' => '0', 'query_cache_type' => '0']]), 4_000_000);
$add('big query cache, fragmented', 'mariadb', 100417, $merge($base, $qcache, ['status' => ['Qcache_free_blocks' => '90', 'Qcache_lowmem_prunes' => '400'], 'variables' => ['version' => '10.4.17-MariaDB', 'query_cache_size' => '268435456', 'query_cache_limit' => '2097152']]), 4_000_000);
$add('MySQL 5.5 legacy variables', 'mysql', 50562, $merge($base, $qcache, ['variables' => ['version' => '5.5.62-log', 'log_slow_queries' => 'OFF', 'have_innodb' => 'DISABLED']]), 2_000_000);
$add('MySQL 5.0 release series', 'mysql', 50095, $merge($base, $qcache, ['variables' => ['version' => '5.0.95', 'log_slow_queries' => 'ON', 'have_innodb' => 'YES', 'version_comment' => 'Percona Server, built from source', 'version_compile_machine' => 'i686', 'version_compile_os' => 'pc-linux-gnu']]), 8_000_000);
$add('MySQL 5.1.20 minor version', 'mysql', 50120, $merge($base, $qcache, ['variables' => ['version' => '5.1.20-beta', 'log_slow_queries' => 'ON', 'have_innodb' => 'YES']]), 8_000_000);
$add('MySQL 5.5.3 minor version', 'mysql', 50503, $merge($base, $qcache, ['variables' => ['version' => '5.5.3-m3', 'log_slow_queries' => 'ON', 'have_innodb' => 'YES']]), 8_000_000);
$add('busy server', 'mysql', 80036, $merge($base, ['status' => [
    'Uptime' => '200000', 'Questions' => '90000000', 'Slow_queries' => '9000000', 'Sort_merge_passes' => '500000',
    'Sort_rows' => '999999999', 'Created_tmp_disk_tables' => '600000', 'Key_blocks_used' => '8000',
    'Key_blocks_unused' => '100', 'Key_reads' => '50', 'Opened_tables' => '3000000', 'Open_files' => '1000000',
    'Table_locks_waited' => '500', 'Threads_created' => '100000', 'Slow_launch_threads' => '12',
    'Max_used_connections' => '150', 'Aborted_connects' => '50000', 'Aborted_clients' => '9000',
], 'variables' => [
    'long_query_time' => '1.000000', 'slow_query_log' => 'ON', 'tmp_table_size' => '33554432',
    'thread_cache_size' => '0', 'slow_launch_time' => '5', 'innodb_log_file_size' => '536870912',
    'innodb_buffer_pool_size' => '1073741824', 'concurrent_insert' => 'NEVER', 'open_files_limit' => '1000',
]]), 64_000_000);
$add('MariaDB 10.11 InnoDB log size', 'mariadb', 101106, $merge($base, ['variables' => ['version' => '10.11.6-MariaDB', 'innodb_log_file_size' => '10485760']]), 4_000_000);
$add('InnoDB disabled (no innodb variables)', 'mysql', 80411, ['status' => $base['status'], 'variables' => array_diff_key($base['variables'], ['innodb_buffer_pool_size' => 1, 'innodb_log_file_size' => 1, 'innodb_log_files_in_group' => 1])], 16_000_000);
$add('zero uptime and connections', 'mysql', 80411, $merge($base, ['status' => ['Uptime' => '0', 'Connections' => '0', 'Questions' => '0']]), 16_000_000);
$add('non-numeric values', 'mysql', 80411, $merge($base, ['status' => ['Sort_scan' => 'abc', 'Opened_tables' => '12abc', 'Slow_launch_threads' => ''], 'variables' => ['key_buffer_size' => 'lots', 'max_connections' => '1e2', 'thread_cache_size' => ' 7 ', 'concurrent_insert' => '0']]), 16_000_000);
$add('missing variables', 'mysql', 80411, ['status' => array_diff_key($base['status'], ['Questions' => 1, 'Sort_rows' => 1]), 'variables' => array_diff_key($base['variables'], ['long_query_time' => 1, 'max_connections' => 1, 'version_comment' => 1])], 16_000_000);
$add('large counters (int overflow)', 'mysql', 80411, $merge($base, ['status' => ['Uptime' => '9223372036854775807', 'Questions' => '9223372036854775807', 'Slow_queries' => '9223372036854775000', 'Sort_rows' => '18446744073709551615']]), 16_000_000);
$add('tiny rates', 'mysql', 80411, $merge($base, ['status' => ['Uptime' => '31536000', 'Sort_merge_passes' => '1', 'Handler_read_first' => '30', 'Handler_read_rnd' => '2', 'Aborted_clients' => '40', 'Opened_tables' => '100000']]), 16_000_000);

$add('argument coercion', 'mariadb', 100612, $merge($base, $qcache, ['status' => ['Uptime' => '3600.9'], 'variables' => ['version' => '10.6.12-MariaDB', 'tmp_table_size' => '16777216.5', 'query_cache_size' => 'big', 'query_cache_limit' => '1048576.0', 'slow_launch_time' => '2.5']]), 4_000_000);
$add('string comparisons', 'mysql', 80411, $merge($base, ['variables' => ['version' => '10.0', 'long_query_time' => 'ten', 'slow_query_log' => '0', 'concurrent_insert' => 'NEVER']]), 16_000_000);

bma_write_fixture(dirname(__DIR__) . '/test/fixtures/advisor.json', ['cases' => $cases]);
