# UI structure parity

Opens the same page in the reference phpMyAdmin and in BetterMyAdmin, captures the visible
interactive controls of both and fails on every difference that is not mapped.

```sh
pnpm test:ui-parity                       # builds the web app, runs every case
pnpm exec playwright test -c tests/ui-parity/playwright.config.ts -g table   # some cases (app already built)
open .data/ui-parity/index.html           # screenshots side by side + differences (review aid, not a gate)
```

Needs MySQL (`BMA_TEST_HOST/PORT`, root `BMA_TEST_PASSWORD`) and the reference phpMyAdmin
(`BMA_PARITY_PMA_URL`, default `http://127.0.0.1:8081`, cookie auth); cases are skipped when it is
down. global-setup creates `uip_db.uip_t`, our configuration storage `uip_pmadb` and one superuser per
app (`uip_pma`, `uip_bma`); our server runs on a random port (`BMA_UIP_PORT`).

## Writing a case

Every page a feature adds needs a case in a `*.uip.ts` file:

```ts
pageParity('table-indexes', {
  pma: { route: '/table/indexes', params: { db: FIX.db, table: FIX.table, index: 'PRIMARY' } },
  ours: { path: `/s/1/db/${FIX.db}/t/${FIX.table}/indexes?index=PRIMARY` },
  interactions: [{ name: 'add column', do: { click: 'Add to index' } }],   // same action in both
})
```

- `scope`: `content` (default, `#page_content` without the tab bar), `menu` (breadcrumb + tabs),
  `navigation`, `console`, `page`, a CSS selector, or `{ pma, ours }`.
- `interactions`: steps run in both apps, each followed by a capture + diff, so show/hide behaviour is
  compared too. `do` takes `{ click | check | uncheck | hover: label }`, `{ fill: [label, text] }` (typed
  key by key), `{ select: [label, option] }`, `{ press: key }`, `{ wait: ms }`, or a list; `pma`/`ours`
  take per-app actions or `async (page) => …`. Controls are found by accessible name inside the scope.
- `setup(pages)`, `sql` (run as root first), `ready` (selectors to wait for), `exclude` (selectors).
- `known: 'TODO …'` marks a case whose differences are still to be fixed (`test.fail`): it turns red
  once the page matches, then delete `known`.

## What is compared

For each control: kind (textbox, select, checkbox, radio, button/link, file, slider), accessible label
(aria-labelledby/aria-label, `<label>`, own text, value, alt, title, placeholder), input type,
value, select options (label, value, selected), checked/disabled/required/readonly, the section (nearest
`fieldset > legend`, `.card-header`, labelled `section`/`role=region|group`, `section > header`, dialog
title, else the preceding heading) and the order within the section. Controls are matched by kind +
label (name as a fallback), same section first. Built-in tolerances (reported as notes): link vs
button, `name` attributes, checkbox/radio form values, `<input type=submit>` vs `<button>`, an
accessible name where phpMyAdmin has none. Our "BetterMyAdmin" reads as "phpMyAdmin" (X33,
`maps/_global.yaml`).

## Mapping differences: `maps/<case>.yaml`

Differences are fixed in the app, or mapped here with a reason; a label rename needs a
parity-exception id from `docs/reference/parity-exceptions.md`.

```yaml
sections: { 'Create database': 'New database' }          # phpMyAdmin section → ours
ignoreOrder: ['Databases']                                 # or true
rules:
  - pma: { kind: textbox, label: 'Username:' }             # equivalence (rename)
    ours: { label: 'User name:' }
    exception: X33
  - pma: { label: GitHub, section: phpMyAdmin }            # phpMyAdmin has it, we do not
    n/a: environment — the reference runs from a git checkout
  - ours: { kind: select, name: lang }                     # we add it
    added: the reference is built without translations
  - match: { label: '/^(phpmyadmin|uip_pmadb)$/' }         # accept field differences
    ignore: [disabled, checked]
    reason: each app protects its own configuration storage
```

Selectors take `kind`, `label`, `name`, `section` (exact, or `/regex/flags`) and `step` (a step name,
`initial` after load). Rules that matched nothing are reported as warnings.

## Known gaps

- MySQL is shared: databases created by suites running concurrently show up in one app's lists and
  not the other's (navigation, Databases). Run the suite alone for a clean result.
- Our layout scrolls inside `#page_scroll`, so full-page screenshots of ours show the viewport only.
- Labels come from a DOM approximation of the accessible name, not the browser's accessibility tree.
