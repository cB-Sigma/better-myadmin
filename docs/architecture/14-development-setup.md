# Development setup

## Prerequisites

- Node.js 22 LTS (or Bun 1.2+), pnpm 9 (`corepack enable`).
- Docker (for MySQL/MariaDB, the reference phpMyAdmin, and parity tests).
- Git.

## First run

```bash
git clone <repo> bettermyadmin && cd bettermyadmin
pnpm install
docker compose -f docker/dev.compose.yml up -d        # mysql84, mariadb11, phpmyadmin-ref, redis (optional)
pnpm db:seed                                           # loads sakila, world, pma-edge and pmadb tables into both servers
cp bettermyadmin.config.example.ts bettermyadmin.config.ts
pnpm dev                                               # turbo: server on :8080 (API + proxies to Vite), web on :5173 with HMR
```

Open `http://localhost:5173`. Log in with `root` / `root` (dev containers only). The reference phpMyAdmin is on `http://localhost:8081` for side-by-side comparison.

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
| Integration tests (needs Docker) | `pnpm test:int` (`MATRIX=mysql84` to pick one) |
| Golden parity tests | `pnpm test:parity` (brings up the reference phpMyAdmin) |
| Refresh golden files from phpMyAdmin | `pnpm golden:refresh` then review the diff |
| E2E | `pnpm test:e2e` (`--ui` for the Playwright inspector) |
| Update checklists from test results | `pnpm parity:report` |
| Regenerate reference docs | `pnpm docs:gen` (config directive table, route map, parity exceptions index) |
| Import a locale | `pnpm i18n:import --locale de` (reads phpMyAdmin's `.po` from `vendor/phpmyadmin-po` submodule) |
| Check string parity | `pnpm i18n:parity` |
| Storybook for `packages/ui` and composites | `pnpm storybook` |
| Build everything | `pnpm build` |
| Run the production build locally | `node apps/server/dist/main.js --config ./bettermyadmin.config.ts` |
| Build Bun binary | `pnpm build:binary` |
| Build Docker image | `docker build -t bettermyadmin .` |

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

## Directory for generated/runtime data

`.data/` (git-ignored): SQLite session store, local metadata fallback, upload/save dirs, generated secret in non-dev runs.
