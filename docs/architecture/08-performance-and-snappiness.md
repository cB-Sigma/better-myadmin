# Performance and snappiness

"As snappy as phpMyAdmin" is a hard requirement, so this doc defines what snappy means in numbers, how we hit it, and how CI stops regressions.

## Why phpMyAdmin feels fast

phpMyAdmin's main panel is server-rendered HTML swapped in over AJAX. Each page is small, has no client-side framework boot, and the browser's HTML parser is extremely fast. Its weaknesses: every click is a full round trip that renders on the server; grids above a few thousand rows get slow (`makegrid.ts` binds handlers per cell); the nav tree re-renders big subtrees; there is no prefetching; JS bundles are large (jQuery + jQuery UI + Bootstrap + CodeMirror all upfront).

Our plan: keep the small-payload discipline, remove the round-trip-per-click where possible, and never render more DOM than is visible.

## Budgets

Measured on a mid-range laptop (4× CPU throttle in Lighthouse terms is *not* applied; we measure realistic desktop) against the `sakila` and a 1M-row synthetic table on a local MySQL 8.4.

| Metric | Budget | phpMyAdmin 6 (reference, same machine) |
|---|---|---|
| Cold load to interactive login page | ≤ 600 ms | ~450 ms |
| Cold load to interactive home page (authenticated, warm HTTP cache) | ≤ 500 ms | ~600 ms |
| Initial JS (gzip) | ≤ 180 KB; vendors lazy | ~900 KB upfront |
| Navigate tree table → Browse (25 rows, hover-preloaded) | ≤ 50 ms perceived (content already fetched) | ~250–400 ms |
| Navigate tree table → Browse (no preload) | ≤ 1 server RTT + 30 ms render | ~1 RTT + server render + HTML parse |
| Page next/prev in Browse | ≤ 1 RTT, no blank state | 1 RTT with blank/flash |
| Sort column click | ≤ 1 RTT, header updates optimistically | 1 RTT |
| Open grid cell editor (double-click) | ≤ 16 ms | ~50 ms |
| Render 1,000-row "Show all" grid | ≤ 100 ms to first paint, 60 fps scroll | several seconds, janky |
| Render 50,000-row grid | ≤ 300 ms, 60 fps scroll (virtualized) | refused / browser hang |
| Nav tree with 2,000 databases | ≤ 100 ms render, 60 fps scroll | paged at 100 by design (we keep paging *and* are fast) |
| Expand a db node with 500 tables | ≤ 1 RTT + 20 ms | 1 RTT + ~100 ms |
| Structure tab, 150 columns | ≤ 80 ms | ~150 ms |
| SQL editor keystroke → highlight | ≤ 8 ms | ≤ 8 ms (CM5) |
| Lint 50 KB of SQL | ≤ 50 ms in worker, no main-thread stall | 1 RTT to `/lint` |
| Export 1 GB table | constant memory (< 200 MB RSS), throughput ≥ 50 MB/s | memory-bound unless `CompressOnFly` |
| Import 500 MB SQL | streaming, progress every 250 ms | multi-request partial import |
| Interaction to Next Paint (INP) p95 across e2e suite | ≤ 100 ms | n/a |

## Techniques

### Fewer and earlier requests

1. **Intent preloading** on hover of tree items, tabs, pagination, FK links (TanStack Router). Delay 50 ms to avoid loading everything the cursor crosses.
2. **One payload per page**: the server composes everything a page needs (rows + fields + counts + FK map + uiprefs) in one response, exactly the data phpMyAdmin computes for one render. No N+1 from the client.
3. **Scope metadata is prefetched** when entering a db or table scope (tab visibility, capabilities, table meta) so tabs render complete.
4. **Server-side caching per session**: table metadata (`SHOW INDEX`, FK map, display fields, column comments/MIME) cached until a DDL on that table or an explicit reload; `information_schema` queries use the `SHOW`-based fast path when `DisableIS` is set, same as phpMyAdmin.
5. **HTTP**: HTTP/2 or HTTP/3 when behind a proxy that supports it; immutable hashed assets; Brotli for static, gzip for API JSON above 1 KB.

### Render less

6. **Virtualized grid and tree** (TanStack Virtual). Rows outside the viewport do not exist in the DOM.
7. **Cell components are memoized** on primitive props; a row re-renders only if its data or selection state changes.
8. **No layout thrash**: fixed row height (28 px dense) so the virtualizer never measures; column widths from `colgroup`. Variable-height rows (wrapped long text with "Full texts") switch to measured mode only for that grid.
9. **Deferred non-critical UI**: the Console, the page-settings forms, the chart/designer/GIS/pdf libraries are lazy chunks.
10. **Skeleton discipline**: never show a skeleton under 300 ms; keep the previous content and show a progress bar (`pendingMs`). Blank flashes read as slow even when the total time is fine.

### Compute off the main thread

11. Web workers for SQL lexing/linting, CSV/ODS preview parsing, JSON pretty-printing of large cells, and schema-export layout computation.
12. `requestIdleCallback` for prefetching the next/previous browse page and for warming the autocomplete schema cache.

### Server side

13. `mysql2` streaming for exports and for browse results above 1,000 rows (rows are serialized as they arrive; the JSON response is streamed with `rowsAsArray` to halve payload size versus objects).
14. Connection pools are warm per session; the first query after login pays the connection cost once.
15. Approximate counts (`MaxExactCount`) and the view count policy (`MaxExactCountViews`) are honoured so a 100M-row browse does not run `COUNT(*)`.
16. `KILL QUERY` cancellation on navigation away from a running query (Browse unmount cancels an in-flight count/browse; the SQL tab shows a Cancel button).

### Bundle

17. Vite + Rollup code splitting per route group; `vendor-react`, `vendor-tanstack`, `vendor-ui` chunks; CodeMirror (~300 KB raw) lazy; Chart.js lazy; React Flow lazy; OpenLayers lazy (~700 KB raw, only on GIS pages); pdf-lib lazy.
18. Icons tree-shaken from Lucide; no icon fonts.
19. Lingui catalogues per locale, loaded on demand; English inlined.
20. `size-limit` in CI with the budgets above.

## Measurement and CI gates

- **Playwright performance suite** (`tests/e2e/perf/*.spec.ts`) runs against dockerized MySQL 8.4 with `sakila` + synthetic big tables, records traces, and asserts: route transition time (from click to `data-loaded` attribute), INP via the `web-vitals` library injected into the page, frame rate during a scripted scroll of the grid (`PerformanceObserver` long-frame count ≤ 2 per 5 s).
- **Size gates**: `size-limit` on the initial chunk and on each lazy chunk.
- **Server bench** (`apps/server/bench/*.ts`, autocannon): `/query` with 25 rows p95 ≤ 15 ms over the MySQL time; export throughput; import throughput.
- **Lighthouse CI** on login and home pages: performance ≥ 95.
- Regressions over 10% against the stored baseline fail the PR; baselines update on main.

## Things we intentionally do *not* do

- No SSR/streaming HTML: adds complexity for no gain on an authenticated tool.
- No service worker precaching of API data: stale metadata in a DB admin tool is worse than a round trip. Static assets only.
- No speculative execution of SQL on hover beyond read-only browse/metadata loaders (never mutations, never `COUNT(*)` on tables above `MaxExactCount`).
- No client-side joining of FK display values across the whole grid on load; display values are fetched per distinct key lazily and cached, with a cap per page, the same practical limit phpMyAdmin's `RelationalDisplay=D` path imposes via `ForeignKeyMaxLimit`.
