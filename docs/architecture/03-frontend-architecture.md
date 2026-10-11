# Frontend architecture

The SPA lives in `apps/web`. This document covers routing, data fetching, state, the component layers, the grid, editors, the navigation tree, theming, keyboard handling, and the rules that keep it fast. Feature-by-feature behaviour is in `docs/features/*`; this is the machinery.

## Route tree

File-based routes with TanStack Router. Every phpMyAdmin page has a route; the mapping from phpMyAdmin's `route=` values is in the [route map](../reference/pma-route-map.md).

```
routes/
  __root.tsx                      shell: nav panel, top bar, console, toasts, hotkeys
  login.tsx                       auth_type=cookie login (+ 2FA step)
  settings/                       user preferences (tabs)  ← /preferences/*
    index.tsx  manage.tsx  features.tsx  sql.tsx  navigation.tsx  main-panel.tsx  export.tsx  import.tsx  two-factor.tsx
  about/   changelog.tsx  license.tsx  phpinfo.tsx  (static)
  s/$server/
    route.tsx                     server scope layout: tab bar (Databases, SQL, Status, User accounts, Export, Import, Settings, Binary log, Replication, Variables, Charsets, Engines, Plugins)
    index.tsx                     home page
    databases.tsx  sql.tsx  export.tsx  import.tsx  variables.tsx  collations.tsx  engines.$engine.tsx  plugins.tsx  binlog.tsx  replication.tsx  user-groups.tsx
    status/  index.tsx  processes.tsx  queries.tsx  variables.tsx  monitor.tsx  advisor.tsx
    privileges/  index.tsx  user.tsx (edit, tabs via search param `tab`)
    db/$db/
      route.tsx                   database scope layout: tab bar (Structure, SQL, Search, Query, Export, Import, Operations, Privileges, Routines, Events, Triggers, Tracking, Designer, Central columns)
      index.tsx → structure
      structure.tsx  sql.tsx  search.tsx  qbe.tsx  multi-table-query.tsx  export.tsx  import.tsx  operations.tsx  privileges.tsx  routines.tsx  events.tsx  triggers.tsx  tracking.tsx  designer.tsx  central-columns.tsx  data-dictionary.tsx
      view/create.tsx  view/$view/operations.tsx
      t/$table/
        route.tsx                 table scope layout: tab bar (Browse, Structure, SQL, Search, Insert, Export, Import, Privileges, Operations, Tracking, Triggers)
        index.tsx → browse
        browse.tsx  structure.tsx  sql.tsx  search.tsx  zoom-search.tsx  find-replace.tsx  insert.tsx  change.tsx  export.tsx  import.tsx  privileges.tsx  operations.tsx  tracking.tsx  triggers.tsx  chart.tsx  gis.tsx  relation.tsx  indexes.tsx  normalization.tsx
    sql.tsx (server scope SQL)   — db and table scopes have their own sql.tsx so the "Run SQL query on database X" header is correct
```

### Search params are the state

phpMyAdmin keeps browse state in URL params: `sql_query`, `pos`, `session_max_rows`, `sort_by`/`sort_order`, `is_browse_distinct`, `goto`, `back`. We keep the same approach so links are shareable and the back button works, with Zod-validated typed search params per route:

```ts
// routes/s/$server/db/$db/t/$table/browse.tsx
export const Route = createFileRoute('/s/$server/db/$db/t/$table/browse')({
  validateSearch: z.object({
    sql: z.string().optional(),            // sql_query (default: browse query for table)
    pos: z.coerce.number().int().min(0).default(0),
    rows: z.union([z.coerce.number().int().positive(), z.literal('all')]).optional(), // session_max_rows
    sort: z.array(z.object({ col: z.string(), dir: z.enum(['ASC','DESC']) })).optional(),
    distinct: z.boolean().optional(),      // is_browse_distinct
    displayOptions: BrowseDisplayOptions.partial().optional(), // pftext, relational_display, geoOption...
    goto: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => context.queryClient.ensureQueryData(browseQuery(params, deps)),
  pendingMs: 300, pendingMinMs: 200,
  component: BrowsePage,
})
```

Long SQL in the URL: phpMyAdmin signs `sql_query` (`sql_signature`) so a GET cannot be forged into running arbitrary SQL. We do the same: the server returns a signature with any query it ran, and the client puts `sql` + `sig` in the URL; a GET-driven loader will only *re-run* a query whose signature validates. Unsigned `sql` from a pasted URL opens the SQL editor pre-filled instead of executing (same as phpMyAdmin's behaviour when the signature is missing).

### Preloading policy

- `defaultPreload: 'intent'`, `defaultPreloadDelay: 50` ms. Hovering a tree table, a tab, a pagination button, or a FK link prefetches.
- Tab bars prefetch their cheap metadata on scope entry so tabs appear with their badges (e.g. trigger count) immediately.
- `defaultPendingMs: 300`: we never show a skeleton for under 300 ms; the old page stays, a 2px progress bar runs under the top bar. phpMyAdmin's "Loading..." pill is reproduced after the same delay because users look for it.
- Pagination uses `placeholderData: keepPreviousData` so the grid never blanks between pages; the next and previous pages are prefetched after the current one lands.

## Data layer

### Typed client

`packages/contracts` defines every endpoint as a Zod request/response pair; `apps/server` mounts them with Hono validators; `apps/web` imports the typed `hc` client. Nothing in the UI calls `fetch` directly.

### Query keys

Hierarchical, scope-first, so invalidation is a prefix match:

```
['srv', s]                                      server-level facts (version, variables snapshot, user)
['srv', s, 'nav', 'dbs', {page, filter}]       navigation tree: databases
['srv', s, 'nav', 'db', db, 'tables', {...}]   navigation tree: a db's children (lazy)
['srv', s, 'db', db, 'structure']
['srv', s, 'db', db, 'tbl', t, 'meta']          columns, indexes, FKs, display field, comments, mime
['srv', s, 'db', db, 'tbl', t, 'browse', {sql, pos, rows, sort...}]
['srv', s, 'db', db, 'tbl', t, 'uiprefs']       column order/visibility/sort memory
['srv', s, 'db', db, 'tbl', t, 'fk-values', col, {search, page}]
['srv', s, 'db', db, 'tbl', t, 'enum', col]
['srv', s, 'prefs']                             merged user preferences
['srv', s, 'meta-storage']                      pmadb status (which features are on)
```

Mutations declare which prefixes they invalidate. Rule: a DDL mutation invalidates `['srv', s, 'db', db, 'tbl', t]` (everything about the table) plus `['srv', s, 'db', db, 'structure']` and the table's nav node. A DML mutation invalidates `browse` only. A database-level change invalidates `['srv', s, 'db', db]` and `['srv', s, 'nav']`.

### Optimistic updates

Used only where phpMyAdmin itself updates the DOM optimistically: favorite star toggles, nav tree expand/collapse, column visibility and ordering in the grid, "Check all" selection, console history entries. Everything that executes SQL waits for the server and shows the server's message, because the message *is* the feature (affected rows, warnings, the SQL that ran).

## Client state

Zustand stores, one per concern, tiny and serializable:

| Store | Holds | Persistence |
|---|---|---|
| `NavTreeStore` (`features/navigation/store.ts`) | expanded branches and their positions, fast-filter texts, loaded branches, selection, "link with main panel" | expanded paths + positions in `sessionStorage.navTreePaths`, filter texts in `sessionStorage.navTreeSearchFilters` (phpMyAdmin's keys and semantics: restored only for the same server and session token); panel width in `localStorage` until the preferences API lands (phpMyAdmin: `navigation/update-width`) |
| `useConsoleStore` | open/closed, height, active tab, history (with status/time), options (`AlwaysExpand`, `CurrentQuery`, `EnterExecutes`, `DarkTheme`) | server `console/update-config` → user preferences (configuration storage or session), as in pMA |
| `useThemeState` (`features/shell/theme`) | theme id, color mode per `ThemePerServer` key (`bma_theme[-N]`, `…_color`) | localStorage + cookie mirror, read by `public/theme-init.js` before first paint |
| `useGridPrefsStore` | per-table column order/visibility/width (mirrors `table_uiprefs`) | server when `uiprefswork`, else localStorage |
| `useSelectionStore` (per grid instance) | checked rows, last clicked index for shift-click | none |
| `ShortcutMachine` (`features/shell/hotkeys`) | pending `D`/`T` chords, help overlay open | none |

Everything else is either server state (Query) or URL state (Router).

## Component layers

```
packages/ui               shadcn primitives (Button, Dialog, Popover, Command, Tabs, Tooltip, Checkbox, Select, Table...) with the "dense admin" preset
apps/web/src/components   app-generic composites: DataGrid, SqlEditor, SqlMessage, ConfirmDialog, PageSettingsGear, DocLink, MySqlDocLink, Pagination, FilterInput, CheckAllBar, WithSelectedBar, IconLink, Breadcrumb, TabBar, SplitPane, EmptyState, ApproxCount
apps/web/src/features     one folder per feature doc area, each with components/, hooks/, api.ts, i18n.ts
apps/web/src/routes       thin: validate search, load, render a feature page
```

Rule: a `routes/*` file is under 60 lines. Feature folders own their components. `components/` are only things used by three or more features.

## The results grid (`DataGrid`)

The most important component. Requirements are enumerated in [Browse / results grid](../features/02-browse-results-grid.md). Architecture:

- **Model:** TanStack Table with `columnOrder`, `columnVisibility`, `columnSizing`, `rowSelection`, manual sorting (sort happens on the server as `ORDER BY`), manual pagination.
- **Rendering:** TanStack Virtual for rows when `rows.length > 100`; plain rendering below (virtualization costs a little on tiny tables and breaks "print view"). Columns are not virtualized (phpMyAdmin tables rarely exceed 100 columns; horizontal virtualization breaks sticky first columns and drag reorder; revisit if profiling says so).
- **Cell renderers** chosen server-side by `field.renderer` (`text`, `number`, `null`, `blob`, `binary-hex`, `bit`, `enum`, `set`, `date`, `json`, `geometry`, `fk-link`, `transformed:<plugin>`), so the client does not re-derive type semantics. Truncation (`LimitChars`) is applied server-side with a `truncated: true` flag; the "Partial texts / Full texts" toggle re-queries with the option flipped, as phpMyAdmin does.
- **Editors:** one component per editor kind (`TextCell`, `TextareaCell`, `NumberCell`, `DateTimeCell`, `EnumCell`, `SetCell`, `FkCell`, `NullToggle`, `BlobCell` (download only), `JsonCell`, `GeometryCell`). Grid editing is enabled per `GridEditing` (`double-click` default, `click`, `disabled`). Enter saves, Esc cancels, Tab moves to the next editable cell. `SaveCellsAtOnce` collects edits and shows a "Save" bar.
- **Row addressing:** the server returns `uniqueCondition(rowIndex)` material: which columns form the unique key (`PRIMARY`, else first `UNIQUE` not containing NULLs, else all columns with `RowActionLinksWithoutUnique` semantics). The client assembles the `WHERE` clause with the server's quoting helper (shared package) and sends it back for edit/delete/copy. Exact algorithm: `Results::getUniqueConditions` equivalent in `packages/sql-gen/where.ts`, tested against phpMyAdmin's fixtures.
- **FK traversal:** a cell whose column is in `fkLinks` renders its value as a link to `/s/:s/db/:refDb/t/:refTable/browse?sql=<signed SELECT * WHERE refCol = value>` with title/tooltip showing the display field value (fetched lazily and cached per table) or the key, per `RelationalDisplay` (`K` key, `D` display column) and the per-result "Relational key / Relational display column" option. Hover prefetches the target route.
- **Header:** click sorts (cycles none → ASC → DESC like phpMyAdmin's arrow behaviour), `Shift+click` adds a secondary sort (phpMyAdmin's multi-column sort), drag reorders columns (persisted when `uiprefswork`), a header menu offers Hide, Show all, Reset order. Sticky header; "repeat header every `RepeatCells` rows" is honoured by inserting header rows (virtualizer treats them as rows).
- **Row hover/marker:** `BrowsePointerEnable`, `BrowseMarkerEnable` map to CSS classes toggled on hover/selection.
- **Options panel** (collapsible, matches the `Options` disclosure): partial/full texts, relational key/display column, show binary contents, show BLOB contents, hide browser transformation, geometry display (WKT/WKB/GIS visualization), vertical/horizontal, repeat headers.
- **Footer bar:** "Check all", "With selected: Edit / Copy / Delete / Export", pagination (first/prev/page select/next/last), "Number of rows", "Filter rows" (client-side text filter over the loaded page, like `jquery-uitablefilter`), "Show all" (refused with phpMyAdmin's message above `ShowAll` threshold unless the user confirms).

## SQL editor (`SqlEditor`)

CodeMirror 6 wrapped in a component that reproduces phpMyAdmin's editor UX: `Ctrl+Enter` run (or `Enter` when `ConsoleEnterExecutes` in the console), `Ctrl+Space` autocomplete, lint gutter from the worker, "Format" / "Format as a single line" via `POST /sql/format` (the ported `phpmyadmin/sql-parser` Formatter), "Clear", `Get auto-saved query` (localStorage autosave per scope, same key semantics), parameter binding detection (`:name` highlighted when "Bind parameters" is on), delimiter input, the right-hand "Columns" list with `<<` insertion for the current table, snippet buttons (`SELECT *`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CLEAR`, `FORMAT`) producing the same templates. Details: [SQL editor and query pipeline](../features/09-sql-editor-query-pipeline.md).

## Navigation tree

Virtualized tree (one flat list of visible nodes) so a server with 5,000 databases scrolls at 60 fps. Behaviours from [Shell, navigation, auth](../features/01-shell-navigation-auth.md): grouping by `NavigationTreeDbSeparator` / `NavigationTreeTableSeparator` with `NavigationTreeTableLevel` depth, `FirstLevelNavigationItems` pagination with the fast filter appearing at `NavigationTreeDisplayDbFilterMinimum`, per-container (`Tables`, `Views`, `Procedures`, `Functions`, `Events`) lazy children fetched on expand with `MaxNavigationItems` pagination and the item filter at `NavigationTreeDisplayItemFilterMinimum`, `New` items, favorite stars, hide (eye icon → `navigationhiding`) with the "N hidden items" unhide popup, two default-action icons per table (`NavigationTreeDefaultTabTable`, `...Table2`), link-with-main-panel highlighting and auto-expand, drag-resize width (persisted via `/navigation/update-width` equivalent) and collapse, "Reload navigation" button that invalidates the tree cache, server selector when multiple servers, recent and favorite tables dropdowns, the logo + 6 quick links row. Expanded state is restored across reloads.

## Shell: top bar, tabs, breadcrumbs, console, messages

- **Breadcrumb**: server icon + name, db icon + name, table icon + name, table comment in italics after the name (as pMA), each a link to that scope's default tab.
- **Tab bar**: per-scope tabs with icons; overflow collapses into a "More" dropdown when the width is exceeded (phpMyAdmin's `menu_resizer`). Visibility rules (e.g. Triggers tab only when the user has `TRIGGER` privilege, Designer only when `pmadb` relation tables exist, Tracking only when `trackingwork`) come from the server's `scope-capabilities` payload and the user-group tab allow-list.
- **Messages**: a `SqlMessage` component renders success/notice/error with the SQL block, the `[Edit inline] [Edit] [Explain SQL] [Create PHP code] [Refresh]` links (per `SqlQueryBox` settings) and MySQL doc links for error codes. Transient notices toast in the top-right and fade after 5 s like `ajaxShowMessage`; errors persist.
- **Console**: bottom drawer identical in structure to phpMyAdmin's (Console / History / Options / Bookmarks / Debug SQL tabs), draggable height, `Ctrl+Enter`/`Enter` execution per option, history with status + time + per-entry actions (Collapse/Expand, Requery, Edit, Explain, Profiling, Bookmark), bookmark filter.
- **Page settings gear**: opens the page-specific settings form from `Config/Forms/Page/*` ([matrix](../features/08-settings-preferences-pmadb.md#page-settings-forms-matrix)) and saves to prefs.

## Theming

Tokens as CSS variables on `:root`, four built-in themes ported from phpMyAdmin (`pmahomme` default, `original`, `metro`, `bootstrap`) plus dark mode, chosen per `ThemeDefault`/`ThemeManager`/`ThemePerServer`. The Themes page shows screenshot cards exactly like phpMyAdmin's. Theme is applied before first paint via an inline script reading the cookie to avoid flashes. Details in [UI design system](09-ui-design-system.md).

## Keyboard

A single shortcut layer (`features/shell/hotkeys`): phpMyAdmin's `shortcuts_handler.ts` reproduced as a tested state machine — `K` / `Ctrl+K` / `Ctrl+Alt+C` console toggle (dispatched as the `bma:console-toggle` window event), `S` navigation settings (`bma:navigation-settings` when the panel has no settings icon), `D`/`T` then `S` / `F` structure / search (2 s chord window), `E` export, `H` home, `Backspace` back — plus `Ctrl+Enter`/`Alt+Enter` form submit, `Esc` closing dialogs, and our addition `?` for a help overlay listing them. Shortcuts pause while a dialog is open. It is the only key binding for the console: the console listens for `bma:console-toggle` and toggles from the state the previous toggle left, so `Ctrl+K` outside form fields toggles twice like phpMyAdmin (Q45); CodeMirror 6 editors count as the textarea of phpMyAdmin's CodeMirror 5 editors. The full table is in the shell feature doc.

## i18n

Lingui (`@lingui/core`) holds phpMyAdmin's PO catalogues, compiled per locale and loaded on demand; components translate with `t('…')` / `<Trans id="…" />` / `ngettext` / `pgettext` from `lib/i18n.tsx`, keyed by phpMyAdmin's exact msgids (printf placeholders filled by the PHP `sprintf` port). Language is chosen like phpMyAdmin's `LanguageManager::selectLanguage`: `Lang` config → POST/GET `lang` → cookie → `Accept-Language` → `User-Agent` → `DefaultLang`, filtered by `FilterLanguages`. RTL locales flip the layout via `dir="rtl"` and Tailwind logical properties. Details: [i18n](10-i18n-and-accessibility.md#i18n).

## Error handling

- Query/API errors render phpMyAdmin's exact error block (MySQL errno + message + doc link) inside the page, not a toast.
- Route loader failures show the message in place with the previous page preserved behind a thin red bar.
- Uncaught client exceptions are caught by an error boundary that offers the "Report this error" dialog (`SendErrorReports` directive: `ask` / `always` / `never`) posting a sanitized stack to `/api/telemetry/error`.

## Performance rules (enforced by lint and CI budgets)

1. Initial route chunk < 180 KB gzipped; CodeMirror, Chart.js, React Flow, OpenLayers, pdf-lib are lazy chunks loaded on first use of their feature.
2. No component renders more DOM rows than fit on screen plus overscan (virtualize above 100 rows).
3. No `useEffect` fetches; all data goes through route loaders or `useQuery`.
4. Memoized cell renderers; row components receive primitives, not the row object.
5. Workers for anything that parses more than 50 KB of text (SQL lint, CSV preview, JSON pretty-print of large cells).
6. Interaction to next paint under 100 ms on a 200-row × 30-column grid (measured in CI with Playwright traces).

Budgets and measurement in [Performance](08-performance-and-snappiness.md).
