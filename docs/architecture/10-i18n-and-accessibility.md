# Internationalisation and accessibility

## i18n

### Catalogue

phpMyAdmin's `resources/po/` holds the template `phpmyadmin.pot` (3,426 msgids, 3,442 `msgid` lines counting the header and the 15 `msgid_plural`s; 174 use `msgctxt`) and 96 locale `.po` files; `LanguageManager::$languageData` lists 97 languages (English has no `.po`). A release compiles them with `bin/generate-mo` (msgfmt) and then `bin/remove-incomplete-mo` deletes every `.mo` below **40 %** translated, and `LanguageManager` only offers locales whose `.mo` exists, so a release offers English plus **48** locales (at e3e877e8). We reuse them as is:

1. `pnpm i18n:import` (`packages/i18n/scripts/import-po.ts`, `PMA_ROOT` = a phpMyAdmin git checkout) writes `packages/i18n/po/<code>.po` for the shipped locales with exactly the entries msgfmt compiles (non-fuzzy, every `msgstr` filled, no obsolete `#~`), comments stripped, plus `po/phpmyadmin.pot` (msgids only), `src/generated/catalog-index.ts` (translation percentages = `app/language_stats.inc.php`, shipped list, source commit) and `src/generated/languages.ts` (`$languageData`, dumped by PHP). The trimmed PO files are the committed source; compiled catalogues are not committed: the web build compiles them with a Vite plugin into one lazily loaded chunk per locale, the server compiles a locale on first use. Current source: phpmyadmin/phpmyadmin `e3e877e8` (`resources/po` last changed in `e7e3f96a`, Weblate), 136,379 messages.
2. Keys are motranslator's: `msgid`, `msgid\0msgid_plural`, `msgctxt\x04msgid`. Msgids stay **byte-identical** to phpMyAdmin's, printf placeholders included (`Showing rows %1s - %2s`, `%s total`, `Query took %01.4f seconds.`), and are filled by a port of PHP `sprintf` exactly like `sprintf(__('…'), …)`. Lingui (`@lingui/core`) holds the compiled catalogues (every message an array, so its ICU compiler never touches gettext text) and the active locale; Lingui *macros* are not used because they generate ICU msgids/hashes that would not match the pot. In code: `t('Log in')`, `<Trans id="Welcome to %s" args={[…]} />`, `ngettext(…)`, `pgettext(…)` from `apps/web/src/lib/i18n.tsx`; on the server `tr.gettext(…)` with the request's `Translator`.
3. `pnpm i18n:parity` extracts every literal msgid passed to those functions in `apps/` and `packages/` and reports the ones not in the pot; new strings need an explicit `// i18n-new: <reason>` annotation. This doubles as a parity guard: a string phpMyAdmin never had usually means a feature phpMyAdmin never had.
4. Strings specific to BetterMyAdmin (settings for new directives, the cancel-query button, chunked upload messages) live in our own `.pot` and are translated separately (Weblate project, same as phpMyAdmin's process).

### Runtime

- Locale selection, identical to `LanguageManager::selectLanguage`: `Lang` directive (forced) → POST `lang` → GET `lang` → cookie `pma_lang` (ours: `bma_lang`, HttpOnly, 30 days, rewritten on every request like `LanguageAndThemeCookieSaving`) → each comma-separated `Accept-Language` entry in order (entries are **not** trimmed, so `de, fr` only matches `de`) → `User-Agent` → `DefaultLang` → `en`. An unsupported code is skipped and flagged ("Ignoring unsupported language code."). `FilterLanguages` is applied like `preg_grep('@…@')` (an invalid pattern means no filtering). Codes are matched case-insensitively; the selector option values are the lower-case codes (`pt_br`).
- The server selects the language per request (`GET /api/i18n` reports it and the list) and uses it for its own messages (query pipeline, login errors) and for `SET lc_messages = '<MySQL locale>'` on the connection (the 5th `$languageData` column; nothing is sent when it is empty), so MySQL's error texts follow the language like in phpMyAdmin.
- The login page (when `Lang` is empty and there is more than one language) and the home page show the language selector exactly where phpMyAdmin shows it; labels are `Native - English` (native names decoded from `$languageData`'s HTML entities, as the templates print them `|raw`), sorted by English name.
- Catalogues are code-split per locale and loaded before first render (English needs no catalogue, so there is never an untranslated flash). Changing the language swaps the catalogue and re-renders; phpMyAdmin reloads the page, the visible result is the same.
- Number, date and byte formatting: `Util::formatNumber`, `Util::formatByteDown`, `Util::localisedDate`, `Util::timespanFormat`, `Util::getFormattedMaximumUploadSize` and `Sanitize::convertBBCode` are ported into `packages/i18n/src/format.ts` / `bbcode.ts` with the same unit strings (`B`, `KiB`, `MiB`…), translated separators (`__('.')`, `__(',')`), PHP 8.3 `round()` pre-rounding and `number_format`/`printf` digit generation, verified against PHP output for 13 locales. `localisedDate` keeps phpMyAdmin's quirks: `%B`/`%A` become the *short* translated names, the rest goes through `strftime` in the C locale (PHP's `setlocale(0, 'de')` fails on glibc), default pattern `%B %d, %Y at %I:%M %p`.
- RTL: `Language::isRTL` is `ar, fa, he, ur` → `dir="rtl"` on `<html>`. Of those only Arabic and Hebrew are shipped (Persian is 22 %, Urdu 13 % translated). Tailwind logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`) are mandatory in shared components (lint rule bans `ml-/mr-/pl-/pr-` in `packages/ui`). phpMyAdmin builds an `rtl.css` with `rtlcss`; we do not need a separate stylesheet.
- SQL, identifiers and MySQL error texts are never translated by us (MySQL translates its own messages per `lc_messages`).
- Doc links: MySQL/MariaDB documentation links are generated from the vendored knowledge base in the user's locale when the KB has it, else English, matching `MySQLDocumentation::getDocumentationLink`.

### Pluralisation and gender

Plural forms are gettext's, evaluated exactly like phpMyAdmin's motranslator does: the `Plural-Forms` expression is stripped to `[n0-9:()?=!<>/%&| ]` and evaluated with symfony/expression-language semantics, and only a *numeric* result selects a form. Expressions that yield a boolean (`plural=n != 1;`, `plural=(n > 1);` — German, French, Spanish, Italian and most other two-form catalogues) therefore always select form 0: phpMyAdmin shows "5 Datensatz betroffen." in German, and so do we (parity over correctness; fix it upstream first). Strings that phpMyAdmin leaves un-pluralised stay un-pluralised.

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
