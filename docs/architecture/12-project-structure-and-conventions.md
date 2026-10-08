# Project structure and conventions

## Repository layout

```
bettermyadmin/
  apps/
    web/                       React SPA (Vite)
      src/
        routes/                TanStack Router file routes (thin)
        features/              one folder per feature area (mirrors docs/features numbering)
          shell/  browse/  insert-edit/  table/  database/  server/  export-import/  settings/  sql/
        components/            cross-feature composites
        lib/                   client utils: api client, query keys, hotkeys, formatters re-exports
        workers/               sql-lint.worker.ts, csv-preview.worker.ts, json-pretty.worker.ts
        styles/                tailwind entry, theme token files
      e2e/                     Playwright specs (features/, keyboard/, perf/, a11y/, visual/)
    server/                    Hono API + static serving + CLI
      src/ (see backend doc)
      bench/
  packages/
    contracts/   sql-lexer/   sql-gen/   mysql-types/   metadata/   export/   import/   transformations/
    i18n/        ui/          config/    kbs/           testing/
  docs/                        this documentation
  tests/parity/                golden parity scripts and allowed-diffs.yaml
  docker/                      compose files for dev and parity (mysql matrix, phpmyadmin reference)
  .github/workflows/           ci.yml (lint, unit, contract), int.yml (matrix), parity.yml, e2e.yml, release.yml
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  biome.json
```

## Tooling

- **Package manager**: pnpm 9, workspace protocol for internal deps.
- **Task runner**: Turborepo (`build`, `dev`, `test`, `lint`, `typecheck`) with remote cache.
- **Lint/format**: Biome (replaces ESLint+Prettier), plus a few custom lint rules via `eslint-plugin-local` where Biome cannot express them (no physical direction Tailwind classes in `packages/ui`; no `fetch` outside `lib/api`; no `useEffect` data fetching; route files under 60 lines).
- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; project references per package.
- **Commits**: Conventional Commits; `feat(browse): ...`, scopes are feature folder names or package names. Each PR references the checklist items it completes (`Parity: browse#L120-L131`).
- **Releases**: Changesets; semver; `release.yml` builds the npm package, Docker image (multi-arch) and Bun binaries.

## Code conventions

### Naming

- Directives keep phpMyAdmin names in config (`MaxRows`), camelCase in code (`maxRows`), and the mapping is generated from `packages/config/schema.ts` so there is one source.
- Feature folders are named after the phpMyAdmin tab/page they implement; component names echo phpMyAdmin template names where sensible (`ResultHeader` ↔ `sql/sql_query_message.twig`) and the file carries a `// pma: src/Display/Results.php::getTableHeaders` comment pointing at the mirrored source. These pointers are how a reviewer checks parity quickly.

### Frontend

- Route file: `validateSearch`, `loader`, `component` only. Business logic in `features/*/hooks`.
- Data: `useQuery`/`useSuspenseQuery` with keys from `lib/queryKeys.ts`; mutations declare `invalidates` arrays.
- Components receive data, not query hooks, below the page level (keeps them testable in Storybook).
- Styling: Tailwind utilities + CSS variables; no inline style objects except for virtualizer transforms and measured widths.
- i18n: Lingui macros; never concatenate translated fragments.
- Accessibility: every interactive element is a `button`, `a`, or input; `div onClick` is banned by lint.

### Backend

- Route handlers are thin: validate (Zod from contracts) → call a service → map result to response. No SQL in handlers.
- Services are classes constructed per request with `{conn, meta, prefs, serverInfo}`; builders are pure functions.
- Every SQL string executed passes through `conn.query(sql, params, {label})` where `label` is a stable id (`browse.count`, `structure.alter`) used by the Debug SQL console and by the parity test normaliser.
- Errors: throw `BmaError` subclasses; the middleware maps to the envelope.
- Logging: pino child logger with request id; never log credentials or full result rows.

### Shared packages

- `sql-gen` exports only pure functions and never imports `mysql2`. Quoting helpers accept the connection charset as a parameter.
- `sql-lexer` must stay dependency-free and browser-safe (it runs in a worker).
- `contracts` is the only package the web app imports from the server side of the tree.

## Documentation conventions

- `docs/features/*`: behaviour, exhaustively, with source citations to phpMyAdmin. They change only when phpMyAdmin changes or an audit finds an error.
- `docs/architecture/*`: how we build it. Decisions get a `D<n>` id in the tech-stack doc.
- `docs/reference/*`: generated or tabular references (config directives, route map, parity exceptions, glossary). Generated files say so in their first line and have a `pnpm docs:gen` script.
- Checklists in feature docs are updated by `pnpm parity:report`, never by hand.

## Branching

- `main` is releasable. Feature branches per checklist section. Parity and e2e suites run on PRs touching the relevant feature folder (Turborepo filters by changed packages).
