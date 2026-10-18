# Golden path

One way to do each thing, with **one canonical file** to copy from. When two implementations of the same idea exist, the one linked here wins and the other is migrated. `pnpm conventions:check` ([tools/conventions](../../tools/conventions/src/rules.ts), in CI, ~1 s, no database) enforces the mechanical parts; every rule message links back to a section of this page. Known exceptions live in [tools/conventions/allowlist.yaml](../../tools/conventions/allowlist.yaml), each with a reason; that list only shrinks (a stale entry fails the check).

Background: [frontend](03-frontend-architecture.md), [backend](04-backend-architecture.md), [UI design system](09-ui-design-system.md), [conventions](12-project-structure-and-conventions.md).

## Adding a page

| Step | Rule | Canonical example |
|---|---|---|
| 1. Route file | `apps/web/src/routes/…` holds `validateSearch` (Zod), params and one `component` that renders a feature page; ≤ 60 lines; a `/** pma: /route */` comment. No data fetching, no markup beyond the page element. | [routes/s/$server/databases.tsx](../../apps/web/src/routes/s/$server/databases.tsx) |
| 2. Feature folder | `features/<area>/` named after the phpMyAdmin tab. Pages are `<Name>Page.tsx` exporting `<Name>Page`; pure logic in `<name>.ts` with a sibling `<name>.test.ts`; the parity registry in `pma-controls.ts`; no `ui.tsx` of local primitives, no `api.ts`. | [features/sql/](../../apps/web/src/features/sql/) (`SqlPage.tsx`, `logic.ts`, `logic.test.ts`, `pma-controls.ts`) |
| 3. Data | <a id="data"></a>Every endpoint is one entry of `api` in [lib/api.ts](../../apps/web/src/lib/api.ts) (the only `fetch`), grouped under a comment naming the API section; the first argument is the scope (`server: number`, or a `DbRef` / `TableRef`). Every query key is a `qk.*` factory in [lib/queryKeys.ts](../../apps/web/src/lib/queryKeys.ts), scope-first (`['srv', s, 'db', db, 'tbl', t, …]`) so invalidating a prefix refreshes a subtree; no inline `queryKey: [...]`. Mutations invalidate prefixes (`qk.tbl(ref)`, `qk.nav(s)`). | [features/server/DatabasesPage.tsx](../../apps/web/src/features/server/DatabasesPage.tsx) (`useQuery` + `useMutation` + invalidation) |
| 4. UI | <a id="ui"></a>Only components from [`@bettermyadmin/ui`](../../packages/ui/src/index.ts) for generic primitives (Button / `buttonVariants()`, Modal / Dialog, Panel, Alert, MessageBox, PageHeader, Table, FormRow, Loading, Select, Checkbox, Input, Tooltip, TabBar, DocLink/MySqlDocLink, Hint, SafeHtml, …). **Every phpMyAdmin `fieldset > legend` or `.card` is a `Panel title=…`** (the one section primitive: `section > header`, which the UI parity harness reads as the section name); dialogs are `Modal`, never `<dialog>`; push buttons are `Button` or, for an `<input type=submit>` that mirrors phpMyAdmin's markup, `className={buttonVariants()}`. Missing one? Add it to packages/ui (dense preset, tokens only, documented with its `pma:` source) — never a local copy. Colours only through theme tokens ([themes.css](../../packages/ui/src/themes/themes.css): Tailwind token classes such as `bg-bg-subtle`, `text-fg-muted`, or `var(--…)`); no hex/rgb outside `styles/` and packages/ui themes. | [features/server/InfoPages.tsx](../../apps/web/src/features/server/InfoPages.tsx) (PageHeader, Panel, Table zebra, MessageBox) |
| 5. Messages | <a id="messages"></a>An executed query: `SqlMessage` ([features/sql/SqlMessage.tsx](../../apps/web/src/features/sql/SqlMessage.tsx)). Any other success/notice/error (`Message::getDisplay`): `<MessageBox type text sql? />` from packages/ui; an API error becomes one with `errorMessage(e)` from lib/api.ts. Inline, non-message notes: `Alert`. Transient feedback (`ajaxShowMessage`): `showMessage()`. | [features/table/structure/StructurePage.tsx](../../apps/web/src/features/table/structure/StructurePage.tsx) |
| 6. Confirmations | `useConfirm()` / `ConfirmDialog` from packages/ui where phpMyAdmin uses `$.fn.confirm` / `confirmLink` (honours `Confirm`). Keep `window.confirm` only where phpMyAdmin itself calls `confirm()`, with a `// pma:` pointer. | [features/shell/home/ChangePasswordDialog.tsx](../../apps/web/src/features/shell/home/ChangePasswordDialog.tsx) |
| 7. Forms | Inside a `Panel` titled like phpMyAdmin's legend. Forms that mirror a phpMyAdmin `<table>` template keep the table (parity of order and labels); free-layout forms use `FormRow` (label left 220 px, control right, stacked below 900 px). Controls from packages/ui; Preview SQL with `PreviewSqlDialog`; primary action `variant="primary"`. | [features/server/VariablesPage.tsx](../../apps/web/src/features/server/VariablesPage.tsx) (Filters panel), [features/shell/home/ChangePasswordDialog.tsx](../../apps/web/src/features/shell/home/ChangePasswordDialog.tsx) (table form in a dialog) |
| 8. Strings | <a id="strings"></a>`t()` / `Trans` / `ngettext` / `pgettext` from [lib/i18n.tsx](../../apps/web/src/lib/i18n.tsx) with phpMyAdmin's exact msgid; never concatenate fragments; markup inside a msgid renders through `SafeHtml` (or `Trans` for React nodes). Server: `ctx.tr.gettext(…)` / `c.get('tr')`. | [features/server/VariablesPage.tsx](../../apps/web/src/features/server/VariablesPage.tsx) |
| 9. HTML | <a id="html"></a>`dangerouslySetInnerHTML` exists once, in packages/ui [`SafeHtml`](../../packages/ui/src/components/safe-html.tsx) (DOMPurify with phpMyAdmin's `Sanitize` allow-list, [security](07-security.md)). | [features/server/StatusPages.tsx](../../apps/web/src/features/server/StatusPages.tsx) (advisor rules) |
| 10. Parity registry | `pma-controls.ts` per feature folder, keys from `tools/parity/inventory/controls.json` ([parity markers](12-project-structure-and-conventions.md#parity-markers)); or `data-pma` on the element. | [features/sql/pma-controls.ts](../../apps/web/src/features/sql/pma-controls.ts) |

Page layout: `<PageHeader icon title docUrl />` first, then each phpMyAdmin section as a `Panel` (bottom margin included), lists as `<Table zebra>`, results as `MessageBox`; the shell adds breadcrumb, `#page_nav_icons` and the tab bar. Every page has a UI parity case in `tests/ui-parity/*.uip.ts`.

## Adding an endpoint

| Step | Rule | Canonical example |
|---|---|---|
| 1. Contract | Zod request/response schemas + inferred types in `packages/contracts/src/<area>.ts`, exported from its index; request field names keep phpMyAdmin's form names (`new_db`, `db_collation`). | [contracts/src/server-admin.ts](../../packages/contracts/src/server-admin.ts) |
| 2. Route | A Hono sub-app in `apps/server/src/routes/<area>.ts`, mounted under `/api` by app.ts (behind the global CSRF middleware: every non-GET is checked). Handler = `parse(Schema, …)` from [http/validate.ts](../../apps/server/src/http/validate.ts) → service call → `c.json(result)`. No SQL text, no `safeParse`, no business logic; a `/** pma: /route */` comment per handler. Add the route to `tools/parity/map/routes.yaml` in the same change. | [routes/server-admin.ts](../../apps/server/src/routes/server-admin.ts) |
| 3. Service | `apps/server/src/<area>/*.ts`: functions taking a context (`AdminCtx` via `withAdmin(c, fn)`: conn, cfg, tr, version) and returning the contract type; every statement through `conn.query(sql, label)` with a stable label. | [server-admin/databases.ts](../../apps/server/src/server-admin/databases.ts) |
| 4. SQL builder | Pure functions in `packages/sql-gen` (quoting with `backquote` / `quoteString`, never string-pasted identifiers); unit-tested against phpMyAdmin's output. | [sql-gen/src/indexes.ts](../../packages/sql-gen/src/indexes.ts) |
| 5. Errors | Throw `BmaError` subclasses ([http/errors.ts](../../apps/server/src/http/errors.ts)); `app.onError` maps them to the `{ error: { code, message, … } }` envelope; MySQL errors keep `errno` and `sql`. The client sees `ApiError` and renders `errorMessage(e)`. | [http/errors.ts](../../apps/server/src/http/errors.ts) |
| 6. Translator | User-facing strings (errors, `message`/`text` fields) are `tr.gettext(msgid)` with the request's translator. | [server-admin/databases.ts](../../apps/server/src/server-admin/databases.ts) |

## Shared code and duplicates

<a id="duplicates"></a>A helper has one owner; everybody else imports it. A function/class name exported by two packages fails the check unless allow-listed with a reason (e.g. same name, different purpose).

| Need | Owner |
|---|---|
| PHP emulation (`sprintf`, `htmlspecialchars`, `intval`, loose comparison, string functions, `strnatcmp`…) | `packages/i18n/src/php.ts` (formatting) · `packages/sql-lexer/src/php.ts` (lexer-level string/number semantics, dependency-free) — reuse before writing a new `php.ts` |
| Identifier / string quoting, wildcards | `packages/sql-gen/src/quote.ts` |
| Number/byte/date formatting (`formatByteDown`, `formatNumber`) | `packages/i18n/src/format.ts` |
| Collations, charsets, type catalogue | `packages/mysql-types` |
| MySQL/MariaDB docs and the variables KB | `packages/kbs`; doc URLs in `packages/ui/src/lib/doc-urls.ts` |
| pmadb / relation features | `packages/metadata` |
| UI primitives | `packages/ui` |

## Where tests go

| Layer | Location | Naming | Canonical example |
|---|---|---|---|
| Unit (pure functions) | `packages/<pkg>/test/`, `apps/server/test/unit/`, next to web logic (`features/<area>/<name>.test.ts`) | `*.test.ts` | [sql-gen/test/structure.test.ts](../../packages/sql-gen/test/structure.test.ts), [features/sql/logic.test.ts](../../apps/web/src/features/sql/logic.test.ts) |
| Integration (real MySQL, Hono app in-process) | `apps/server/test/int/` | `<area>.test.ts` | [test/int/server-admin.test.ts](../../apps/server/test/int/server-admin.test.ts) |
| Parity (vs reference phpMyAdmin) | `tests/parity/` | `<area>.parity.test.ts` | [server-databases.parity.test.ts](../../tests/parity/server-databases.parity.test.ts) |
| End-to-end (Playwright, built SPA + server) | `tests/e2e/` (`tests/e2e/<area>/` for several files) | `*.e2e.ts` (what `tools/parity` reads for checklist links) | [server-pages.e2e.ts](../../tests/e2e/server-pages.e2e.ts) |
| UI parity (visible controls vs phpMyAdmin, per page) | `tests/ui-parity/` (+ `maps/<case>.yaml` for intentional differences) | `*.uip.ts`, one `pageParity()` per page | [pages.uip.ts](../../tests/ui-parity/pages.uip.ts), [README](../../tests/ui-parity/README.md) |

Put the checklist id in the test title (`it('… [p01-41d435]')`).

### The parity client

<a id="parity-client"></a>`tests/parity` talks to phpMyAdmin only through `PmaClient` in [tests/parity/lib/pma.ts](../../tests/parity/lib/pma.ts) (no other `fetch`, no second client class). Its whole request API:

| Method | phpMyAdmin request |
|---|---|
| `login(user, password, server?, lang?)` | the cookie login form; stores the session token |
| `getPage(route, params?)` | full-page `GET index.php?route=…` → HTML |
| `getJson(route, params?)` | AJAX `GET` (`ajax_request`, `X-Requested-With`) → `PmaJson` |
| `postPage(route, form)` | form `POST` (+ `server`, `token`) → HTML (redirects followed) |
| `postJson(route, form)` | AJAX `POST` (+ `server`, `token`, `ajax_request`) → `PmaJson`; `form` may be ordered pairs for repeated keys |

Form builders for recurring forms are plain functions next to it (`sqlBoxForm()` for the SQL tab, `navigationForm()`), passed to `postJson`. Reachability: `isPmaUp(url)` (`pmaReachable` in server-setup.ts for the shared instance). Instance setup: `server-setup.ts` (`startHarness`); an instance with its own configuration: `pma-shadow.ts` (overrides on top of the reference config) or `pma-instance.ts` (own `config.inc.php` + session-state dumps) — prefer pma-shadow for new cases.

### Exception ids

<a id="exception-ids"></a>An intentional difference (`X<n>`) or a phpMyAdmin source quirk (`Q<n>`) gets a row in [docs/reference/parity-exceptions.md](../reference/parity-exceptions.md). Take the id from `pnpm parity:next-id X` (or `Q`), never by counting rows: it prints one above the highest id ever registered (retired `~~X38~~` rows included, so an id is never reused). When a merge brings in someone else's new row with the same id, renumber yours with a fresh `pnpm parity:next-id` everywhere you wrote it. `pnpm parity:check` fails when an id is registered twice or when an id written anywhere in the repository (code, tests, docs, `tests/parity/allowed-diffs.yaml`, the maps) is not registered ([tools/parity/src/exception-ids.ts](../../tools/parity/src/exception-ids.ts)); a test that feeds a validator a deliberately unknown id says `fake exception id` on that line or the line above.

## Naming

<a id="naming"></a>

- Files: React components `PascalCase.tsx` (one main export of the same name); everything else `kebab-case.ts` in packages and server, `camelCase.ts` in apps/web/src (existing convention); tests mirror the file they test.
- Components and helpers echo the phpMyAdmin template/function they mirror and carry a `pma:` pointer (`// pma: src/Html/Generator.php::getMessage`).
- API: `api.<thing>` reads, `api.<verb><Thing>` writes (`api.databases`, `api.createDatabase`); query keys `qk.<thing>` with the same name.
- Contracts: `<Thing>Request` / `<Thing>Response` / `<Thing>Query` (GET search params).
- Commits: Conventional Commits, scope = feature folder or package (`feat(server): …`, `refactor(ui): …`).

## The checker

`pnpm conventions:check` (`--list` prints the rules). Rules and the sections they enforce:

| Rule | Section |
|---|---|
| `web/no-fetch`, `web/api-module`, `web/query-keys` | [Data](#data) |
| `no-dangerous-html` | [HTML](#html) |
| `web/no-local-primitives`, `web/no-hand-made-ui`, `web/no-raw-colors` | [UI](#ui) |
| `web/route-size`, `web/no-server-import` | [Adding a page](#adding-a-page) |
| `server/no-sql-in-routes`, `server/validate`, `server/csrf-global` | [Adding an endpoint](#adding-an-endpoint) |
| `server/strings-through-tr` | [Strings](#strings) |
| `no-duplicate-exports` | [Shared code and duplicates](#duplicates) |
| `parity/one-client` | [The parity client](#parity-client) |
| `tests/naming` | [Where tests go](#where-tests-go) |
