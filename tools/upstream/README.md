# tools/upstream

Keeps BetterMyAdmin in step with phpMyAdmin after the original reference commit.
Process: [docs/architecture/15-upstream-sync.md](../../docs/architecture/15-upstream-sync.md).

```bash
pnpm upstream:check --fetch     # what is new upstream, classified by feature area
pnpm upstream:check --gate      # CI: every commit up to the pinned reference has a ledger decision
```

## Upstream history clone

The check reads history from `../ref/pma-upstream.git` when that exists, else from the reference
instance `../ref/pma`. It is a blobless bare clone, so fetching it is cheap and does not depend on
the reference checkout's git state:

```sh
git clone --bare --filter=blob:none --single-branch -b master \
  https://github.com/phpmyadmin/phpmyadmin.git ../ref/pma-upstream.git
git -C ../ref/pma-upstream.git config remote.origin.fetch '+refs/heads/master:refs/remotes/origin/master'
git -C ../ref/pma-upstream.git fetch origin
```
