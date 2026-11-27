<?php

/**
 * Fixture for src/db/mysqlnd-charsets.ts: the character set names mysqli::set_charset accepts
 * (mysqlnd looks a name up in its own charset table, ignoring case, and fails with "Invalid
 * character set was provided" before sending `SET NAMES <name>`), probed with every name the
 * servers list (SHOW CHARACTER SET) plus the utf8 aliases.
 *
 * Usage: php apps/server/scripts/gen-mysqlnd-charsets.php [host] [user] [password] [port...]
 *   > apps/server/test/unit/fixtures/mysqlnd-charsets.json
 */

declare(strict_types=1);

mysqli_report(MYSQLI_REPORT_OFF);
$host = $argv[1] ?? '127.0.0.1';
$user = $argv[2] ?? 'root';
$password = $argv[3] ?? 'root';
$ports = array_map(intval(...), array_slice($argv, 4)) ?: [3306, 3307];

$names = ['utf8' => true, 'utf8mb3' => true, 'filename' => true];
foreach ($ports as $port) {
    $m = @new mysqli($host, $user, $password, '', $port);
    if ($m->connect_errno !== 0) {
        fwrite(STDERR, "port {$port}: {$m->connect_error}\n");
        continue;
    }

    foreach ($m->query('SHOW CHARACTER SET')->fetch_all() as $row) {
        $names[(string) $row[0]] = true;
    }

    $m->close();
}

$m = new mysqli($host, $user, $password, '', $ports[0]);
$known = [];
foreach (array_keys($names) as $name) {
    $name = (string) $name;
    if ($m->set_charset($name) || $m->error !== 'Invalid character set was provided') {
        $known[] = $name;
    }

    $m->set_charset('utf8mb4');
}

sort($known, SORT_STRING);
echo json_encode($known), "\n";
