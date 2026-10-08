# UI design system

Modern UI, phpMyAdmin behaviour. This document sets the visual language, the density rules, the component mapping from phpMyAdmin widgets to shadcn/ui, theming, iconography, and the layout of the shell. It exists so that fifty screens built by different people look like one product and still put every control where a phpMyAdmin user expects it.

## Principles

1. **Dense by default.** This is a tool used for hours. Grid rows are 28 px, form rows 32 px, base font 13 px in data areas and 14 px in prose. Whitespace is for grouping, not decoration.
2. **Same place, same name.** Tabs, buttons, links and options keep phpMyAdmin's labels (translated via the same catalogue) and relative positions. Users should be able to follow a phpMyAdmin tutorial in BetterMyAdmin.
3. **Everything visible is actionable or informative.** No hero banners, no empty-state illustrations larger than an icon.
4. **Keyboard first-class.** Every action reachable by keyboard; focus rings always visible when navigating by keyboard (`:focus-visible`).
5. **Calm colour.** One accent colour, semantic colours for success/notice/error only, and data-type tinting in the grid (NULL italic grey, numbers right-aligned, binary monospace) exactly as phpMyAdmin hints them.

## Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Top bar: breadcrumb (server › db › table [comment])      user ▾ ⚙ ? │
├───────────┬───────────────────────────────────────────────────────────┤
│ Nav panel │ Tab bar: [Browse] [Structure] [SQL] [Search] ... [More ▾] │
│ logo+links│───────────────────────────────────────────────────────────│
│ server ▾  │ Page content (scrolls independently)                      │
│ recent/fav│                                                           │
│ filter    │                                                           │
│ tree      │                                                           │
│ (virtual) │                                                           │
│           │                                                           │
├───────────┴───────────────────────────────────────────────────────────┤
│ Console drawer (collapsed to a 28 px bar; drag to resize)             │
└───────────────────────────────────────────────────────────────────────┘
```

- Nav panel: default 240 px (`NavigationWidth`), drag-resizable, collapsible to an icon rail with the same quick links; width persisted.
- The tab bar sits inside the content column (phpMyAdmin puts it there too), sticky at the top of the content scroll.
- Content column max width is unbounded (grids need the space); forms use a 720 px measure.
- Below 1024 px the nav panel becomes an overlay drawer; phpMyAdmin has no real mobile layout, we provide a usable one but it is not a parity target.

## Typography

- UI font: `Inter` (variable, self-hosted) with `font-feature-settings: "tnum"` in grids for aligned numbers.
- Monospace: `JetBrains Mono` for SQL, binary/hex, JSON, code cells.
- Scale: 11 (badges), 12 (grid meta, tooltips), 13 (grid cells, dense forms), 14 (body, labels), 16 (page titles), 20 (home page headings). Line heights 1.3 in grids, 1.5 in prose.

## Colour tokens

CSS variables on `:root`, overridden per theme and per colour scheme. Names are semantic, not literal.

```
--bg, --bg-subtle, --bg-elevated, --bg-inset
--fg, --fg-muted, --fg-subtle, --fg-on-accent
--border, --border-strong
--accent, --accent-hover, --accent-fg
--success, --success-bg, --notice, --notice-bg, --error, --error-bg
--grid-header-bg, --grid-row-odd, --grid-row-even, --grid-row-hover (BrowsePointer), --grid-row-marked (BrowseMarker), --grid-cell-edited
--data-null, --data-number, --data-binary, --data-link
--focus-ring
```

Built-in themes replicate phpMyAdmin's four (`pmahomme` default: blue-grey accent `#235a81`, light grey panels; `original`: the classic beige/blue; `metro`: flat high-contrast; `bootstrap`: Bootstrap 5 blue) as token sets, each with a dark variant. The Themes page shows them as cards with screenshots as phpMyAdmin does (`theme.json` name/version/description/supports fields are kept in our theme manifests).

Dark mode follows `prefers-color-scheme` unless the user picks a colour mode explicitly. phpMyAdmin master has per-theme colour modes selected manually and no automatic `prefers-color-scheme` switch, so the automatic default is an addition (X23); the manual selector is kept where phpMyAdmin has it. The Console's "Switch to dark theme" option darkens the console only, exactly as in phpMyAdmin.

## Iconography

Lucide icons, 16 px in grids and tab bars, 14 px inline in links. Mapping from phpMyAdmin's `s_*.png` / `b_*.png` icon set is a single table in `packages/ui/src/icons/pma-map.ts` so every place phpMyAdmin shows an icon shows the corresponding one here (e.g. `b_browse` → `Table`, `b_select` → `ListTree`, `b_insrow` → `Plus`, `b_empty` → `Eraser`, `b_drop` → `Trash2`, `b_edit` → `Pencil`, `b_primary` → `Key`, `b_unique` → `KeySquare`, `b_index` → `ListOrdered`, `b_spatial` → `Globe`, `b_ftext` → `TextSearch`, `s_db` → `Database`, `s_tbl` → `Table2`, `s_views` → `Eye`, `b_routines` → `FunctionSquare`, `b_events` → `CalendarClock`, `b_triggers` → `Zap`, `s_process` → `Activity`, `s_rights` → `Shield`, `b_export` → `Download`, `b_import` → `Upload`, `s_sortable` → `ArrowUpDown`, `s_asc`/`s_desc` → `ArrowUp`/`ArrowDown`, `s_info` → `Info`, `s_okay` → `CheckCircle2`, `s_error` → `XCircle`, `s_notice` → `AlertTriangle`, `b_favorite` → `Star`, `b_no_favorite` → `Star` outline, `hide` → `EyeOff`, `s_reload` → `RefreshCw`, `b_home` → `Home`, `s_loggoff` → `LogOut`, `b_help` → `CircleHelp`, `s_cog` → `Settings`). `ActionLinksMode` (`icons` / `text` / `both`) and `TableNavigationLinksMode` are honoured by every `IconLink`.

## Component mapping

| phpMyAdmin widget | BetterMyAdmin component (shadcn base) | Notes |
|---|---|---|
| Bootstrap card with header (`.card`) | `Panel` (custom, Card) | title row with optional right-side actions |
| Collapsible "Options" / `InitialSlidersState` sliders | `Disclosure` (Collapsible) | state follows `InitialSlidersState` (`open`/`closed`/`disabled`) |
| Tab menu (`.nav-tabs`) | `TabBar` (Tabs, link-based) | overflow → "More" DropdownMenu |
| Breadcrumb `#floating_menubar` | `Breadcrumb` | |
| `.alert-success/.alert-primary/.alert-danger` message with SQL | `SqlMessage` | icon, text, SQL block (`SqlCode`), action links |
| `ajaxShowMessage` toast | `Toaster` (Sonner) | 5 s auto-dismiss for success, sticky for errors |
| `confirm()` / `confirmLink` | `ConfirmDialog` (AlertDialog) | honours `Confirm` directive; destructive button red |
| Bootstrap modal (`#modal`) | `Dialog` | sizes sm/md/lg/full |
| jQuery UI dialog for FK browse, GIS editor | `Dialog` size lg | |
| `<select>` | `Select` for ≤ 12 options; `Combobox` (Command + Popover) with search above | FK dropdown uses Combobox |
| Multi-select `<select multiple>` (columns, tables) | `MultiSelect` (Command-based) with "Select all" | |
| Checkbox + "Check all" row | `CheckAllBar` | |
| "With selected:" action row | `WithSelectedBar` | buttons disabled until selection |
| Pagination block (`list_navigator.twig`) | `Pagination` | first/prev/select/next/last + rows-per-page input + "Show all" |
| `filter.twig` text filter | `FilterInput` | debounce 100 ms, highlights matches |
| Sortable table (`tablesorter`) | `DataTable` (TanStack Table, non-virtual) | for lists: structure, variables, processes, users |
| Results grid (`makegrid`) | `DataGrid` (TanStack Table + Virtual) | see frontend doc |
| CodeMirror textarea | `SqlEditor` | |
| jQuery UI datetimepicker | `DateTimeField` | calendar + time + fractional seconds + "now" |
| Tooltip (`title`, `.pma_hint`) | `Tooltip` | 300 ms delay, also on focus |
| `.pma_table` zebra tables | `Table` with `zebra` variant | |
| Progress bar (import/upload) | `Progress` | |
| Form rows (`.form-group`) | `FormRow` (label left 220 px, control right) | dense admin forms, matches pMA's label/field layout |
| "Page-related settings" gear | `PageSettingsGear` (Popover + form renderer) | |
| Theme cards | `ThemeCard` | |
| Query result header (rows/time) | `ResultHeader` | |
| Help "?" links to docs | `DocLink`, `MySqlDocLink` | open in new tab |

## Forms

- `react-hook-form` + Zod. Labels left, controls right at ≥ 900 px; stacked below. Help text under the control in `--fg-muted`. Required markers only where MySQL requires.
- Validation messages appear inline on blur and on submit; server validation errors map back onto fields by path.
- Every form that generates SQL has **Preview SQL** (ghost button) and **Save/Go** (primary) in a sticky footer, matching phpMyAdmin's button pair. Preview opens a dialog with a read-only `SqlCode`.
- Enter in a single-line field submits; `Ctrl+Enter` in textareas.

## Grid specifics

- Header: 32 px, `--grid-header-bg`, sort indicator right of the label, column comment as `Info` icon with tooltip when `ShowBrowseComments`.
- Row: 28 px, zebra, hover (`BrowsePointerEnable`), marked on click (`BrowseMarkerEnable`), selected checkbox tint.
- Cells: left-aligned text, right-aligned numbers (`--data-number`), `NULL` italic `--data-null`, empty string shown as nothing (phpMyAdmin shows nothing too; the `Options` toggle cannot change that), binary in monospace, truncated text ends with `…` and has a title with the full text size, FK values as `--data-link` underlined on hover with the display-field tooltip.
- Edited cell: `--grid-cell-edited` background until saved (`SaveCellsAtOnce`).
- Inline editor appears in place with the same height; multi-line editors overlay below the cell.
- Row action cell: icons for Edit / Copy / Delete per `RowActionLinks` (`left`, `right`, `both`, `none`) with text when `ActionLinksMode` includes text.

## Motion

- 120 ms ease-out for disclosures, dialogs fade+scale 150 ms, toasts slide 200 ms. No motion on grid interactions. `prefers-reduced-motion` disables all.

## Accessibility baseline

Radix primitives give roles, focus management and keyboard patterns. Grid is `role="grid"` with roving tabindex, arrow-key cell navigation, `Enter` to edit, `Esc` to cancel, `Space` to toggle the row checkbox. Contrast AA across all themes, including dark variants (checked in CI with axe). Full detail in [i18n and accessibility](10-i18n-and-accessibility.md).

## What is intentionally *not* modern

- Confirmation dialogs for destructive actions remain modal and explicit. No "undo" toasts for DROP TABLE.
- Pagination remains explicit (first/prev/next/last + page select) rather than infinite scroll, because phpMyAdmin users navigate by page number and URL.
- The Console stays a bottom drawer, not a side panel.
