# tools/upstream

Keeps BetterMyAdmin in step with phpMyAdmin after the original reference commit.
Process: [docs/architecture/15-upstream-sync.md](../../docs/architecture/15-upstream-sync.md).

```bash
pnpm upstream:check --fetch     # what is new upstream, classified by feature area
pnpm upstream:check --gate      # CI: every commit up to the pinned reference has a ledger decision
```

## Exceptions waiting for an upstream fix

A sync that brings in one of these fixes retires the exception: remove the code path, the
`tests/parity/allowed-diffs.yaml` entry and the special cases in the tests, strike the row in
`docs/reference/parity-exceptions.md` (like X38), and say so in the ledger entry of the commit.

| Exception | Upstream | Retire when |
|---|---|---|
| X40 (Edit privileges drops the grant option on MySQL ≥ 8.0.11) | [phpmyadmin/phpmyadmin#19605](https://github.com/phpmyadmin/phpmyadmin/issues/19605) | retire X40 when upstream fixes #19605: `generateQueriesForUpdatePrivileges` appends `WITH GRANT OPTION` to the GRANT. Then drop `grantOptionFix` in `packages/sql-gen/src/privileges.ts`, the `x40()` mapping in `packages/sql-gen/test/privileges.test.ts` (regenerate `privileges.json`), the X40 entry of `tests/parity/allowed-diffs.yaml` and the `x40` branches of `tests/parity/privileges.parity.test.ts` |
