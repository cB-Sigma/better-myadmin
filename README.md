# BetterMyAdmin

A feature-for-feature rebuild of [phpMyAdmin](https://github.com/phpmyadmin/phpmyadmin) in TypeScript and React with a modern UI, specified against phpMyAdmin 6.0.0-dev commit `e3e877e8`.

Status: milestone M0 (foundations). You can log in with cookie auth, run queries in a bare SQL box and see results in a virtualized grid. Behaviour is checked against the reference phpMyAdmin by a golden parity harness. See the [roadmap](docs/architecture/13-roadmap-and-milestones.md).

Start with [docs/README.md](docs/README.md), then [docs/00-vision-and-principles.md](docs/00-vision-and-principles.md) and [development setup](docs/architecture/14-development-setup.md).

```bash
pnpm install
docker compose -f docker/dev.compose.yml up -d mysql84   # MySQL 8.4, root/root on :3306
pnpm --filter @bettermyadmin/web build
BMA_HOST=127.0.0.1 pnpm --filter @bettermyadmin/server start   # http://127.0.0.1:8080
```

Until a configuration file (`bettermyadmin.config.json`, `.ts`, …) exists, the setup script at `/setup` is open without a login, as phpMyAdmin's `setup/` is; the server prints a warning at start. Write a configuration file before exposing the server ([security](docs/architecture/07-security.md#authentication)).
