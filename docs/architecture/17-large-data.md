# Large data

How BetterMyAdmin behaves with large tables, files and values, measured against phpMyAdmin on the same server, and the rules that keep the server process small. Regression tests at a test-sized scale: `apps/server/test/int/large-data.test.ts`, `packages/import/test/large.test.ts`, `packages/export/test/output.test.ts`, `apps/server/test/unit/large-data.test.ts`.

## Rules

- **Results are paged, never held whole.** Browse, sort and search add `LIMIT` (`MaxRows`) like phpMyAdmin; a page holds at most `MaxRows` rows of the result. The raw values of a grid page are sent only for the cells the grid editor reads whole: a truncated or transformed cell loads its full value when edited (makegrid's `SELECT col … WHERE …`, `gridValue`), a BLOB cell is not grid-editable (`query/raw-cells.ts`). The page's text is cut at `LimitChars` and a BLOB shows `[BLOB - n KiB]`, as phpMyAdmin's page does.
- **Exports stream.** The data SELECT is unbuffered and read from the socket as the dump is written (`export/dbi.ts`); uncompressed output goes to the response in 64 KiB writes (`OutputHandler`), gzip in chunks of `Export::getMemoryLimit()`. Nothing is buffered beyond one chunk: zip, and "export as separate files", are built in memory, as in phpMyAdmin.
- **Imports read from disk.** An upload arrives in 4 MiB chunks appended to a file (`POST/PATCH …/import/uploads`); the import reads it like phpMyAdmin's `fopen`/`fread`, chunk by chunk: an uncompressed file with positioned reads, a gzip or bzip2 file through a decompressed temporary copy (Node has no synchronous streaming gunzip, and the import plugins read synchronously; the copy is removed when the import ends), a zip whole (ZipExtension::getContents does the same) (`ImportFile.open`).
- **The import's limits are phpMyAdmin's.** `MemoryLimit` sets the read size (an eighth of it; 10 MB chunks for `-1`, 2 MB for `0`), `ExecTimeLimit` with "Allow interruption" stops the import 5 seconds before `ExecTimeLimit - 1` and answers phpMyAdmin's "Script timeout passed … resubmit the same file" with the link back to the import page (`timeout_passed`, `offset`); resubmitting posts `skip=offset` and the import continues where it stopped. Uploads past `MaxUploadSize` are refused per chunk with phpMyAdmin's "You probably tried to upload a file that is too large"; on Insert/Edit, a file past it is dropped like an `UPLOAD_ERR_INI_SIZE` file, and a request whose `Content-Length` exceeds `MaxUploadSize` (base64) plus 1 MiB is refused like one over `post_max_size`.
- **Statements are not kept.** Without `DBG/sql` the request's statement log keeps nothing (`db/statement-log.ts`): an import would otherwise hold the text of every statement it ran. The SQL shown back (the message card, an error) is cut at `MaxCharactersInDisplayedSQL` with `[...]`, as `Generator::formatSql` does: an inserted 25 MB BLOB is a 50 MB statement.
- **No character arrays.** `mb_strlen` / `mb_substr` semantics come from `util/mb.ts` and `mysql-types`' `mbStrlen`, which count code points without `Array.from`: the array of a 50 MB literal holds 100 million strings.

Not bounded, as in phpMyAdmin: the whole BLOB of an Insert/Edit upload (the statement carries its hex literal; above `max_allowed_packet` MySQL refuses it), a zip import or export, the "View output as text" of an export (the browser holds the text).

## Measurements

mysql84 (MySQL 8.4, `max_allowed_packet` 64 MB), one database `f07_big` with `mixed` (2,000,000 rows of INT, BIGINT, DECIMAL, DOUBLE, VARCHAR, TEXT, DATETIME, DATE, ENUM, TINYINT; 517 MB with indexes) and `blobs` (200 rows of a 512 KiB BLOB and a 500 KB LONGTEXT), and `f07_many` with 5,000 tables. phpMyAdmin (reference checkout, `php -S` with one worker, `upload_max_filesize`/`post_max_size` 1G, `memory_limit` -1) against BetterMyAdmin's production server (`node apps/server/bin/bettermyadmin.mjs`), both on the same 4-core host, cookie login as root. Memory is the server process's peak resident set (`VmHWM`, reset before each scenario) minus its resident set before it; a fresh BetterMyAdmin process starts at about 150–220 MB (Node and the compiled sources), `php -S` at about 50 MB. Times are wall clock of the request, the download read to the end.

| Scenario | phpMyAdmin | BetterMyAdmin before | BetterMyAdmin now |
|---|---|---|---|
| Browse `mixed` (2M rows), first page | 0.2 s, +3 MB | 0.2 s, +2 MB | 0.3 s, +4 MB |
| Sort `mixed` by an unindexed column (filesort) | 3.3 s, +0 MB | 2.9 s, +0 MB | 3.9 s, +1 MB |
| Search `mixed` (`LIKE '%…%'`, full scan) | 3.6 s, +0 MB | 3.3 s, +2 MB | 3.1 s, +0 MB |
| Browse `blobs`, 25 rows of 1 MB | 0.6 s, +27 MB | 1.8 s, +198 MB (30 MB response) | 1.2 s, +140 MB (200 KB response) |
| Database Structure, 5,000 tables (`MaxTableList` 250 per page) | 0.6 s, +10 MB | 0.5 s, +1 MB | 0.9 s, +0 MB |
| Navigation: expand the database / the Tables node (`MaxNavigationItems` 50) | 0.2 s / 0.1 s, +0 MB | 0.2 s / 0.1 s, +0 MB | 0.1 s / 0.1 s, +1 MB |
| SQL export of `mixed`, 383 MB, uncompressed | 18.7 s, +730 MB | 61.4 s, +10 MB | 31.6–36.7 s, +36 MB |
| SQL export of `mixed`, gzip | 42.3 s, +542 MB (284 MB: one gzip member per flush) | 46.2 s, +169 MB | 48.6 s, +131 MB (115 MB) |
| Import a 500 MB SQL file (2,103 statements, 2,102,000 rows) | 127 s, +490 MB | 78 s, +1,149 MB, kept after | 72 s, +114 MB |
| Import the same file gzip'd (83 MB) | 137 s, +93 MB | 106 s, +148 MB | 84 s, +34 MB |
| Import 100 MB with `ExecTimeLimit` 10 s, resumed until done | 6 runs, 34 s; every row once | never interrupted (no time limit) | 5 runs, 37 s; every row once |
| Insert/Edit, 25 MB BLOB upload | 8–10 s, +1,000 MB | 3.7 s, +523 MB (100 MB response) | 2.6 s, +297 MB (2 KB response) |
| Insert/Edit, 50 MB BLOB (above `max_allowed_packet` as hex) | 31–38 s, +1,050–1,860 MB, not stored (one HTTP 500) | 2.9 s, +491 MB, "Got a packet bigger than 'max_allowed_packet' bytes" (100 MB response) | 3.1–3.9 s, +300–370 MB, the same error (1 KB response) |

The import memory "before" grew by the size of the file: the file was read whole into memory, and every executed statement (240 KB each) stayed in the request's statement log. The BLOB-table browse still costs about five times phpMyAdmin's memory: mysql2's buffered page (25 MB) and the decoded cell strings; it is bounded by the page (`MaxRows` × row size), not by the table.

## Fixes

| Problem | Fix | Test |
|---|---|---|
| A browse page sent every raw value (BLOBs base64, full TEXT) besides the grid: a 25-row page of 1 MB rows was a 30 MB response, rendered by the browser | the raw values of truncated, transformed and non-editable cells are not encoded (`unreadRawCells`) | `large-data.test.ts` Browse; unit `unreadRawCells` |
| The import read the uploaded file whole (and gunzipped it whole) | `ImportFile.open`: positioned reads, gzip/bzip2 through a temporary file | `packages/import/test/large.test.ts` |
| The request's statement log kept every statement of an import | no statement log without `DBG/sql` | unit `statementLog` |
| `ExecTimeLimit` did not interrupt an import, so there was no resume | `Import::checkTimeout` ported (`maximumTime`, the 5-second margin), the timeout message links to the import page with `timeout_passed` and `offset` | `large-data.test.ts` import [p07-89e7c9 p07-5a8804] |
| `MemoryLimit` did not set the import's read size | `ImportSettings::$readLimit` from `MemoryLimit` | — (`-1`, the default, gives the same 1.25 MB chunks as before) |
| An uncompressed export wrote to the response once per SQL line (2M awaited writes) | 64 KiB writes | `packages/export/test/output.test.ts` |
| A saved row's message and `sqlQuery` carried the whole statement (an uploaded BLOB's hex, twice), and the SQL editor highlighted it | cut at `MaxCharactersInDisplayedSQL` like `Generator::getMessage`; the same for a thrown MySQL error's SQL (`Generator::mysqlDie`) | `large-data.test.ts` Insert/Edit |
| Character counts of statements and cells built arrays (`Array.from`) | `util/mb.ts` | unit `mb helpers` |
| Insert/Edit uploads ignored `MaxUploadSize` | the upload is dropped past it (`UPLOAD_ERR_INI_SIZE`), the request refused past it by `Content-Length` (`post_max_size`) | `large-data.test.ts` uploads |

The full-size runs are reproduced with a driver that is not part of the repository (it needs a private phpMyAdmin instance and ~6 GB of disk for the binary log of the imports); the numbers above are from 2026-10-18 at the reference commit.
