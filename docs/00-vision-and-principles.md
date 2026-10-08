# BetterMyAdmin: vision and principles

BetterMyAdmin is a feature-for-feature rebuild of phpMyAdmin (pMA) in a modern stack with a modern UI. It is not "inspired by" phpMyAdmin. It is a clone: every tab, every option, every confirmation dialog, every link you can click on a cell, every config directive. The modern part is *how* it is built and *how it feels*, not *what* it does.

The source of truth for behaviour is phpMyAdmin `6.0.0-dev` at commit `e3e877e8` (2026-10-06). The feature docs in [`docs/features`](features/) were written by reading that code (controllers, Twig templates, TypeScript) and cite the files they describe. When this documentation and phpMyAdmin disagree, phpMyAdmin wins and the doc gets fixed.

## Why a clone and not a redesign

phpMyAdmin has 25 years of accumulated behaviours that its users rely on without thinking about them: clicking a foreign-key value jumps to the referenced row, the `~` prefix on an approximate row count, "Show all" being refused above a row threshold, double-clicking a cell to edit it, `Ctrl+Enter` running a query, the tree remembering which databases you expanded. Redesigns of admin tools usually lose a hundred of these and the users notice every one. The goal is that a phpMyAdmin power user can switch and find every habit still works, while a new user sees a clean, fast, keyboard-friendly interface.

## Non-negotiables

1. **Parity first.** A feature is done when every item in that area's "Micro-behaviours checklist" (in each `docs/features/*.md` file) passes. The checklists are the acceptance tests.
2. **At least as snappy as phpMyAdmin.** phpMyAdmin renders server-side HTML and swaps the main panel over AJAX. It feels instant on small pages. We must match it on first load and beat it on every interaction after that. Budgets are in [Performance](architecture/08-performance-and-snappiness.md).
3. **No feature is "too small."** The `Options` disclosure under a result set, the `Repeat headers after N cells` setting, the `Partial texts` toggle, the tooltip that shows a column comment: all of it ships.
4. **Compatible with existing phpMyAdmin installs.** BetterMyAdmin reads and writes the phpMyAdmin configuration storage (the `pmadb` tables: bookmarks, relations, display fields, column info, tracking, favorites, UI prefs, designer coordinates...) with the same schema, so a team can run both side by side against the same server and share metadata. See [Data and metadata model](architecture/06-data-and-metadata-model.md).
5. **Security at least as strong as phpMyAdmin.** Cookie-auth semantics (credentials encrypted, never stored in plain text in the browser), CSRF tokens, allow/deny rules, arbitrary-server restrictions, CSP, no password in URLs. See [Security](architecture/07-security.md).
6. **Modern, but not trendy.** shadcn/ui and Tailwind give a consistent, dense, accessible component set. Dense means admin-tool dense: a results grid shows as many rows as phpMyAdmin does on the same screen.

## What "modern technologies" means here

- TypeScript end to end, one language, shared types between server and client.
- A real SPA with URL-addressable state: every phpMyAdmin URL has an equivalent and deep links work.
- Streaming where phpMyAdmin buffers: exports stream to the browser, imports upload in chunks with resumable progress, the status monitor is a server-sent-events feed.
- Virtualized rendering for big grids and the navigation tree.
- A proper SQL tokenizer in the browser for highlighting, splitting, linting and autocomplete without round trips.
- Installable as a single command (`npx bettermyadmin`), a Docker image, or a static binary. No PHP, no web-server configuration.

The full stack rationale, including alternatives considered and rejected, is in [Tech stack](architecture/01-tech-stack.md).

## What we deliberately do not change

- Information architecture: Server / Database / Table scopes, the same tab names in the same order, the same left navigation tree.
- Terminology: "Browse", "Structure", "Operations", "Designer", "Query by example", "Central columns", "Tracking".
- Generated SQL: BetterMyAdmin emits the same SQL shapes phpMyAdmin does for the same user action (same quoting, same `ALTER TABLE` ordering, same export file structure). Export files produced by both should diff clean except for the header comment line that names the tool. This is tested, see [Testing and parity](architecture/11-testing-and-parity-strategy.md).
- Configuration surface: every `$cfg[...]` directive has an equivalent with the same name, type and default ([config reference](reference/config-directives.md)).

## How to read these docs

| You want to... | Read |
|---|---|
| Understand what we're building and why | this file, then [Tech stack](architecture/01-tech-stack.md) |
| Build a feature | the matching `docs/features/*.md` file, then [Frontend](architecture/03-frontend-architecture.md) and [Backend](architecture/04-backend-architecture.md) |
| Add an API endpoint | [API reference](architecture/05-api-reference.md) and [pMA route map](reference/pma-route-map.md) |
| Touch metadata (relations, bookmarks, prefs) | [Data and metadata model](architecture/06-data-and-metadata-model.md) and [Settings, preferences, pmadb](features/08-settings-preferences-pmadb.md) |
| Know what a config option does | [Config directives reference](reference/config-directives.md) |
| Decide if something is "done" | the Micro-behaviours checklist in the feature doc, plus [Testing and parity](architecture/11-testing-and-parity-strategy.md) |
| Set up a dev environment | [Development setup](architecture/14-development-setup.md) |
| Know what to build next | [Roadmap](architecture/13-roadmap-and-milestones.md) |
