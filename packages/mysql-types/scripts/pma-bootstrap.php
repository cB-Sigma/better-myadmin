<?php

/**
 * Shared bootstrap for the golden-fixture generators of @bettermyadmin/mysql-types
 * and @bettermyadmin/sql-gen.
 *
 * It loads phpMyAdmin (reference checkout, PMA_PATH env, default /home/user/ref/pma)
 * with its composer autoloader (incl. autoload-dev for the test stubs) and offers
 * `bma_dbi()` which builds a DatabaseInterface for a given server vendor/version.
 *
 * String quoting goes through a REAL mysqli connection when one is reachable
 * (BMA_MYSQL_HOST/PORT/USER/PASSWORD env; default 127.0.0.1:3306 root/root), so
 * the fixtures contain exactly what mysqlnd's real_escape_string produces.
 * Without a server it falls back to a PHP port of mysqlnd_cset_escape_slashes
 * for utf8mb4 (byte-identical for valid UTF-8 input); the fixture header records
 * which one was used.
 */

declare(strict_types=1);

use PhpMyAdmin\Config;
use PhpMyAdmin\Current;
use PhpMyAdmin\Dbal\Connection;
use PhpMyAdmin\Dbal\DatabaseInterface;
use PhpMyAdmin\Tests\Stubs\DbiDummy;

$pmaPath = rtrim((string) (getenv('PMA_PATH') ?: '/home/user/ref/pma'), '/');

if (! defined('ROOT_PATH')) {
    define('ROOT_PATH', $pmaPath . DIRECTORY_SEPARATOR);
}

define('TESTSUITE', true);
ini_set('precision', '14');
error_reporting(E_ALL);
date_default_timezone_set('UTC');

require_once ROOT_PATH . 'app/constants.php';
require_once AUTOLOAD_FILE;

// The reference checkout has no PHPUnit installed: provide the two classes the
// test stubs/providers touch (TestCase as a base class, Assert::fail on misuse).
spl_autoload_register(static function (string $class): void {
    if ($class === 'PHPUnit\\Framework\\TestCase') {
        eval('namespace PHPUnit\\Framework; abstract class TestCase {}');
    } elseif ($class === 'PHPUnit\\Framework\\Assert') {
        eval('namespace PHPUnit\\Framework; final class Assert { public static function fail(string $m = ""): never { throw new \\RuntimeException($m); } }');
    }
});

// autoload-dev (test stubs) may be missing from the installed class map
spl_autoload_register(static function (string $class): void {
    $prefix = 'PhpMyAdmin\\Tests\\';
    if (! str_starts_with($class, $prefix)) {
        return;
    }

    $file = ROOT_PATH . 'tests/unit/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

/** @var mysqli|null $GLOBALS['bma_mysqli'] */
$GLOBALS['bma_mysqli'] = null;
$GLOBALS['bma_escape_source'] = 'php-port';

(static function (): void {
    if (getenv('BMA_NO_MYSQL') === '1') {
        return;
    }

    mysqli_report(MYSQLI_REPORT_OFF);
    $m = @new mysqli(
        (string) (getenv('BMA_MYSQL_HOST') ?: '127.0.0.1'),
        (string) (getenv('BMA_MYSQL_USER') ?: 'root'),
        (string) (getenv('BMA_MYSQL_PASSWORD') ?: 'root'),
        '',
        (int) (getenv('BMA_MYSQL_PORT') ?: 3306),
    );
    if ($m->connect_errno) {
        return;
    }

    $m->set_charset('utf8mb4');
    $GLOBALS['bma_mysqli'] = $m;
    $GLOBALS['bma_escape_source'] = 'mysqli ' . $m->server_info . ' (' . $m->client_info . ')';
})();

/** PHP port of mysqlnd_cset_escape_slashes for a non-multibyte-sensitive charset */
function bma_php_escape(string $s): string
{
    return strtr($s, [
        "\0" => '\\0',
        "\n" => '\\n',
        "\r" => '\\r',
        '\\' => '\\\\',
        "'" => "\\'",
        '"' => '\\"',
        "\x1a" => '\\Z',
    ]);
}

function bma_escape(string $s, string $charset = 'utf8mb4'): string
{
    $m = $GLOBALS['bma_mysqli'];
    if ($m instanceof mysqli) {
        if ($charset !== 'utf8mb4') {
            $m->set_charset($charset);
            $r = $m->real_escape_string($s);
            $m->set_charset('utf8mb4');

            return $r;
        }

        return $m->real_escape_string($s);
    }

    if ($charset !== 'utf8mb4' && $charset !== 'latin1' && $charset !== 'binary') {
        throw new RuntimeException('multibyte escaping fixtures need a MySQL server');
    }

    return bma_php_escape($s);
}

/** DbiDummy whose quoteString behaves like the production mysqli driver. */
final class BmaDbi extends DbiDummy
{
    public function quoteString(Connection $connection, string $string): string
    {
        return "'" . bma_escape($string) . "'";
    }
}

/**
 * @param 'mysql'|'mariadb'|'percona' $vendor
 */
function bma_version_string(string $vendor, int $version): string
{
    $s = intdiv($version, 10000) . '.' . (intdiv($version, 100) % 100) . '.' . ($version % 100);

    return $vendor === 'mariadb' ? $s . '-MariaDB' : $s;
}

/**
 * Creates (and installs as the global instance) a DatabaseInterface for the
 * given server.
 *
 * @param 'mysql'|'mariadb'|'percona' $vendor
 */
function bma_dbi(string $vendor = 'mysql', int $version = 80400, BmaDbi|null &$extension = null): DatabaseInterface
{
    Config::$instance = null;
    $config = Config::getInstance();
    $config->selectedServer['DisableIS'] = false;
    Current::$database = 'db';
    Current::$table = 'table';
    Current::$lang = 'en';

    $extension = new BmaDbi();
    $dbi = DatabaseInterface::getInstanceForTest($extension, $config);
    $dbi->setVersion([
        '@@version' => bma_version_string($vendor, $version),
        '@@version_comment' => $vendor === 'percona' ? 'Percona Server (GPL), Release 1' : 'Source distribution',
    ]);
    DatabaseInterface::$instance = $dbi;

    return $dbi;
}

/** @return list<array{vendor: string, version: int}> */
function bma_server_matrix(): array
{
    $list = [];
    foreach (
        [
            ['mysql', 50500],
            ['mysql', 50602],
            ['mysql', 50603],
            ['mysql', 50707],
            ['mysql', 50708],
            ['mysql', 80017],
            ['mysql', 80018],
            ['mysql', 80400],
            ['mysql', 90000],
            ['percona', 80036],
            ['mariadb', 50500],
            ['mariadb', 100011],
            ['mariadb', 100012],
            ['mariadb', 100100],
            ['mariadb', 100206],
            ['mariadb', 100207],
            ['mariadb', 100236],
            ['mariadb', 100237],
            ['mariadb', 100417],
            ['mariadb', 100418],
            ['mariadb', 100500],
            ['mariadb', 100508],
            ['mariadb', 100509],
            ['mariadb', 100611],
            ['mariadb', 100700],
            ['mariadb', 101000],
            ['mariadb', 110604],
            ['mariadb', 110700],
            ['mariadb', 110701],
            ['mariadb', 120300],
        ] as [$vendor, $version]
    ) {
        $list[] = ['vendor' => $vendor, 'version' => $version];
    }

    return $list;
}

/**
 * Encodes a PHP (byte) string for JSON: valid UTF-8 stays a string, anything
 * else becomes {"hex": "..."} so the fixture keeps exact bytes.
 */
function bma_bytes(string|null $s): string|array|null
{
    if ($s === null) {
        return null;
    }

    return mb_check_encoding($s, 'UTF-8') ? $s : ['hex' => bin2hex($s)];
}

function bma_write_fixture(string $path, array $data): void
{
    $data = ['_generated' => [
        'by' => basename($_SERVER['argv'][0] ?? 'generator'),
        'pma' => trim((string) @shell_exec('git -C ' . escapeshellarg(ROOT_PATH) . ' rev-parse --short HEAD')),
        'escape' => $GLOBALS['bma_escape_source'],
    ]] + $data;
    $json = bma_json($data);
    file_put_contents($path, $json . "\n");
    fwrite(STDERR, 'wrote ' . $path . "\n");
}

/**
 * JSON encoder that pretty-prints nested structures but keeps arrays/objects
 * holding only scalars on one line (readable diffs, small files).
 */
function bma_json(mixed $value, string $indent = ''): string
{
    $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION;
    if (! is_array($value)) {
        return json_encode($value, $flags);
    }

    $isList = array_is_list($value);
    if ($value === []) {
        return '[]';
    }

    $scalarOnly = true;
    foreach ($value as $v) {
        if (is_array($v) && $v !== []) {
            $scalarOnly = false;
            break;
        }
    }

    $parts = [];
    $inner = $indent . '  ';
    foreach ($value as $k => $v) {
        $enc = bma_json($v, $inner);
        $parts[] = $isList ? $enc : json_encode((string) $k, $flags) . ': ' . $enc;
    }

    [$open, $close] = $isList ? ['[', ']'] : ['{', '}'];
    if ($scalarOnly) {
        return $open . implode(', ', $parts) . $close;
    }

    return $open . "\n" . $inner . implode(",\n" . $inner, $parts) . "\n" . $indent . $close;
}
