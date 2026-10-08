<?php
/**
 * Differential fuzzing helper (not part of the test suite): mutates the corpus queries and dumps the PHP
 * results as JSON lines; compare with `node --experimental-strip-types scripts/fuzz-diff.ts out.jsonl`.
 *
 * Usage: php scripts/fuzz-diff.php prefix|drop|mutate [seed] > out.jsonl
 */
declare(strict_types=1);
use PhpMyAdmin\SqlParser\Context;
use PhpMyAdmin\SqlParser\Lexer;
use PhpMyAdmin\SqlParser\Parser;
use PhpMyAdmin\SqlParser\Utils\Query;
$pmaRoot = getenv('PMA_ROOT') ?: '/home/user/ref/pma';
$sqlParserRoot = getenv('SQL_PARSER_ROOT') ?: '/home/user/ref/sql-parser';
require $pmaRoot . '/vendor/autoload.php';
PhpMyAdmin\SqlParser\Translator::setLocale('en');
set_error_handler(static fn (): bool => true);
ini_set('memory_limit', '4G');
$mode = $argv[1] ?? 'prefix';
$queries = [];
foreach (['parser','bugs','misc','lexer'] as $d) foreach (glob("$sqlParserRoot/tests/data/$d/*.in") as $f) { $q = file_get_contents($f); if (mb_check_encoding($q,'UTF-8')) $queries[] = $q; }
foreach (require __DIR__ . '/extra-cases.php' as $e) if (!isset($e[2])) $queries[] = $e[1];
$inputs = [];
foreach ($queries as $q) {
  $chars = mb_str_split($q);
  $n = count($chars);
  if ($mode === 'prefix') {
    $step = $n < 300 ? 1 : ($n < 2000 ? 4 : 50);
    for ($i = 1; $i < $n; $i += $step) $inputs[] = implode('', array_slice($chars, 0, $i));
  } elseif ($mode === 'mutate') {
    // handled below
  } else {
    // drop one token-ish chunk: remove each word
    $words = preg_split('/(\s+)/u', $q, -1, PREG_SPLIT_DELIM_CAPTURE);
    $wc = count($words);
    if ($wc > 200) continue;
    for ($i = 0; $i < $wc; $i += 2) { $w = $words; unset($w[$i]); $inputs[] = implode('', $w); }
  }
}
if ($mode === 'mutate') {
  mt_srand((int) ($argv[2] ?? 1));
  $pool = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'LIMIT', 'UNION', 'JOIN', 'ON', 'AS', 'INTO', 'SET', 'VALUES',
    'CASE', 'WHEN', 'END', 'BEGIN', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'INSERT', 'UPDATE', 'DELETE', 'PARTITION', 'BY',
    '(', ')', ',', ';', "'", '"', '`', '/*', '*/', '-- ', '#', "\n", '@', '@@', ':', '?', '.', '*', '=', 'DELIMITER $$ ', '$$',
    '1', '0x1F', '1e5', "b'1'", 'NULL', 'NOT', 'AND', 'OR', 'IN', 'EXISTS', 'COUNT(*)', 'SUM(a)', 'DISTINCT', 'WITH', 'RECURSIVE',
    'INDEX', 'KEY', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'DEFAULT', 'COLLATE', 'CHARACTER SET', 'ENGINE', '=', 'OUTFILE',
    'PROCEDURE', 'FUNCTION', 'RETURNS', 'TRIGGER', 'VIEW', 'EXPLAIN', 'SHOW', 'KILL', 'LOCK', 'TABLES', 'READ', 'WRITE', 'é', '😀'];
  $qs = array_values(array_filter($queries, static fn ($q) => mb_strlen($q) < 600));
  for ($k = 0; $k < 20000; $k++) {
    $q = $qs[mt_rand(0, count($qs) - 1)];
    $chars = mb_str_split($q);
    $ops = mt_rand(1, 3);
    for ($o = 0; $o < $ops; $o++) {
      $n = count($chars);
      $pos = mt_rand(0, max(0, $n));
      $r = mt_rand(0, 2);
      if ($r === 0) {
        $ins = mb_str_split(' ' . $pool[mt_rand(0, count($pool) - 1)] . ' ');
        array_splice($chars, $pos, 0, $ins);
      } elseif ($r === 1 && $n > 0) {
        array_splice($chars, $pos, mt_rand(1, 8));
      } else {
        $len = mt_rand(1, 12);
        array_splice($chars, $pos, 0, array_slice($chars, max(0, $pos - $len), $len));
      }
    }
    $inputs[] = implode('', $chars);
  }
}
$inputs = array_values(array_unique($inputs));
$out = fopen('php://stdout','w');
function enc($v) { if (is_string($v)) return mb_check_encoding($v,'UTF-8') ? $v : ['b'=>bin2hex($v)]; if (is_float($v) && !is_finite($v)) return ['f'=>(string)$v]; return $v; }
foreach ($inputs as $q) {
  try {
    $lexer = new Lexer($q);
    $types = [];
    foreach ($lexer->list->tokens as $t) $types[] = $t->type->value . ':' . $t->flags . ':' . $t->position . ':' . mb_strlen($t->token);
    $parser = new Parser($lexer->list);
    $sts = [];
    foreach ($parser->statements as $s) { try { $b = $s->build(); } catch (Throwable $e) { $b = ['exception'=>true]; } $sts[] = [(new ReflectionClass($s))->getShortName(), $s->first, $s->last, enc($b)]; }
    $errs = [];
    foreach ($parser->errors as $e) $errs[] = [$e->getMessage(), enc($e->token?->token), $e->token?->position];
    $lerrs = [];
    foreach ($lexer->errors as $e) $lerrs[] = [$e->getMessage(), enc($e->ch), $e->pos];
    $info = Query::getAll($q);
    $flags = [];
    foreach (get_object_vars($info->flags) as $k => $v) if ($v === true) $flags[] = $k;
    sort($flags);
    $row = ['q'=>$q, 't'=>implode(',', $types), 'le'=>$lerrs, 's'=>$sts, 'e'=>$errs, 'f'=>$flags, 'qt'=>$info->flags->queryType?->value, 'st'=>$info->selectTables, 'se'=>array_map('enc', $info->selectExpressions)];
    if ($parser->statements !== []) {
      $s0 = $parser->statements[0];
      $row['c'] = [];
      foreach (['SELECT','FROM','WHERE','ORDER BY','LIMIT'] as $c) { try { $row['c'][] = Query::getClause($s0, $parser->list, $c); } catch (Throwable $e) { $row['c'][] = ['exception'=>true]; } }
      try { $row['r'] = Query::replaceClause($s0, $parser->list, 'LIMIT 0, 25'); } catch (Throwable $e) { $row['r'] = ['exception'=>true]; }
      try { $row['tb'] = Query::getTables($s0); } catch (Throwable $e) { $row['tb'] = ['exception'=>true]; }
    }
  } catch (Throwable $e) {
    $row = ['q'=>$q, 'php'=>get_class($e).': '.$e->getMessage()];
  }
  fwrite($out, json_encode($row, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
}
