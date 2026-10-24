# How parity with phpMyAdmin is measured

BetterMyAdmin is specified against one phpMyAdmin commit (6.0.0-dev `2c66fc86`, see
[reference-commit.txt](reference/reference-commit.txt)) and verified automatically, so
"feature-for-feature" is a measured claim, not a slogan.

- **Inventories** are extracted from the phpMyAdmin reference checkout — its routes, Twig template
  controls, config directives, translation msgids and JavaScript AJAX behaviours — and every one is
  mapped to our implementation or to a recorded [exception](reference/parity-exceptions.md).
  `pnpm parity:check` gates this on every push; [coverage](reference/coverage/README.md) is 100% on
  all five dimensions plus the 707-item feature [checklist](reference/coverage/checklist.md).
- **Golden parity tests** (`pnpm test:parity`, `pnpm test:ui-parity`) open the same page or run the
  same request in a live phpMyAdmin and in BetterMyAdmin and compare them byte for byte (exports,
  SQL output, error messages) or control for control (every visible button, input and link), on
  MySQL 8.0/8.4 and MariaDB 10.11/11.4. These run nightly against the real reference; the
  deterministic suites (unit, integration on four database versions, e2e, UI parity) run on every
  push.
- **Upstream is tracked daily**: a routine classifies each new phpMyAdmin commit, ports behaviour
  changes, and records a decision for every commit in a [ledger](../tools/upstream/ledger.json), so
  the pin only moves forward with a decision for everything it skips.

Intentional differences from phpMyAdmin — a session-id-only cookie instead of an encrypted-password
cookie, rate limiting on by default, JavaScript instead of PHP code generation, charset conversion
that reports a clean error where phpMyAdmin raises a PHP fatal, and so on — are each listed with
their rationale in the [parity exceptions register](reference/parity-exceptions.md).

See also the [testing and parity strategy](architecture/11-testing-and-parity-strategy.md) and the
[upstream sync process](architecture/15-upstream-sync.md).
