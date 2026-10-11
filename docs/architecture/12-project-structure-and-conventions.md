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
  tools/
    parity/                    inventories extracted from phpMyAdmin, maps, coverage reports, CI gate
      php/                     extraction scripts that execute phpMyAdmin's own code
      inventory/  map/         committed JSON inventories; YAML mappings + checklist ids
  docs/                        this documentation
  tests/parity/                golden parity scripts and allowed-diffs.yaml
  docker/                      compose files for dev and parity (mysql matrix, phpmyadmin reference)
  .github/workflows/           ci.yml (lint, unit, contract), int.yml (matrix), parity.yml, e2e.yml, release.yml
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  biome.json
```

## Tooling

- **Package manager**: pnpm 9, workspace protocol for internal deps.
- **Task runner**: Turborepo (`build`, `dev`, `test`, `lint`, `typecheck`) with remote cache.
- **Lint/format**: Biome (replaces ESLint+Prettier), plus `pnpm conventions:check` (tools/conventions, TypeScript AST, no build) for the rules Biome cannot express: no `fetch` outside `lib/api`, query keys only from `lib/queryKeys`, no `dangerouslySetInnerHTML` outside `SafeHtml`, no local UI primitives, no raw colours, route files ≤ 60 lines, no SQL in route handlers, one parity client — see [golden path](16-golden-path.md#the-checker).
- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; project references per package.
- **Commits**: Conventional Commits; `feat(browse): ...`, scopes are feature folder names or package names. Each PR references the checklist items it completes (`Parity: browse#L120-L131`).
- **Releases**: Changesets; semver; `release.yml` builds the npm package, Docker image (multi-arch) and Bun binaries.

## Code conventions

The step-by-step version, with one canonical file per step and the rules `pnpm conventions:check` enforces in CI, is the [golden path](16-golden-path.md). When this section and the golden path disagree, the golden path wins.

### Naming

- Directives keep phpMyAdmin names in config (`MaxRows`), camelCase in code (`maxRows`), and the mapping is generated from `packages/config/schema.ts` so there is one source.
- Feature folders are named after the phpMyAdmin tab/page they implement; component names echo phpMyAdmin template names where sensible (`ResultHeader` ↔ `sql/sql_query_message.twig`) and the file carries a `// pma: src/Display/Results.php::getTableHeaders` comment pointing at the mirrored source. These pointers are how a reviewer checks parity quickly.

### Parity markers

`tools/parity` reads these statically (no build, no execution) to compute [coverage](../reference/coverage/README.md); see [Testing and parity](11-testing-and-parity-strategy.md#mechanical-inventories-and-the-parity-gate).

- **Template controls**: each feature folder that implements phpMyAdmin controls has a `pma-controls.ts` registry, so components stay untouched and merges stay easy:

  ```ts
  export const pmaControls = {
    'login/form.twig#pma_username': 'LoginPage.tsx',
    'sql/query.twig#SQL': { file: 'SqlPage.tsx', match: 'button_submit_query' },
  }
  ```

  Keys are inventory keys from `tools/parity/inventory/controls.json`: `<template>#<name>`, else `#id:<id>`, else `#<kind>:<label msgid>` (`#link:Reload navigation panel`, `#button:Clear fast filter`); controls printed by PHP helpers use the PHP file (`src/Navigation/NavigationTree.php#id:pma_navigation_sync`). The value is the component file, relative to the registry; the gate checks that it exists and still contains the control's name, id or label msgid as a quoted string, or the `match` string when given. Alternatively, put `data-pma="<key> [<key>…]"` on the element itself (no further evidence needed). Only claim a control the component really implements.
- **Routes**: map phpMyAdmin routes in `tools/parity/map/routes.yaml` (`api:`/`ui:` targets, else `planned: M<n>`); a target must exist in the Hono registrations or TanStack routes, so change the map in the same PR as the endpoint.
- **Checklist tests**: put the item id in the test title, e.g. `it('pages by prefix [p01-41d435]', …)` (ids are in `tools/parity/map/checklist-ids.json` and next to each ticked item); a title equal to the item text also links. Several ids per title are fine. Only link a test that exercises the whole item.
- **Not applicable**: `n/a: <reason>` in `tools/parity/map/*.yaml`, or `<!-- parity:n/a: reason -->` after a checklist item.

### Frontend

- Route file: `validateSearch`, `loader`, `component` only. Business logic in `features/*/hooks`.
- Data: `useQuery`/`useSuspenseQuery` with keys from `lib/queryKeys.ts`; mutations declare `invalidates` arrays.
- Components receive data, not query hooks, below the page level (keeps them testable in Storybook).
- Styling: Tailwind utilities + CSS variables; no inline style objects except for virtualizer transforms and measured widths.
- i18n: `t` / `Trans` / `ngettext` / `pgettext` with phpMyAdmin's exact msgids (no Lingui macros, they rewrite msgids); never concatenate translated fragments; `pnpm i18n:parity` must stay clean.
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
- `docs/reference/*`: generated or tabular references (config directives, route map, parity exceptions, glossary). Generated files say so in their first line and have a generating script (`pnpm parity:report` for `pma-route-map.md` and `coverage/`).
- Checklists in feature docs are updated by `pnpm parity:report`, never by hand (it only rewrites the `[ ]`/`[x]` marker and the ` <!-- parity:test --> …` suffix).

## Branching

- `main` is releasable. Feature branches per checklist section. Parity and e2e suites run on PRs touching the relevant feature folder (Turborepo filters by changed packages).
