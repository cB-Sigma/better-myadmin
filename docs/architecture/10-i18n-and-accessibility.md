# Internationalisation and accessibility

## i18n

### Catalogue

phpMyAdmin ships 3,442 gettext source strings (`resources/po/phpmyadmin.pot`) and 97 locale `.po` files. We reuse them:

1. `packages/i18n/scripts/import-po.ts` converts every `.po` to Lingui's compiled catalogue format (`{msgid: translation}` plus plural forms), preserving `msgctxt` where phpMyAdmin uses it (`_pgettext`) and gettext plural rules per locale.
2. UI code uses Lingui macros with **the identical English msgid** wherever the UI text is the same as phpMyAdmin's. Example: `` t`Showing rows ${from} - ${to} (${total} total, Query took ${seconds} seconds.)` `` must match the pot's msgid exactly (placeholders are mapped by position in the import script: `%1$d` → `${0}` ...). A CI check (`pnpm i18n:parity`) extracts our msgids and reports those not present in the pot; new strings need an explicit `// i18n-new` annotation with a reason. This doubles as a parity guard: a string phpMyAdmin never had usually means a feature phpMyAdmin never had.
3. Strings specific to BetterMyAdmin (settings for new directives, the cancel-query button, chunked upload messages) live in our own `.pot` and are translated separately (Weblate project, same as phpMyAdmin's process).

### Runtime

- Locale selection order, identical to `LanguageManager::selectLanguage`: `Lang` directive (forced) → `lang` URL param → cookie `pma_lang` equivalent → `Accept-Language` best match → `DefaultLang` → `en`. `FilterLanguages` (regex) restricts the list offered.
- The login page and home page show the language selector exactly where phpMyAdmin shows it; the list uses each language's native name as in `LanguageManager::$languages`.
- Catalogues are code-split per locale and loaded before first render of the shell (the English fallback is inlined so there is never an untranslated flash).
- Number, date and byte formatting: `Util::formatNumber`, `Util::formatByteDown`, `Util::localisedDate`, `Util::timespanFormat` are ported into `packages/i18n/format.ts` with the same unit strings (`B`, `KiB`, `MiB`, `GiB`...), the same rounding rules and the same `%B %d, %Y at %I:%M %p` default `localisedDate` pattern, because those appear in parity screenshots (table sizes, uptime, "Query took 0.0004 seconds").
- RTL: Arabic, Hebrew, Persian, Urdu flip layout via `dir="rtl"` on `<html>`; Tailwind logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`) are mandatory in shared components (lint rule bans `ml-/mr-/pl-/pr-` in `packages/ui`). phpMyAdmin builds an `rtl.css` with `rtlcss`; we do not need a separate stylesheet.
- SQL, identifiers, MySQL error texts and server messages are never translated by us (MySQL translates its own messages per `lc_messages`).
- Doc links: MySQL/MariaDB documentation links are generated from the vendored knowledge base in the user's locale when the KB has it, else English, matching `MySQLDocumentation::getDocumentationLink`.

### Pluralisation and gender

Lingui ICU plurals map from gettext `nplurals`/`plural` expressions during import. Strings that phpMyAdmin leaves un-pluralised stay un-pluralised (parity over correctness; they can be fixed upstream first).

## Accessibility

Target: WCAG 2.2 AA across all themes, verified by axe in CI and by a manual keyboard pass per feature before it is marked done.

### Structure

- One `<h1>` per page (the breadcrumb's last item is visually the title), landmarks: `<nav aria-label="Navigation panel">`, `<main>`, `<aside aria-label="Console">`, `<header>`.
- Tab bars are links (`role="navigation"`), not ARIA tabs, because they change the URL.
- Dialogs trap focus and return it (Radix). Esc closes; destructive confirmations focus the *cancel* button by default.

### Grid

- `role="grid"`, `aria-rowcount`/`aria-colcount` reflect the full result (including virtualized rows), `aria-rowindex` on rendered rows.
- Roving `tabindex`: one tab stop for the grid; arrows move between cells, `Home/End`, `PageUp/PageDown`, `Ctrl+Home/End`. `Enter`/`F2` edit, `Esc` cancel, `Space` toggles the row checkbox, `Shift+Space` range-select, `Ctrl+C` copies the focused cell or selected cells (phpMyAdmin has the same cell-copy behaviour).
- Sort state announced via `aria-sort` on headers. Column reorder drag also has a keyboard path through the header menu ("Move left / Move right").
- Cell editors are labelled with the column name; NULL checkbox is a real checkbox with a label.
- Live region (`aria-live="polite"`) announces "Showing rows X to Y of Z" after a page change and the result of a save/delete.

### Tree

- `role="tree"` / `treeitem` / `group` with `aria-expanded`, `aria-level`, `aria-setsize`/`aria-posinset` for virtualized items; arrow keys expand/collapse/move, type-ahead by first letters, `*` expands all siblings. The fast filter is a labelled `search` input.

### Forms

- Every control has a visible label or `aria-label`; help text linked via `aria-describedby`; errors via `aria-invalid` + `aria-errormessage`.
- Type dropdowns (column types with hundreds of options) are Comboboxes with listbox semantics and type-to-filter.

### Colour and motion

- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components in every theme (token sets are validated by a script with the dark variants).
- Data-type colouring is never the only signal: NULL is also italic and literally reads "NULL", links are underlined on hover and have `role=link`.
- `prefers-reduced-motion` honoured; `prefers-contrast: more` switches to a high-contrast token set.

### Keyboard shortcuts

All phpMyAdmin shortcuts work (table in [Shell, navigation, auth](../features/01-shell-navigation-auth.md#keyboard-shortcuts-table)), shown in a `?` help overlay. Shortcuts use `Ctrl+Alt` combos like phpMyAdmin to avoid clashing with browser/OS keys; single-key shortcuts are only active when focus is in the grid or tree.

### Testing

- axe-core runs on every e2e page visit and fails on serious/critical issues.
- A keyboard-only Playwright suite exercises: login → tree → browse → edit a cell → save → open SQL tab → run → export dialog → submit, without a single mouse event.
- Screen reader smoke tests (VoiceOver/NVDA) are part of the release checklist, not CI.
