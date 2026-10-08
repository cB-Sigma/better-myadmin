# @bettermyadmin/sql-lexer

Dependency-free, browser-safe TypeScript port of [phpmyadmin/sql-parser](https://github.com/phpmyadmin/sql-parser)
**6.0.0** (the version phpMyAdmin pins) plus the phpMyAdmin helpers built on it (decision D7). It gives the
same results as the PHP code: same tokens, same statements, same errors, same `StatementFlags`.

Every ported file/function carries a `// pma: <php file>::<symbol>` pointer to the mirrored source.

## API

```ts
import {
  Lexer, Parser, Context, createServerContext,
  getAll, parseAnalyze, getClause, replaceClause, replaceClauses, getTables, getFirstStatement,
  splitSql, splitSqlQueriesToExecute, lint,
} from '@bettermyadmin/sql-lexer'

// Context = keyword table + SQL mode (PHP's global Context state). phpMyAdmin builds it on connect:
const ctx = createServerContext(80032, false, '@@sql_mode value') // loadClosest('MySql80032') + setMode()

new Lexer(sql, { context: ctx, delimiter: ';' }).list.tokens // Token { type, flags, token, value, keyword, position }
const parser = new Parser(sql, { context: ctx })               // .statements, .errors, .list

// Query::getAll(): { parser, statement, flags, selectTables, selectExpressions }
const info = getAll('SELECT * FROM `db`.`t` ORDER BY a', { context: ctx })
info.flags.queryType  // 'SELECT'; flags.selectFrom, order, limit, isGroup, union, join, isSubQuery, ...

// ParseAnalyze::sqlQuery(): [info, db, table, reload]
const [, db, table, reload] = parseAnalyze(sql, currentDb, isAjax)

// Utils/Query.php (statement must come from a parser whose `list` you pass)
replaceClause(info.statement!, info.parser.list!, 'LIMIT 0, 25')  // browse LIMIT injection
replaceClause(info.statement!, info.parser.list!, 'ORDER BY', '') // "unsorted" query
getClause(info.statement!, info.parser.list!, 'WHERE')

// SQL tab / SQL import splitting (BufferedQuery driven exactly like ImportSql::doImport)
splitSql(text, { delimiter: ';' })                   // ['SELECT 1', 'CREATE PROCEDURE ... END', ...]
splitSqlQueriesToExecute(text)                       // same + ';' (what Import::runQuery executes)

lint(sql) // Linter::lint(): [{ message, fromLine, fromColumn, toLine, toColumn, severity }]
```

Also exported: all statement classes (`SelectStatement`, ...; `statement.kind` is the PHP class name),
components (`Expression`, `Limit`, `OrderKeyword`, ...), component parsers, `getFlags`, `getErrors`,
`BufferedQuery`, `Context` helpers (`isKeyword`, `escape`, `setMode`, `loadClosest`, `CONTEXT_NAMES`), `SqlMode`,
`TokenType`, `TokenFlag`.

## Which splitter phpMyAdmin uses

The SQL tab posts to `/import`; `ImportSql::doImport()` reads the text through `Import::getNextChunk()` into
`PhpMyAdmin\SqlParser\Utils\BufferedQuery::extract()` (a byte-level scanner, *not* the Parser), converts lone CR to
LF, and `Import::runQuery()` executes each statement with `;` appended. Each executed query is then analysed with
`Query::getAll()` (`ParseAnalyze::sqlQuery`). `splitSql()` reproduces that loop (including chunking and the
`DELIMITER` handling); the port works on UTF-8 bytes like PHP.

## Differences from PHP

- PHP keeps the context in static state; here pass `{ context }` or set `Context.current` (`Context.run(ctx, fn)`).
- `Token.value` is `string | number | boolean`: PHP ints and floats are both `number` (only matters for integral
  float literals ≥ 1e14 converted to string). `\xNN`/octal escapes producing raw bytes become `U+00NN`.
- Where PHP throws a `TypeError` (strict_types) on malformed input, the port keeps parsing; see
  `test/known-divergences.json`. BufferedQuery's `static $i` is per instance; a trailing `DELIMITER ` without a
  value ends the split instead of looping forever.

## Keyword tables and fixtures

```sh
php packages/sql-lexer/scripts/gen-contexts.php [/path/to/sql-parser]       # src/contexts/generated/*.ts
php packages/sql-lexer/scripts/gen-fixtures.php [/path/to/pma] [/path/to/sql-parser]  # test/fixtures/*.json
pnpm vitest run --project unit packages/sql-lexer
```

Fixtures come from running the PHP implementation over the sql-parser test corpus (`tests/data/{lexer,parser,bugs,misc}`)
and `scripts/extra-cases.php`.
