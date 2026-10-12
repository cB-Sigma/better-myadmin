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

## Sharing one MySQL between worktrees (agents, CI jobs)

Several checkouts may run suites against the same server at once. Three mechanisms keep them apart:

- **General log** (`mysql.general_log`, read by `tests/parity/lib/general-log.ts`): the dev compose servers create it as **MyISAM with an `event_time` index** (`docker/seed/00-general-log.sql`); on an existing server the first `GeneralLog.open()` that finds no other reader converts it. A read costs its time window, not the whole log (with the default CSV engine every `since()` scanned it: ~90 s at 887k rows).
- **Rotation**: `GeneralLog.open()` truncates the log when it holds more than 100k rows (`BMA_GENERAL_LOG_ROTATE_AT`) **and no suite holds a marker**. Every reader registers a holder file (pid) in `.data/general-log-holders/` of the main checkout (shared by all its worktrees; `BMA_LOG_HOLDERS_DIR` overrides), removed at close or process exit; files of dead processes are ignored. Registration and rotation run under the `general-log-holders.lock` mutex.
- **Fixtures**: UI parity accounts and databases carry a per-worktree suffix (`uip_pma_<run>`, `uip_db_<run>`, `uip_pmadb_<run>`, `uip_ie_<run>`; `tests/ui-parity/lib/env.ts`, `BMA_UIP_RUN`) and are dropped by its global-teardown. Parity suites keep their fixed fixtures (`m1meta_*`, `m3srv_*`, `f03_*` …) but take a server-wide `GET_LOCK('bma_parity:<suite>')` for the whole file (`tests/parity/lib/suite-lock.ts`; the server-* suites share one group), so the same suite started from two worktrees runs one after the other (`BMA_PARITY_LOCK_WAIT`, default 30 min).

## The dev replica (Server › Replication, logging variables of the monitor)

`tests/parity/server-replication.parity.test.ts` and the logging-variable cases of `server-monitor` need a live replica and a reference phpMyAdmin whose only server it is; they skip themselves without them.

- Compose: `mysql84-replica` (:3308, server-id 2, no binary log) replicates `mysql84` from its position at creation time as `bma_repl` (`docker/seed/02-replication-user.sql`, `docker/seed/replica/10-replica.sh`). It applies only the `f06r_repl` database and skips every error (`--replica-skip-errors=all`): the other suites' statements on the shared primary are parsed by the replica before its database filter applies and would otherwise stop the SQL thread. `phpmyadmin-ref-replica` (:8083, `PMA_REPLICA=1`: no configuration storage, `AllowArbitraryServer` on) is the reference for it.
- Without Docker for the reference (a local checkout on :8081): start the replica container with host networking (`--network host … --port=3308 --report-host=127.0.0.1 --replicate-do-db=f06r_repl --replica-skip-errors=all --skip-log-bin`, `REPLICA_SOURCE_HOST=127.0.0.1`) and the second reference instance with `docker/pma-ref/local-replica.sh` (a symlink copy of the checkout with its own `config.inc.php`, so the :8081 instance is untouched).
- Overrides: `BMA_PARITY_REPLICA_HOST` / `_PORT` (the replica's MySQL), `BMA_PARITY_REPLICA_PMA_URL`, `BMA_PARITY_REPLICA_SOURCE_HOST` / `_PORT` (the primary as both the reference and the replica reach it, entered in "Change or reconfigure primary server"; with compose networking use `mysql84`).
- The suites never change replication or logging variables on the shared primary: every START/STOP/RESET/CHANGE and SET GLOBAL runs on the replica, which the suite points back at the primary (`restoreReplica`) when it ends.

## Directory for generated/runtime data

`.data/` (git-ignored): SQLite session store, local metadata fallback, upload/save dirs, generated secret in non-dev runs.
