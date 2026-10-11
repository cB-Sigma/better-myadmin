# tools/upstream

Keeps BetterMyAdmin in step with phpMyAdmin after the original reference commit.
Process: [docs/architecture/15-upstream-sync.md](../../docs/architecture/15-upstream-sync.md).

```bash
pnpm upstream:check --fetch     # what is new upstream, classified by feature area
pnpm upstream:check --gate      # CI: every commit up to the pinned reference has a ledger decision
```
