<?php

/**
 * Generates the JSON fixtures of packages/sql-lexer/test/fixtures/ by running the PHP implementation
 * (phpmyadmin/sql-parser 6.0.1 as vendored by phpMyAdmin, plus phpMyAdmin's Linter) over:
 *   - the sql-parser test corpus (tests/data/lexer, parser, bugs, misc *.in files),
 *   - the extra edge cases of scripts/extra-cases.php.
 *
 * Usage: php packages/sql-lexer/scripts/gen-fixtures.php [/path/to/pma] [/path/to/sql-parser]
 */

declare(strict_types=1);

use PhpMyAdmin\Linter;
use PhpMyAdmin\SqlParser\Components\Expression;
use PhpMyAdmin\SqlParser\Context;
use PhpMyAdmin\SqlParser\Lexer;
use PhpMyAdmin\SqlParser\Parser;
use PhpMyAdmin\SqlParser\Statement;
use PhpMyAdmin\SqlParser\Statements\DeleteStatement;
use PhpMyAdmin\SqlParser\Statements\SelectStatement;
use PhpMyAdmin\SqlParser\Statements\UpdateStatement;
use PhpMyAdmin\SqlParser\Token;
use PhpMyAdmin\SqlParser\TokensList;
use PhpMyAdmin\SqlParser\Translator;
use PhpMyAdmin\SqlParser\Utils\BufferedQuery;
use PhpMyAdmin\SqlParser\Utils\Query;
use PhpMyAdmin\SqlParser\Utils\StatementFlags;
use PhpMyAdmin\SqlParser\Utils\StatementInfo;

$pmaRoot = $argv[1] ?? '/home/user/ref/pma';
$sqlParserRoot = $argv[2] ?? '/home/user/ref/sql-parser';

require $pmaRoot . '/vendor/autoload.php';

Translator::setLocale('en');
// Warnings (undefined offsets, properties of null...) are part of the reference behaviour: silence them.
set_error_handler(static fn (): bool => true);
ini_set('memory_limit', '2G');

$outDir = dirname(__DIR__) . '/test/fixtures';
@mkdir($outDir, 0777, true);

// ---------------------------------------------------------------------------
// Inputs

/** @return list<array{name: string, query: string, context: string|null, delimiter: string|null, source: string}> */
function collectCases(string $sqlParserRoot): array
{
    $cases = [];
    foreach (['lexer', 'parser', 'bugs', 'misc'] as $dir) {
        $files = glob($sqlParserRoot . '/tests/data/' . $dir . '/*.in');
        sort($files);
        foreach ($files as $file) {
            $query = file_get_contents($file);
            if (! mb_check_encoding($query, 'UTF-8')) {
                fwrite(STDERR, "skipping non UTF-8 input $file\n");
                continue;
            }

            $name = $dir . '/' . basename($file, '.in');
            $context = null;
            $pos = strpos($name, '_mariadb_');
            if ($pos !== false) {
                $context = 'MariaDb' . (int) substr($name, $pos + 9, 6);
            }

            $cases[] = ['name' => $name, 'query' => $query, 'context' => $context, 'delimiter' => null, 'source' => 'corpus'];
        }
    }

    foreach (require __DIR__ . '/extra-cases.php' as $extra) {
        $cases[] = [
            'name' => 'extra/' . $extra[0],
            'query' => $extra[1],
            'context' => $extra[2]['context'] ?? null,
            'delimiter' => $extra[2]['delimiter'] ?? null,
            'source' => 'extra',
        ];
    }

    return $cases;
}

function withContext(string|null $context, callable $fn): mixed
{
    Context::load($context ?? '');
    Context::setMode();
    try {
        return $fn();
    } finally {
        Context::load();
        Context::setMode();
    }
}

// ---------------------------------------------------------------------------
// Encoders

function enc(mixed $v): mixed
{
    if (is_string($v)) {
        return mb_check_encoding($v, 'UTF-8') ? $v : ['b' => bin2hex($v)];
    }

    if (is_float($v)) {
        if (is_nan($v)) {
            return ['f' => 'NAN'];
        }

        if (is_infinite($v)) {
            return ['f' => $v > 0 ? 'INF' : '-INF'];
        }

        return $v;
    }

    return $v;
}

/** @return list<array<mixed>> */
function encTokens(TokensList $list): array
{
    $out = [];
    for ($i = 0; $i < $list->count; ++$i) {
        $t = $list->tokens[$i];
        $out[] = [
            $t->type->value,
            $t->flags,
            enc($t->token),
            $t->value === $t->token ? null : enc($t->value),
            $t->keyword,
            $t->position,
        ];
    }

    return $out;
}

function lexerErrors(Lexer $lexer): array
{
    $out = [];
    foreach ($lexer->errors as $e) {
        $out[] = [$e->getMessage(), enc($e->ch), $e->pos, $e->getCode()];
    }

    return $out;
}

function parserErrors(Parser $parser): array
{
    $out = [];
    foreach ($parser->errors as $e) {
        $out[] = [$e->getMessage(), enc($e->token?->token), $e->token?->position, $e->getCode()];
    }

    return $out;
}

function shortClass(object|null $o): string|null
{
    if ($o === null) {
        return null;
    }

    $parts = explode('\\', $o::class);

    return end($parts);
}

function tryBuild(callable $fn): mixed
{
    try {
        return enc($fn());
    } catch (Throwable $e) {
        return ['exception' => shortClass($e) . ': ' . $e->getMessage()];
    }
}

function encFlags(StatementFlags $flags): array
{
    $true = [];
    foreach (get_object_vars($flags) as $k => $v) {
        if ($v === true) {
            $true[] = $k;
        }
    }

    return ['queryType' => $flags->queryType?->value, 'true' => $true];
}

function encInfo(StatementInfo $info): array
{
    $exprs = [];
    foreach ($info->selectExpressions as $e) {
        $exprs[] = enc($e);
    }

    return [
        'statement' => shortClass($info->statement),
        'flags' => encFlags($info->flags),
        'selectTables' => $info->selectTables,
        'selectExpressions' => $exprs,
        'errors' => parserErrors($info->parser),
    ];
}

function encStatement(Statement $s): array
{
    return [
        'class' => shortClass($s),
        'first' => $s->first,
        'last' => $s->last,
        'build' => tryBuild(static fn () => $s->build()),
    ];
}

const CLAUSES = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'SET', 'UPDATE', 'DELETE', 'INTO'];

function encQueryUtils(Statement $s, TokensList $list): array
{
    $out = ['getClause' => [], 'replace' => []];
    $isDml = $s instanceof SelectStatement || $s instanceof UpdateStatement || $s instanceof DeleteStatement;
    $clauses = $isDml ? CLAUSES : ['WHERE', 'ORDER BY', 'LIMIT'];
    foreach ($clauses as $clause) {
        foreach ([0, -1, 1] as $type) {
            $out['getClause'][] = [$clause, $type, true, tryBuild(static fn () => Query::getClause($s, $list, $clause, $type))];
        }
    }

    if ($isDml) {
        $out['getClause'][] = ['WHERE', 'LIMIT', true, tryBuild(static fn () => Query::getClause($s, $list, 'WHERE', 'LIMIT'))];
        $out['getClause'][] = ['LIMIT', 'FROM', true, tryBuild(static fn () => Query::getClause($s, $list, 'LIMIT', 'FROM'))];
        $out['getClause'][] = ['ORDER BY', 0, false, tryBuild(static fn () => Query::getClause($s, $list, 'ORDER BY', 0, false))];
    }

    $replacements = [
        ['ORDER BY `col` DESC', null, false],
        ['LIMIT 0, 25', null, false],
        ['ORDER BY', '', false],
        ['ORDER BY', 'ORDER BY x ASC', true],
        ['WHERE 1', null, false],
    ];
    foreach ($replacements as [$old, $new, $onlyType]) {
        $out['replace'][] = [$old, $new, $onlyType, tryBuild(static fn () => Query::replaceClause($s, $list, $old, $new, $onlyType))];
    }

    $ops = [
        [['FROM', 'FROM `x`'], ['LIMIT', 'LIMIT 5']],
        [['SELECT', 'SELECT COUNT(*)'], ['ORDER BY', ''], ['LIMIT', '']],
        [['WHERE', 'WHERE a = 1']],
        [],
    ];
    $out['replaceClauses'] = [];
    foreach ($ops as $op) {
        $out['replaceClauses'][] = [$op, tryBuild(static fn () => Query::replaceClauses($s, $list, $op))];
    }

    return $out;
}

// ---------------------------------------------------------------------------
// pma statement splitting (ImportSql::doImport driving BufferedQuery through Import::getNextChunk)

/** Mirror of packages/sql-lexer/src/utils/BufferedQuery.ts::splitSql (keep in sync). */
function pmaSplit(string $text, string|null $delimiter, int $chunkSize = 32768): array
{
    $statements = [];
    $bq = new BufferedQuery();
    if ($delimiter !== null) {
        $bq->setDelimiter($delimiter);
    }

    $importText = $text;
    $readMultiply = 1;
    $finished = false;

    $getNextChunk = static function () use (&$importText, &$readMultiply, &$finished, $chunkSize): string|bool {
        $size = $chunkSize;
        if ($readMultiply <= 8) {
            $size *= $readMultiply;
        } else {
            $size *= 8;
        }

        $readMultiply++;
        if ($finished) {
            return true;
        }

        if (mb_strlen($importText) < $size) {
            $finished = true;

            return $importText;
        }

        $r = mb_substr($importText, 0, $size);
        $importText = mb_substr($importText, $size);

        return $r;
    };

    while (true) {
        $statement = $bq->extract();
        if ($statement === false || $statement === '') {
            $newData = $getNextChunk();
            if ($newData === true) {
                break;
            }

            $bq->query .= preg_replace("/\r($|[^\n])/", "\n$1", $newData);
            continue;
        }

        $readMultiply = 1;
        $statements[] = $statement;
    }

    $guard = 0;
    while ($bq->query !== '') {
        $statement = $bq->extract(true);
        if ($statement === false || $statement === '') {
            // phpMyAdmin would loop forever here (extract(true) keeps returning false).
            if ($statement === false && ++$guard > 1) {
                // Leave BufferedQuery's static $i in a clean state for the next run.
                $bq->query = ' ';
                $bq->extract(true);
                break;
            }

            continue;
        }

        $guard = 0;
        $readMultiply = 1;
        $statements[] = $statement;
    }

    return $statements;
}

// ---------------------------------------------------------------------------

$cases = collectCases($sqlParserRoot);

$lexerFixtures = [];
$parserFixtures = [];
$splitFixtures = [];
$lintFixtures = [];
$firstStatementFixtures = [];

foreach ($cases as $case) {
    $query = $case['query'];
    $ctx = $case['context'];
    $delim = $case['delimiter'];
    $base = ['name' => $case['name'], 'context' => $ctx, 'delimiter' => $delim];

    // Lexer
    $lexerFixtures[] = $base + withContext($ctx, static function () use ($query, $delim): array {
        $lexer = new Lexer($query, false, $delim);

        return ['query' => $query, 'tokens' => encTokens($lexer->list), 'errors' => lexerErrors($lexer)];
    });

    // Parser + Query utilities (lexer corpus inputs are lexed only, as in the sql-parser tests)
    if (! str_starts_with($case['name'], 'lexer/')) {
        $parserFixtures[] = $base + withContext($ctx, static function () use ($query, $delim): array {
            try {
                $lexer = new Lexer($query, false, $delim);
                $parser = new Parser($lexer->list);
                $statements = [];
                foreach ($parser->statements as $s) {
                    $statements[] = encStatement($s);
                }

                $out = ['query' => $query, 'statements' => $statements, 'errors' => parserErrors($parser)];

                if ($delim === null) {
                    $out['getAll'] = encInfo(Query::getAll($query));
                }

                if ($parser->statements !== []) {
                    $s = $parser->statements[0];
                    $out['utils'] = encQueryUtils($s, $parser->list);
                    // Last: getTables() mutates the expressions.
                    $out['utils']['getTables'] = tryBuild(static fn () => Query::getTables($s));
                }

                return $out;
            } catch (Throwable $e) {
                return ['query' => $query, 'phpException' => shortClass($e) . ': ' . $e->getMessage()];
            }
        });

        // pma flow: split like the SQL tab/import, then analyse each `statement;`
        $splitFixtures[] = $base + withContext($ctx, static function () use ($query, $delim): array {
            $statements = pmaSplit($query, $delim);
            $analysed = [];
            foreach ($statements as $st) {
                try {
                    $analysed[] = encInfo(Query::getAll($st . ';'));
                } catch (Throwable $e) {
                    $analysed[] = ['phpException' => shortClass($e) . ': ' . $e->getMessage()];
                }
            }

            $out = ['query' => $query, 'statements' => $statements, 'analysed' => $analysed];
            // Chunked reading must give the same statements.
            $out['chunked'] = pmaSplit($query, $delim, 7);

            return $out;
        });

        $firstStatementFixtures[] = $base + withContext($ctx, static function () use ($query, $delim): array {
            $steps = [];
            $rest = $query;
            $d = $delim;
            for ($i = 0; $i < 5; ++$i) {
                [$first, $rest, $d] = Query::getFirstStatement($rest, $d);
                $steps[] = [enc($first), enc($rest), enc($d)];
                if ($first === null) {
                    break;
                }
            }

            return ['query' => $query, 'steps' => $steps];
        });

        if ($delim === null) {
            $lintFixtures[] = $base + withContext($ctx, static function () use ($query): array {
                try {
                    return ['query' => $query, 'lint' => Linter::lint($query)];
                } catch (Throwable $e) {
                    return ['query' => $query, 'phpException' => shortClass($e) . ': ' . $e->getMessage()];
                }
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Dedicated splitter cases

$splitCases = [
    ['basic', "SELECT 1; SELECT 2;SELECT 3", null],
    ['strings', "SELECT ';'; SELECT \";\"; SELECT `a;b` FROM t", null],
    ['comments', "SELECT 1 -- ; not here\n; SELECT 2 # ; nor here\n; /* ; */ SELECT 3", null],
    ['mysql-cmd', '/*!40101 SET NAMES utf8 */; SELECT 1', null],
    ['backslash', "SELECT 'a\\';b'; SELECT 2", null],
    ['backslash-outside', "SELECT 1 \\; SELECT 2", null],
    ['delimiter', "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;\nSELECT 2;", null],
    ['delimiter-eof', "SELECT 1;\nDELIMITER $$", null],
    ['delimiter-no-value', "SELECT 1;\nDELIMITER ", null],
    ['delimiter-in-word', "SELECT 1 AS mydelimiter ; SELECT 2", null],
    ['custom-delimiter', 'SELECT 1$$ SELECT 2 $$SELECT 3', '$$'],
    ['custom-delimiter-long', 'SELECT 1 GO SELECT 2 GO', 'GO'],
    ['crlf', "SELECT 1;\r\nSELECT 2;\rSELECT 3;\r\n", null],
    ['lone-cr-in-string', "SELECT 'a\rb'; SELECT 2", null],
    ['empty-statements', ";;; SELECT 1;;", null],
    ['whitespace', "   \n\t  ", null],
    ['zero', '0', null],
    ['unterminated-string', "SELECT 'abc; SELECT 2", null],
    ['unterminated-comment', "SELECT 1; /* abc; SELECT 2", null],
    ['dash-comment-eof', 'SELECT 1; -- end', null],
    ['unicode', "SELECT 'é;ü'; SELECT '😀'; SELECT `ñ`", null],
    ['dump', "-- phpMyAdmin SQL Dump\nSET SQL_MODE = \"NO_AUTO_VALUE_ON_ZERO\";\nSTART TRANSACTION;\n/*!40101 SET NAMES utf8mb4 */;\nCREATE TABLE `t` (\n  `id` int(11) NOT NULL COMMENT 'a;b'\n) ENGINE=InnoDB;\nINSERT INTO `t` VALUES\n(1),\n(2);\nCOMMIT;\n", null],
];
$splitExtra = [];
foreach ($splitCases as [$name, $text, $delimiter]) {
    $statements = pmaSplit($text, $delimiter);
    $splitExtra[] = [
        'name' => 'split/' . $name,
        'context' => null,
        'delimiter' => $delimiter,
        'query' => $text,
        'statements' => $statements,
        'chunked' => pmaSplit($text, $delimiter, 3),
        'analysed' => array_map(static fn (string $s): array => encInfo(Query::getAll($s . ';')), $statements),
    ];
}

$splitFixtures = array_merge($splitFixtures, $splitExtra);

// Raw BufferedQuery behaviour (options, return values).
$bqCases = [];
foreach (
    [
        ['SELECT 1; SELECT 2;', ['add_delimiter' => true]],
        ["DELIMITER $$\nSELECT 1$$\n", ['parse_delimiter' => true]],
        ["DELIMITER $$\nSELECT 1$$\nDELIMITER ;\nSELECT 2;", ['parse_delimiter' => true, 'add_delimiter' => true]],
        ['SELECT 1', []],
        ["SELECT 1; SELECT 'this is a long statement that exceeds sixteen bytes'; SELECT 3", []],
    ] as [$text, $options]
) {
    $bq = new BufferedQuery($text, $options);
    $results = [];
    for ($i = 0; $i < 20; ++$i) {
        $r = $bq->extract();
        $results[] = $r;
        if ($r === false || $r === '') {
            break;
        }
    }

    for ($i = 0; $i < 20 && $bq->query !== ''; ++$i) {
        $results[] = $bq->extract(true);
    }

    $bqCases[] = ['query' => $text, 'options' => $options, 'results' => $results];
}

// ---------------------------------------------------------------------------
// Contexts

$contextNames = [
    '', 'MySql50000', 'MySql50100', 'MySql50500', 'MySql50600', 'MySql50700', 'MySql50744', 'MySql80000', 'MySql80032',
    'MySql80100', 'MySql80400', 'MySql80406', 'MySql90000', 'MySql90100', 'MySql90300', 'MySql90500', 'MySql100000',
    'MySql40100', 'MySql50', 'MySql', 'MariaDb100000', 'MariaDb100621', 'MariaDb101100', 'MariaDb110402', 'MariaDb110800',
    'MariaDb120100', 'MariaDb120200', 'MariaDb999999', 'MariaDb50000', 'MariaDb', 'Foo', 'Foo10000',
    'PhpMyAdmin\\SqlParser\\Contexts\\ContextMySql80000', 'ContextMySql80000',
];
$loadClosest = [];
foreach ($contextNames as $name) {
    $ret = Context::loadClosest($name);
    $loadClosest[] = [$name, $ret, shortClass(new (Context::$loadedContext)())];
    Context::load();
}

$contextHashes = [];
foreach (glob($sqlParserRoot . '/src/Contexts/Context*.php') as $file) {
    $short = substr(basename($file, '.php'), strlen('Context'));
    $class = 'PhpMyAdmin\\SqlParser\\Contexts\\Context' . $short;
    $lines = [];
    foreach ($class::KEYWORDS as $kw => $flags) {
        $lines[] = $kw . '=' . $flags;
    }

    sort($lines);
    $contextHashes[$short] = ['count' => count($lines), 'sha1' => sha1(implode("\n", $lines))];
}

$words = ['select', 'SELECT', 'from', 'rank', 'ROW_NUMBER', 'lateral', 'json_table', 'generated', 'virtual', 'key',
    'int', 'varchar', 'count', 'sum', 'avg', 'order by', 'ORDER  BY', 'group by', 'table', 'database', 'user',
    'password', 'status', 'window', 'rows', 'library', 'vector', 'foo', 'é', '', 'DELIMITER', 'not null'];
$isKeyword = [];
foreach (array_keys($contextHashes) as $short) {
    Context::load($short);
    $row = [];
    foreach ($words as $w) {
        $row[] = [Context::isKeyword($w), Context::isKeyword($w, true)];
    }

    $isKeyword[$short] = $row;
}

Context::load();

$modes = ['', 'ANSI_QUOTES', 'ANSI', 'TRADITIONAL', 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION', 'FOO', 'ansi_quotes', 'NO_ENCLOSING_QUOTES'];
$modeResults = [];
$escapeInputs = ['a', 'a`b', 'a"b', 'select', 'SELECT', '$a', '123', '1a', 'a b', 'é', 'a-b', 'from', 'rank'];
foreach ($modes as $mode) {
    Context::setMode($mode);
    $esc = [];
    foreach ($escapeInputs as $in) {
        $esc[] = Context::escape($in);
    }

    $modeResults[] = [$mode, Context::getMode(), $esc, Context::hasMode(Context::SQL_MODE_ANSI_QUOTES)];
}

Context::setMode(Context::SQL_MODE_NO_ENCLOSING_QUOTES | Context::SQL_MODE_ANSI_QUOTES);
$esc = [];
foreach ($escapeInputs as $in) {
    $esc[] = Context::escape($in);
}

$modeResults[] = ['int:' . Context::getMode(), Context::getMode(), $esc, true];
Context::setMode();

// ---------------------------------------------------------------------------
// Output

function writeJsonLines(string $file, array $rows): void
{
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
    $lines = array_map(static fn ($r): string => json_encode($r, $flags), $rows);
    file_put_contents($file, "[\n" . implode(",\n", $lines) . "\n]\n");
}

writeJsonLines($outDir . '/lexer.json', $lexerFixtures);
writeJsonLines($outDir . '/parser.json', $parserFixtures);
writeJsonLines($outDir . '/split.json', $splitFixtures);
writeJsonLines($outDir . '/lint.json', $lintFixtures);
writeJsonLines($outDir . '/first-statement.json', $firstStatementFixtures);
writeJsonLines($outDir . '/buffered-query.json', $bqCases);
file_put_contents(
    $outDir . '/contexts.json',
    json_encode(
        ['loadClosest' => $loadClosest, 'hashes' => $contextHashes, 'words' => $words, 'isKeyword' => $isKeyword, 'modes' => $modeResults, 'escapeInputs' => $escapeInputs],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
    ) . "\n",
);

printf(
    "lexer: %d, parser: %d, split: %d, lint: %d, first-statement: %d, buffered-query: %d, contexts: %d\n",
    count($lexerFixtures),
    count($parserFixtures),
    count($splitFixtures),
    count($lintFixtures),
    count($firstStatementFixtures),
    count($bqCases),
    count($contextHashes),
);
