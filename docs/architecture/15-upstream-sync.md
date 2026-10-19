# Upstream sync

BetterMyAdmin is specified against one phpMyAdmin commit (`docs/reference/reference-commit.txt`). phpMyAdmin keeps moving, so we keep following it: every upstream commit gets a recorded decision, and the pin moves forward regularly so the docs, fixtures, inventories and the reference instance always describe a recent phpMyAdmin.

## Cadence

- **Daily check:** a scheduled routine runs `pnpm upstream:check --fetch` and reports new commits by feature area. Behaviour commits are ported promptly. Translation, dependency and tooling commits are batched into the next sync.
- **Sync:** whenever behaviour commits are pending, and at least weekly. A sync moves the pin to the newest upstream commit that passed upstream CI.

## What counts

`tools/upstream/areas.ts` classifies each changed file:

| Kind | Examples | Action |
|---|---|---|
| behaviour | `src/**`, `resources/templates/**`, `resources/js/**`, `public/themes/**`, `resources/sql/**`, `app/**` | Read the diff. Port it (code + feature doc + parity case) or record why it does not apply |
| translations | `resources/po/**` | `pnpm i18n:import`, run i18n parity |
| dependencies | `composer.lock` (`phpmyadmin/sql-parser`, `williamdes/mariadb-mysql-kbs`, …), `yarn.lock` | sql-parser: diff its two versions and port to `packages/sql-lexer`, regenerate its fixtures with the new version. kbs: re-vendor `packages/kbs` |
| tooling / tests / docs | CI, static analysis, release scripts, PHPUnit-only changes | Usually not applicable, but new or changed PHPUnit expectations are imported into our fixtures |

## Sync procedure

1. `pnpm upstream:check --fetch` lists the commits after the pin.
2. For each behaviour commit: read the diff, change our code and the matching `docs/features/*` text and checklist, and add or adjust a golden parity case that would fail without the change.
3. Update the reference: check out the new commit in the reference phpMyAdmin (`docker/pma-ref` build arg `PMA_COMMIT`, or the local checkout), then run `composer install` and `yarn install`.
4. Regenerate everything derived from phpMyAdmin's code: each package's `scripts/*.php` fixtures, `pnpm parity:inventory`, and `pnpm i18n:import`. Any fixture diff is a behaviour change: port it, or explain it in the ledger.
5. Run `pnpm test`, `pnpm test:int` and `pnpm test:parity` against the new reference instance, plus `pnpm parity:check`.
6. Write a `tools/upstream/ledger.json` entry for every commit between the old and the new pin, `ported` or `not-applicable` with notes.
7. Update `docs/reference/reference-commit.txt` **and the `PMA_COMMIT` default** in `docker/pma-ref/Dockerfile` and the `x-pma-commit` anchor in `docker/dev.compose.yml` (they must equal the pin), then commit `chore(upstream): sync to <sha>`.

## Gate

`pnpm upstream:check --gate` (CI) fails when a commit between the original pin and the current pin has no ledger entry. The pin cannot move without a decision for every upstream commit it skips over.
