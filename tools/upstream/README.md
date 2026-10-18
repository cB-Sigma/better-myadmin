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
## Upstream history clone

The check reads history from `../ref/pma-upstream.git` when that exists, else from the reference
instance `../ref/pma`; both paths are relative to the main checkout, also when the check runs in a
linked worktree (found through `git rev-parse --git-common-dir`). It is a blobless bare clone, so fetching it is cheap and does not depend on
the reference checkout's git state:

```sh
git clone --bare --filter=blob:none --single-branch -b master \
  https://github.com/phpmyadmin/phpmyadmin.git ../ref/pma-upstream.git
git -C ../ref/pma-upstream.git config remote.origin.fetch '+refs/heads/master:refs/remotes/origin/master'
git -C ../ref/pma-upstream.git fetch origin
```
