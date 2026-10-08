# @bettermyadmin/sql-gen

These are pure SQL builders that return strings and generate the same SQL phpMyAdmin generates. The package never imports `mysql2`. Each builder's doc comment names the phpMyAdmin function it mirrors.

| Module | phpMyAdmin source | Exports |
|---|---|---|
| `quote.ts` | `Util::backquote`, `DatabaseInterface::quoteString`, mysqlnd `escape_slashes`/`escape_quotes` | `backquote` (also accepts arrays), `backquoteCompat`, `escapeString`, `quoteString`, `hexLiteral`, `bitLiteral`, `NULL`, `escapeMysqlWildcards` |
| `where.ts` | `UniqueCondition.php`, `InsertEdit::isWhereClauseNumeric` | `getUniqueCondition(fields, row, {forceUnique, restrictToTable, expressions, isView, quote})` returns `{condition, isClauseUnique, conditionArray}` |
| `column.ts` | `Table::generateFieldSpec`, `::generateAlter`, `CreateAddField` | `generateFieldSpec`, `generateAlter`, `getTableCreationQuery`, `getColumnCreationQuery`, `getPartitionsDefinition` |
| `dml.ts` | `InsertEdit` value formatting, `ReplaceController`, `Query\Generator::buildInsertSqlQuery`, `Results` / `DeleteRowsController` | `getQueryValueForInsert`, `getQueryValueForUpdate`, `buildInsertEditQueries`, `buildProtectedValueQuery`, `uploadedEditField`, `buildDeleteRowQuery`, `buildDeleteRowsQueries` |

## Values and charsets

- Cell values are `string | null | Uint8Array` and are never parsed. A numeric value is emitted exactly as the server sent it.
- In `getUniqueCondition`, a `Uint8Array` for a BIT column holds the raw big-endian bit bytes that mysql2 returns. A string holds the decimal text that mysqli returns. Both produce the same `= b'0101'`.
- `escapeString` and `quoteString` take the connection charset through `{charset}`. For `utf8mb4`, `utf8`, `latin1` and `binary`, escaping works byte by byte on `\0 \n \r \\ ' " \x1a`. The multibyte charsets big5, cp932, sjis, gbk, gb18030, gb2312, euckr, ujis and eucjpms copy valid multibyte sequences unescaped and escape lone lead bytes, exactly like mysqlnd. With those charsets, pass a `Uint8Array` that is already encoded in the charset, because a JS string always stands for its UTF-8 bytes. `{noBackslashEscapes: true}` doubles quotes only, which matches the `NO_BACKSLASH_ESCAPES` sql_mode.
- Side effects that phpMyAdmin performs while building values are injected by the caller: `ctx.uuid()` stands for `SELECT UUID()`, `ctx.passwordHash()` stands for PHP `password_hash`, and `protectedValue` is the result of `buildProtectedValueQuery`.

## Verification

```sh
php packages/sql-gen/scripts/generate-fixtures.php   # needs PMA_PATH and, ideally, a MySQL server for escaping
pnpm vitest run --project unit packages/sql-gen
```

The fixtures come from running phpMyAdmin: `UniqueCondition`, `Table::generateFieldSpec`/`generateAlter`, `CreateAddField`, `InsertEdit::getQueryValueForInsert`/`ForUpdate`, and mysqli `real_escape_string` against a live server for each charset. They include the inputs of `UniqueConditionTest`, `TableTest`, `CreateAddFieldTest` and `InsertEditTest`, and the PHPUnit expected strings are cross-checked against them.
