<?php

/**
 * Shared by the metadata fixture generators: a DbiMysqli that records every statement per link,
 * and a DatabaseInterface connected for real (user + control link) like the Authentication
 * middleware does.
 */

declare(strict_types=1);

use PhpMyAdmin\Config;
use PhpMyAdmin\Config\Settings\Server;
use PhpMyAdmin\Current;
use PhpMyAdmin\Dbal\Connection;
use PhpMyAdmin\Dbal\ConnectionType;
use PhpMyAdmin\Dbal\DatabaseInterface;
use PhpMyAdmin\Dbal\DbiMysqli;
use PhpMyAdmin\Dbal\MysqliResult;
use PhpMyAdmin\Identifiers\DatabaseName;
use PhpMyAdmin\I18n\LanguageManager;

/** DbiMysqli that records what it sends, per connection kind. */
final class RecordingMysqli extends DbiMysqli
{
    /** @var list<array{conn: string, kind: string, sql: string}> */
    public array $log = [];
    public bool $recording = false;
    /** @var array<int, string> spl_object_id(Connection) → 'user'|'control' */
    public array $names = [];
    /** When set, every recorded SELECT/SHOW is re-run on it right away to capture its rows. */
    public mysqli|null $shadow = null;
    /** @var array<string, string> link name → selected database */
    private array $selected = [];

    private function name(Connection $c): string
    {
        return $this->names[spl_object_id($c)] ?? '?';
    }

    public function selectDb(string|DatabaseName $databaseName, Connection $connection): bool
    {
        if ($this->recording) {
            $this->log[] = ['conn' => $this->name($connection), 'kind' => 'selectDb', 'sql' => (string) $databaseName];
        }

        $ok = parent::selectDb($databaseName, $connection);
        if ($ok) {
            $this->selected[$this->name($connection)] = (string) $databaseName;
        }

        return $ok;
    }

    public function realQuery(string $query, Connection $connection, bool $unbuffered = false): MysqliResult|false
    {
        if ($this->recording) {
            $this->log[] = ['conn' => $this->name($connection), 'kind' => 'query', 'sql' => $query];
        }

        $result = parent::realQuery($query, $connection, $unbuffered);
        if ($this->recording && $this->shadow !== null && preg_match('/^\s*(SELECT|SHOW)\b/i', $query) === 1) {
            $i = array_key_last($this->log);
            $db = $this->selected[$this->name($connection)] ?? null;
            if ($db !== null) {
                $this->shadow->select_db($db);
            }

            $res = $result === false ? false : $this->shadow->query($query);
            if ($res instanceof mysqli_result) {
                $this->log[$i]['fields'] = array_map(static fn ($f) => $f->name, $res->fetch_fields());
                $this->log[$i]['rows'] = $res->fetch_all(MYSQLI_ASSOC);
            } else {
                $this->log[$i]['error'] = $result === false ? 'failed' : $this->shadow->error;
            }
        }

        return $result;
    }

    public function realMultiQuery(Connection $connection, string $query): bool
    {
        if ($this->recording) {
            $this->log[] = ['conn' => $this->name($connection), 'kind' => 'multi', 'sql' => $query];
        }

        return parent::realMultiQuery($connection, $query);
    }

    /** @return list<array{conn: string, kind: string, sql: string}> */
    public function take(): array
    {
        $log = $this->log;
        $this->log = [];

        return $log;
    }
}

/**
 * @param array<string, mixed> $serverIn Servers[1]
 *
 * @return array{DatabaseInterface, RecordingMysqli, Config}
 */
function bma_meta_dbi(array $serverIn, string $currentDb = ''): array
{
    Config::$instance = null;
    $config = Config::getInstance();
    $config->set('ZeroConf', true);
    $config->selectedServer = (new Server($serverIn))->asArray();
    Current::$server = 1;
    Current::$database = $currentDb;
    Current::$table = '';

    $ext = new RecordingMysqli();
    $dbi = DatabaseInterface::getInstanceForTest($ext, $config);
    $srv = new Server($config->selectedServer);
    $lm = LanguageManager::getInstance();
    $lm->activate($lm->getLanguage('en'));
    $userConn = $dbi->connect($srv, ConnectionType::User);
    $controlConn = $dbi->connect($srv, ConnectionType::ControlUser);
    if ($userConn === null || $controlConn === null) {
        throw new RuntimeException('could not connect');
    }

    $ext->names[spl_object_id($userConn)] = 'user';
    $ext->names[spl_object_id($controlConn)] = 'control';
    DatabaseInterface::$instance = $dbi;
    // reset Relation::$cache (static)
    (static fn () => self::$cache = null)->bindTo(null, \PhpMyAdmin\ConfigStorage\Relation::class)();
    Current::$message = null;

    return [$dbi, $ext, $config];
}
