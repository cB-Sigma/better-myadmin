# Development setup

## Prerequisites

- Node.js 22 LTS (or Bun 1.2+), pnpm 9 (`corepack enable`).
- Docker (for MySQL/MariaDB, the reference phpMyAdmin, and parity tests).
- Git.

## First run

```bash
git clone <repo> bettermyadmin && cd bettermyadmin
pnpm install
docker compose -f docker/dev.compose.yml up -d          # mysql84 (:3306), mariadb11 (:3307), phpmyadmin-ref (:8081)
pnpm --filter @bettermyadmin/web dev                    # web on :5173 with HMR, proxies /api to :8080
BMA_HOST=127.0.0.1 pnpm --filter @bettermyadmin/server dev   # API on :8080
```

Open `http://localhost:5173` and log in with `root` / `root` (dev containers only). The reference phpMyAdmin (built from the commit in `docs/reference/reference-commit.txt`) is on `http://localhost:8081` for side-by-side comparison.

Without a config file the server uses phpMyAdmin's defaults plus environment overrides, generates `blowfish_secret` into `DataDir` (`~/.bettermyadmin`), and serves the built SPA from `apps/web/dist` when present.

Without Docker, the reference phpMyAdmin also runs from a checkout with `composer install --prefer-source && yarn install` and `php -S 127.0.0.1:8081 -t public` (PHP 8.2+ with `mysqli`).

## Dev config

`bettermyadmin.config.ts` (TypeScript for autocomplete over every directive):

```ts
import { defineConfig } from '@bettermyadmin/config'

export default defineConfig({
  blowfish_secret: 'dev-only-secret-change-me-32-bytes!!',
  Servers: [
    { host: 'mysql84', port: 3306, auth_type: 'cookie', verbose: 'MySQL 8.4 (dev)',
      controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' },
    { host: 'mariadb11', port: 3306, auth_type: 'cookie', verbose: 'MariaDB 11 (dev)' },
  ],
  UploadDir: './.data/upload', SaveDir: './.data/save',
  DBG: { sql: true },         // enables the Console "Debug SQL" tab
})
```

Environment variables override: `BMA__Servers__1__host=127.0.0.1 pnpm dev`.

## Common tasks

| Task | Command |
|---|---|
| Typecheck everything | `pnpm typecheck` |
| Lint and format | `pnpm lint` / `pnpm format` |
| Unit + contract tests | `pnpm test` |
| Integration tests (MySQL on :3306, `BMA_TEST_*` env to override) | `pnpm test:int` |
| Golden parity tests (needs the reference phpMyAdmin, `BMA_PARITY_PMA_URL`) | `pnpm test:parity` |
| Regenerate PHP-derived fixtures | `php packages/<pkg>/scripts/*.php` (each package README lists its scripts) |
| Build the SPA | `pnpm --filter @bettermyadmin/web build` |
| End-to-end tests (every Playwright suite in `tests/e2e`: shell, navigation, SQL editor/console, language; builds the SPA first; `PW_CHROMIUM` for a local Chromium) | `pnpm test:e2e` |
| Catalogue import / msgid check | `pnpm i18n:import`, `pnpm i18n:parity` |
| Run the server | `pnpm --filter @bettermyadmin/server start -- --config ./bettermyadmin.config.ts` |

Planned and not yet wired: `pnpm parity:report`, `pnpm docs:gen`, `pnpm storybook`, `pnpm build:binary`.

## Working on a feature

1. Open the feature doc section (e.g. `docs/features/04-table-level.md#operations-tab`). Read the Micro-behaviours checklist items you are implementing.
2. Find the mirrored phpMyAdmin source (cited in the doc). Keep the phpMyAdmin repo checked out next to this one (`../phpmyadmin`, pinned to the reference commit in `docs/reference/reference-commit.txt`) and read the actual code when the doc is ambiguous.
3. Server first: add/extend the Zod contract in `packages/contracts`, the builder in `packages/sql-gen` (with golden fixture), the route handler. Run `pnpm test:parity -- --grep "operations"`.
4. Client: feature folder component, route wiring, i18n msgids identical to phpMyAdmin's.
5. Add e2e tests whose titles are the checklist lines. Run `pnpm parity:report` to tick them.
6. PR template: link the checklist items, note any `allowed-diffs.yaml` additions with justification.

## Debugging tips

- Console → **Debug SQL** tab lists every statement the server ran for the last request with timing and the `label` from `conn.query`.
- `DEBUG=bma:*` enables verbose server logging (pino pretty in dev).
- Query devtools (TanStack) and Router devtools are mounted in dev builds (toggle with `Ctrl+Alt+Q` / `Ctrl+Alt+R`).
- `pnpm compare <url-path>` opens the same page in BetterMyAdmin and the reference phpMyAdmin side by side in the browser.
- To inspect what phpMyAdmin ran for an action: `docker compose exec mysql84 mysql -e "SELECT argument FROM mysql.general_log ORDER BY event_time DESC LIMIT 20"`.

## CI (`.github/workflows/ci.yml`, `nightly.yml`)

Runs on pushes to `main` and `claude/**`, on pull requests and by hand (`workflow_dispatch`). The `integration` matrix starts each database with `docker run` and the dev seeds (general log as a table, 1000 connections, binary log on MariaDB, pmadb `phpmyadmin` with control user pma/pmapass): a `services:` container takes neither server options nor the checkout's seeds. The `parity` matrix provisions PHP 8.3 (setup-php, with mbstring/iconv for `export-kanji`'s mbstring goldens) and copies the reference checkout out of the built `phpmyadmin-ref` image to the runner (`PMA_PATH`, `BMA_PARITY_PMA_ROOT`), so the suites that start their own phpMyAdmin (`pma-instance.ts`, `pma-shadow.ts`) run rather than skip on the `phpAvailable()` / `canStartShadow()` guard. The `ui-parity` leg points `BMA_PARITY_PMA_URL` at the compose reference (`:8081`, MariaDB `:8084` nightly) so its global-setup uses that instead of starting a private reference. `nightly.yml` runs the MariaDB UI-parity leg out of the PR checks.

## Sharing one MySQL between worktrees (agents, CI jobs)

Several checkouts may run suites against the same server at once. These mechanisms keep them apart:

- **General log** (`mysql.general_log`, read by `tests/parity/lib/general-log.ts`): the dev compose servers create it as **MyISAM with an `event_time` index** (`docker/seed/00-general-log.sql`); on an existing server the first `GeneralLog.open()` that finds no other reader converts it. A read costs its time window, not the whole log (with the default CSV engine every `since()` scanned it: ~90 s at 887k rows).
- **Rotation**: `GeneralLog.open()` truncates the log when it holds more than 100k rows (`BMA_GENERAL_LOG_ROTATE_AT`) **and no suite holds a marker**. Every reader registers a holder file (pid) in `.data/general-log-holders/` of the main checkout (shared by all its worktrees; `BMA_LOG_HOLDERS_DIR` overrides), removed at close or process exit; files of dead processes are ignored. Registration and rotation run under the `general-log-holders.lock` mutex.
- **Fixtures**: UI parity accounts and databases carry a per-worktree suffix (`uip_pma_<run>`, `uip_db_<run>`, `uip_pmadb_<run>`, `uip_ie_<run>`; `tests/ui-parity/lib/env.ts`, `BMA_UIP_RUN`) and are dropped by its global-teardown. Parity suites keep their fixed fixtures (`m1meta_*`, `m3srv_*`, `f03_*` …) but take a server-wide `GET_LOCK('bma_parity:<suite>')` for the whole file (`tests/parity/lib/suite-lock.ts`; the server-* suites share one group), so the same suite started from two worktrees runs one after the other (`BMA_PARITY_LOCK_WAIT`, default 30 min). Integration files do the same with `GET_LOCK('bma_int:<file>')` (`apps/server/test/support/int-suite-lock.ts`, `BMA_INT_LOCK_WAIT`): no two int files share a fixture name, so only the same file waits. The browser suites hold one lock per run (`bma_browser:e2e`, `bma_browser:ui-parity`; `tests/e2e/suite-lock.ts`). Within a run, the int and parity projects execute one file at a time (`poolOptions.forks.singleFork`; vitest ignores `fileParallelism` per project), and UI parity's workers each have their own suffix (`<run>` = `<checkout>w<worker>`).

## The dev replica (Server › Replication, logging variables of the monitor)

`tests/parity/server-replication.parity.test.ts` and the logging-variable cases of `server-monitor` need a live replica and a reference phpMyAdmin whose only server it is; they skip themselves without them.

- Compose: `mysql84-replica` (:3308, server-id 2, no binary log) replicates `mysql84` from its position at creation time as `bma_repl` (`docker/seed/02-replication-user.sql`, `docker/seed/replica/10-replica.sh`). It applies only the `f06r_repl` database and skips every error (`--replica-skip-errors=all`): the other suites' statements on the shared primary are parsed by the replica before its database filter applies and would otherwise stop the SQL thread. `phpmyadmin-ref-replica` (:8083, `PMA_REPLICA=1`: no configuration storage, `AllowArbitraryServer` on) is the reference for it.
- Without Docker for the reference (a local checkout on :8081): start the replica container with host networking (`--network host … --port=3308 --report-host=127.0.0.1 --replicate-do-db=f06r_repl --replica-skip-errors=all --skip-log-bin`, `REPLICA_SOURCE_HOST=127.0.0.1`) and the second reference instance with `docker/pma-ref/local-replica.sh` (a symlink copy of the checkout with its own `config.inc.php`, so the :8081 instance is untouched).
- Overrides: `BMA_PARITY_REPLICA_HOST` / `_PORT` (the replica's MySQL), `BMA_PARITY_REPLICA_PMA_URL`, `BMA_PARITY_REPLICA_SOURCE_HOST` / `_PORT` (the primary as the reference and the replica reach it, entered in phpMyAdmin's "Change or reconfigure primary server"; with compose networking `mysql84` / `mariadb11` and 3306, as CI sets them) and `BMA_PARITY_REPLICA_SOURCE_HOST_OURS` / `_PORT_OURS` (the same server as our app reaches it, default the target's `BMA_TEST_HOST` / `BMA_TEST_PORT`; the statements are compared with phpMyAdmin's host and port mapped to ours).
- The suites never change replication or logging variables on the shared primary: every START/STOP/RESET/CHANGE and SET GLOBAL runs on the replica, which the suite points back at the primary (`restoreReplica`) when it ends.

## MariaDB reference (`BMA_PARITY_TARGET=mariadb`) <a id="mariadb"></a>

Every parity suite also runs against MariaDB: `BMA_PARITY_TARGET=mariadb pnpm test:parity` (CI: the `mariadb` entry of the `parity` matrix). The int suite does too, with `BMA_TEST_PORT=3307 pnpm test:int`; `pnpm test:mariadb` runs both, one after the other (they share the server, and the parity suites compare server variables that the int suite's writes move). `tests/parity/lib/target.ts`, the first setup file of the parity project, only fills the variables the suites already read when they are unset:

| | `mysql` (default) | `mariadb` |
|---|---|---|
| server (`BMA_TEST_PORT`) | mysql84 :3306 | mariadb11 (MariaDB 11.4, binary log on) :3307 |
| reference (`BMA_PARITY_PMA_URL`) | :8081 | :8084 (`phpmyadmin-ref-mariadb`, its own pmadb `phpmyadmin` with control user pma/pmapass from `docker/seed/pmadb.sql`) |
| replica (`BMA_PARITY_REPLICA_PORT` / `_PMA_URL`) | mysql84-replica :3308 / :8083 | mariadb11-replica :3309 / :8085 (`docker/seed/replica/10-replica-mariadb.sh`: CHANGE MASTER TO without GTID) |
| translated reference | :8082 | none (the i18n suite skips itself) |
| Japanese (Kanji export, `export-kanji`) | :8081 if it serves `lang=ja`, else :8082 (`PMA_I18N_URL`, built with `PMA_LOCALE_STUBS=ja`), else a shadow of the local checkout with an empty `ja` catalog (`startPmaShadow(port, {}, { locales: ['ja'] })`, `tests/parity/lib/pma-shadow.ts`; the shared checkout stays English-only) | none (skips itself) |

Our app is pointed at the same server (server 1 of `testConfig`). The suite locks (`GET_LOCK`), the general-log holders and the per-run fixture names work per server, so a MySQL and a MariaDB run can go on at the same time. Suites with MySQL-only fixtures pick them by vendor (`TARGET` from `tests/parity/lib/target.ts`, or the server version); MariaDB-only behaviour of phpMyAdmin is registered as Q entries in [parity-exceptions.md](../reference/parity-exceptions.md).

First triage (all 37 suites pass on both targets): the differences were MySQL-only fixtures, made vendor-aware — `SRID 0` columns, `binlog.000001`, the Progress column of MariaDB's process list, the server's wording of syntax and unknown-column errors, `SET PASSWORD` for one's own account and `mysql_native_password` still available on MariaDB, the replica's `Slave_*` status columns, `CHANGE MASTER TO` / `SHOW BINLOG STATUS` / `SQL_SLAVE_SKIP_COUNTER`, ARCHIVE as a plugin (`docker/seed/03-mariadb-plugins.sql`) — and fixture state that only a fresh pmadb showed (the recent-tables writes depend on what `pma__recent` already holds; ties of the size and row sorts). `tests/parity/mariadb-objects.parity.test.ts` covers MariaDB-only objects (system-versioned tables, sequences).

Second triage (parity and int, both targets green): no product difference; MySQL-only fixtures again. The privileges and security-lows suites post `caching_sha2_password` / `sha256_password`, which MariaDB does not load, so on MariaDB they post `mysql_native_password` and assert phpMyAdmin's MariaDB statements (`SET old_passwords`, `CREATE USER … VIA … USING <hash>`, requirements and limits inside the `GRANT`, `SET PASSWORD FOR … = PASSWORD()`). MariaDB keeps the grant tables in Aria, whose row order follows the slots dropped accounts freed, so that suite compacts them (`OPTIMIZE TABLE`) after its drops: Copy user reads `mysql.db` unordered in both tools. The import suite normalises the server's answer to a server-side `LOAD DATA INFILE` of the uploaded file, which depends on whether the path exists in the server's container (#13 for phpMyAdmin's `/tmp/phpXXXX`, #1290 for ours). The int suite reads the vendor once (`apps/server/test/support/vendor.ts`: `int(11)`, the default utf8mb4 collation, no `performance_schema`) and asserts phpMyAdmin's MariaDB behaviour where it differs: the password form offers only Native MySQL authentication and runs `SET password = PASSWORD()`, `int(10) unsigned` gets the integer range, MariaDB's lowercase `on update current_timestamp()` gives no attribute, navigation column defaults come quoted from `COLUMN_DEFAULT`, the MariaDB knowledge base links, 55 advisor rules. Only the SQL tab's `INNODB_TRX` rollback probe is skipped there (MariaDB evaluates `@@foreign_key_checks` as 0 in it on any session).

Locally without Docker for phpMyAdmin: start the containers with host networking (`docker run --network host mariadb:11.4 --port=3307 --server-id=11 --log-bin=mariadb-bin --general-log=1 --log-output=TABLE` with the three seeds; the replica with `--port=3309 --replicate-do-db=f06r_repl --slave-skip-errors=all` and `REPLICA_SOURCE_HOST=127.0.0.1 REPLICA_SOURCE_PORT=3307`) and the references with `docker/pma-ref/local-instance.sh /home/user/ref/pma-mariadb 8084 3307 pmadb` and `… /home/user/ref/pma-mariadb-replica 8085 3309 replica`.

## Directory for generated/runtime data

`.data/` (git-ignored): SQLite session store, local metadata fallback, upload/save dirs, generated secret in non-dev runs.
