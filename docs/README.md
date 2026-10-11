# BetterMyAdmin documentation

A feature-for-feature rebuild of [phpMyAdmin](https://github.com/phpmyadmin/phpmyadmin) in TypeScript, React and a modern UI, specified against phpMyAdmin `6.0.0-dev` commit `e3e877e8` (2026-10-06, see [reference-commit.txt](reference/reference-commit.txt)).

Start with [Vision and principles](00-vision-and-principles.md).

## Architecture (how we build it)

| # | Doc | What it covers |
|---|---|---|
| 01 | [Tech stack](architecture/01-tech-stack.md) | Every stack decision (D1–D14) with alternatives and rationale |
| 02 | [System architecture](architecture/02-system-architecture.md) | Components, request lifecycles, middleware chain, package map |
| 03 | [Frontend architecture](architecture/03-frontend-architecture.md) | Routes, search-param state, data layer, grid, editor, tree, shell, theming, hotkeys |
| 04 | [Backend architecture](architecture/04-backend-architecture.md) | Config, sessions, connection manager, query service, DDL/DML builders, metadata, export/import engines, monitor, errors |
| 05 | [API reference](architecture/05-api-reference.md) | Every endpoint, grouped by scope, with the phpMyAdmin route it replaces |
| 06 | [Data and metadata model](architecture/06-data-and-metadata-model.md) | Config layers, sessions, pmadb compatibility, relation resolution, row identity, type catalog |
| 07 | [Security](architecture/07-security.md) | Threat model, auth, CSRF, signed SQL, headers, injection, disclosure, CI checklist |
| 08 | [Performance and snappiness](architecture/08-performance-and-snappiness.md) | Budgets vs phpMyAdmin, techniques, CI gates |
| 09 | [UI design system](architecture/09-ui-design-system.md) | Layout, density, tokens, themes, icon map, component mapping from phpMyAdmin widgets to shadcn |
| 10 | [i18n and accessibility](architecture/10-i18n-and-accessibility.md) | Reusing phpMyAdmin's 97 locales, formatting parity, WCAG 2.2 AA plan |
| 11 | [Testing and parity strategy](architecture/11-testing-and-parity-strategy.md) | Definition of done, test layers, golden SQL/export diffs against phpMyAdmin |
| 12 | [Project structure and conventions](architecture/12-project-structure-and-conventions.md) | Monorepo layout, tooling, code and doc conventions |
| 13 | [Roadmap and milestones](architecture/13-roadmap-and-milestones.md) | M0–M5, risks |
| 14 | [Development setup](architecture/14-development-setup.md) | Getting a dev environment, common commands, feature workflow |
| 15 | [Upstream sync](architecture/15-upstream-sync.md) | Following phpMyAdmin after the reference commit: daily check, sync procedure, ledger gate |

## Features (what we build, exhaustively, from phpMyAdmin's source)

Each file documents one area control-by-control with citations to phpMyAdmin files, exact SQL shapes, the config directives involved, the pmadb tables touched, a flat **Micro-behaviours checklist** that serves as the acceptance list, and rebuild notes.

| # | Doc | Area |
|---|---|---|
| 01 | [Shell, navigation, auth](features/01-shell-navigation-auth.md) | Navigation tree, top bar and tabs, home page, login and auth plugins, 2FA, console, themes, languages, shortcuts, AJAX model, setup, middleware and security |
| 02 | [Browse and results grid](features/02-browse-results-grid.md) | The `/sql` pipeline and results display: header, pagination, sorting, options, cell rendering, FK traversal, grid editing, row actions, bulk actions, query result operations |
| 03 | [Insert/edit and transformations](features/03-insert-edit-transformations.md) | Insert/Edit form and widgets, FK browse popup, GIS editor, INSERT/UPDATE generation, all 27 transformation plugins |
| 04 | [Table level](features/04-table-level.md) | Structure, column form, create table, indexes, partitions, operations, maintenance, search, zoom search, find/replace, relation view, tracking, triggers, chart, GIS, normalization, views, privileges; data type catalog |
| 05 | [Database level](features/05-database-level.md) | Structure and bulk actions, databases list, operations, search, multi-table query, routines, events, triggers, tracking, designer, schema export, central columns, data dictionary |
| 06 | [Server level](features/06-server-level.md) | Status (overview, processes, queries, variables, monitor, advisor with all 55 rules), variables, charsets, engines, plugins, replication, binary log, user accounts and privileges catalog, user groups, home server blocks |
| 07 | [Export and import](features/07-export-import.md) | Export UI and pipeline, all 16 export plugins and options, import UI and all 7 import plugins, schema export |
| 08 | [Settings, preferences, pmadb](features/08-settings-preferences-pmadb.md) | Config layering and formats, Settings UI and validators, page settings matrix, 2FA, every pmadb table's DDL and semantics, relation/metadata resolution |
| 09 | [SQL editor and query pipeline](features/09-sql-editor-query-pipeline.md) | SQL tab, query box, bookmarks, history, execution pipeline step by step, statement analysis flags, autocomplete/lint/format |

## Reference

| Doc | What |
|---|---|
| [Config directives](reference/config-directives.md) | Every `$cfg` directive: type, default, allowed values, description, consumer |
| [phpMyAdmin route map](reference/pma-route-map.md) | All 195 phpMyAdmin routes and their BetterMyAdmin equivalent |
| [Parity exceptions](reference/parity-exceptions.md) | Intentional differences and phpMyAdmin source quirks, with our handling |
| [Glossary](reference/glossary.md) | Terms |
| [reference-commit.txt](reference/reference-commit.txt) | The phpMyAdmin commit these docs describe |

## How parity is tracked

The checklists in `features/*.md` are the acceptance criteria. Each item becomes an e2e test whose title is the checklist line; `pnpm parity:report` ticks items from test results. Generated SQL and export files are diffed against phpMyAdmin in CI (see [Testing and parity](architecture/11-testing-and-parity-strategy.md)). Known accepted differences live in [Parity exceptions](reference/parity-exceptions.md).
