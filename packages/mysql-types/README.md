# @bettermyadmin/mysql-types

A port of phpMyAdmin's type catalog. Everything here is pure and has no dependencies. Each function's doc comment names the phpMyAdmin source it mirrors (`pma: src/Types.php::getColumns`).

| Module | phpMyAdmin source | Exports |
|---|---|---|
| `server.ts` | `Query/Compatibility.php`, `Util::getServerType` | `ServerInfo {vendor, version}`, `parseServerVersion`, every `Compatibility::*` check (`isJsonSupported`, `isUUIDSupported`, `isIntegersSupportLength`, `isVirtualColumnsSupported`, ...) |
| `types.ts` | `Types.php`, `TypeClass.php` | `getColumns` (dropdown groups), `getTypeDescription`, `getTypeClass`, `getTypeOperators` (+ text/number/enum/UUID operator lists), `isUnaryOperator`, `getFunctionsClass`, `getAllFunctions`, `getAttributes`, `getIntegerTypes`, `getIntegerRange`, `mapAliasToMysqlType` |
| `util.ts` | `Util.php`, `Html/Generator::getSupportedDatatypes` | `getSupportedDatatypes`, `getDatatypeOptions`, `extractColumnSpec`, `parseEnumSetValues`, `printableBitValue`, `convertBitDefaultValue`, `unQuote`, `unquoteDefaultValue`, `getCharsetQueryPart`, `addMicroseconds`, and the length, values and collation rules |
| `functions.ts` | `Html/Generator::getDefaultFunctionForField`, `::getFunctionsForField`, `InsertEdit::isColumnBinary` | `DEFAULT_FUNCTIONS`, `getDefaultFunctionForField`, `getFunctionsForField`, `getFunctionCellKind`, `FUNC_NO_PARAM`, GIS function lists |
| `field-metadata.ts` | `FieldMetadata.php` | `createFieldMetadata` (protocol type and flags become a mapped type, `isNumeric`, `isBinary`, ...), `MysqlType`, `MysqlFlag` |
| `column-form.ts` | column form templates | default-type, virtuality and index-type options |
| `php` namespace | PHP built-ins | `strGetCsv`, `mbStrlen`, `intCast`, loose comparisons, `htmlspecialchars`: just enough for byte-identical output |

Translatable strings are returned untranslated. Every function that produces UI text takes an optional `t(msgid)` hook.

## Verification

The fixtures in `test/fixtures/*.json` come from running the real phpMyAdmin code at the reference commit, for 30 (vendor, version) combinations:

```sh
php packages/mysql-types/scripts/generate-fixtures.php   # PMA_PATH=/home/user/ref/pma by default
pnpm vitest run --project unit packages/mysql-types
```

`scripts/pma-bootstrap.php` is shared with `@bettermyadmin/sql-gen`. It loads phpMyAdmin with a `DbiDummy` driver whose `quoteString` uses a real mysqli connection when one is reachable (`BMA_MYSQL_HOST`/`PORT`/`USER`/`PASSWORD`).
