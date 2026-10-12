# @bettermyadmin/config

Every phpMyAdmin `$cfg` directive (449, from `src/Config/Settings.php` and `Settings/*.php`
at the reference commit), plus 15 BetterMyAdmin additions. All of them are typed, validated, and
loaded from **defaults ← config file ← environment**.

```ts
import { loadConfig, publicConfig } from '@bettermyadmin/config'

const { config, warnings, file } = await loadConfig() // throws ConfigError with every problem listed
config.Servers[1]?.host     // 'localhost'
config.MaxRows              // 25
publicConfig(config)        // allow-listed subset for GET /api/meta/config-public
```

## Config file

The loader looks in `cwd` for the first of `bettermyadmin.config.ts`, `.js`, `.mjs`, `.json`, `.yaml`, `.yml`.
You can also name the file with `loadConfig({ file })` or the `BMA_CONFIG` variable. A `.ts` or `.js` file is
loaded with a dynamic import. Its default export can be an object or a function that returns one (the function
may be async). Loading `.ts` needs Node ≥ 22.18 or a TS-aware runner.

```ts
import { defineConfig } from '@bettermyadmin/config'

export default defineConfig({
  blowfish_secret: 'dev-only-secret-change-me-32-bytes!!', // alias: `secret`
  Servers: [
    { host: 'mysql84', port: 3306, controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' },
    { host: 'mariadb11', verbose: 'MariaDB 11 (dev)' },
  ],
  DBG: { sql: true },
})
```

- **Names**: directives use their phpMyAdmin names. Groups nest the way they do in PHP (`Export.format`,
  `Servers[i].AllowDeny.order`, `DefaultTransformations.Substring`).
- **Servers**: indices are 1-based, as in phpMyAdmin. You can write `Servers` as an array (element 0 is
  server 1) or as an object keyed `1..n`. If no server is configured, there is one default server at index 1.
  Each entry gets the `Server.php` defaults on its own, so server 2 does not inherit from server 1. An entry
  with an empty `host` and an empty `verbose` is named `Server <i>`. A `Servers[0]` entry is ignored with a
  warning.
- **`null` means "not set"**, as with PHP `isset()`. The exception is the nullable directives (`ssl_*`,
  `control_*`).
- **Merging** works directive by directive inside groups. Lists replace the default.
  `DefaultTransformations.*` merge element by element. `DefaultFunctions` keeps the defaults for keys you don't
  set (`array_replace`).
- **Coercion**: only lossless PHP-style casts are applied: `'50'` → `50`, `3306` → `'3306'`, `0`/`1` → booleans.
  Legacy values that phpMyAdmin maps are accepted (`DefaultTabTable: 'browse'` → `/sql`, `RecodingEngine: 'mb'` →
  `mbstring`, `TablePrimaryKeyOrder: 'asc'` → `ASC`).
- **Stricter than phpMyAdmin**: phpMyAdmin silently replaces an invalid value with the default
  (`MaxRows = 0` → 25). We reject it with a readable error instead.
- **Unknown keys** fail, and the error names the nearest directive (Levenshtein):
  `MaxRow: unknown directive "MaxRow". Did you mean "MaxRows"?`. Directives that phpMyAdmin has removed
  (`DisplayBinaryAsHex`, `Servers[i].connect_type`, …) are accepted and ignored with a warning.
- **Secrets** (`blowfish_secret`, `password`, `controlpass`, `ProxyPass`, `URLQueryEncryptionSecretKey`,
  `CaptchaLoginPrivateKey`, `RedisUrl`) never appear in error messages.

## Environment

| Variable | Effect |
|---|---|
| `BMA__Servers__1__host=127.0.0.1` | any directive path, `__`-separated, 1-based server index |
| `BMA__Export__format=csv`, `BMA__DefaultFunctions__FUNC_UUID=UUID_SHORT`, `BMA__DefaultTransformations__Substring__1=10` | groups, map keys, tuple elements |
| `BMA__Listen='{"host":"0.0.0.0"}'`, `BMA__Servers__2='{"host":"b"}'` | JSON for a whole group or server |
| `BMA_HOST`, `BMA_PORT`, `BMA_USER`, `BMA_PASSWORD` | `Servers[1].host/port/user/password` (an explicit `BMA__` variable wins) |
| `BMA_ARBITRARY_SERVER`, `BMA_ABSOLUTE_URI` | `AllowArbitraryServer`, `PmaAbsoluteUri` |
| `BMA_CONFIG` | config file path |

Values are coerced according to the directive's type:

- booleans: `true/false/1/0/yes/no/on/off`
- integers: must be integers
- lists: JSON or comma-separated
- `string|false` table names: `false`
- nullable directives: `null`

## BetterMyAdmin additions (`flags.bma`)

| Directive | Default | Purpose |
|---|---|---|
| `DataDir` | `~/.bettermyadmin` | generated secret, SQLite session store, local metadata. `~` is not expanded here; the server resolves it |
| `SessionStore`, `RedisUrl` | `'sqlite'`, `''` | session store backend |
| `Listen.{host,port,basePath}` | `127.0.0.1`, `8080`, `/` | HTTP listener |
| `LoginRateLimit.{enabled,maxAttempts,windowSeconds,lockoutSeconds}` | `true, 5, 900, 300` | failed-login limiter (X2) |
| `ForceSSL` | `false` | honoured, unlike phpMyAdmin (X22) |
| `MaxUploadSize` | 512 MiB | upload limit (phpMyAdmin uses PHP's `upload_max_filesize`) |
| `Servers[i].max_connections` | `4` | mysql2 pool size |
| `Export.csv_escape_formulas` | `false` | CSV formula escaping (X3) |
| `Import.MaxDecompressedSize` | `0` (= 10 × `MaxUploadSize`) | decompression cap |

## Metadata

Every node in `configNode`/`directives` has `flags`:

- `secret`: listed above.
- `userPref`: matches phpMyAdmin's `UserFormList::getFields()` plus `ThemeDefault`.
- `clientVisible`: the user-pref directives plus `CLIENT_VISIBLE_EXTRA_PATHS`. Nothing under `Servers` and no
  secrets. This is an allow-list.
- `bma`: BetterMyAdmin additions.

The node also carries `type`, `values` (the enum values), the `default`, and a strict Zod `schema`.
`resolvedConfigSchema` validates a whole resolved config.

## Importing `config.inc.php`

```ts
import { importPmaConfig, validateConfig } from '@bettermyadmin/config'
const { config, warnings } = importPmaConfig(phpSource, { env: process.env })
validateConfig(config)
```

`importPmaConfig` parses and evaluates the PHP subset used in config files without running PHP. It handles:

- assignments, `$i++`, `foreach`, `if`
- strings with escapes and interpolation, numbers, `array()` and `[]`
- comments and `declare(strict_types=1)`
- a few functions: `getenv`, `isset`, `sodium_hex2bin`, …

PHP array key semantics are reproduced. Anything unsupported (`require`, functions, classes, heredoc) throws a
`PmaImportError` with the line and column. A `sodium_hex2bin('…')` secret is kept as its hex string.

## Verification against phpMyAdmin

- `scripts/dump-pma-defaults.php` runs phpMyAdmin's `Settings::asArray()` and `UserFormList::getFields()` →
  `test/fixtures/pma-defaults.json`.
- `scripts/dump-pma-configs.php` evaluates `test/fixtures/pma-configs/*.inc.php` with PHP. This covers
  phpMyAdmin's `config.sample.inc.php`, `examples/config.manyhosts.inc.php`, the e2e config, and a hand-written
  one. For each file it records the raw `$cfg` and the `Settings::asArray()` result →
  `test/fixtures/pma-configs.json`.

Regenerate both after bumping the reference commit with `PMA_ROOT=/path/to/phpmyadmin pnpm --filter @bettermyadmin/config fixtures:pma`.
The tests check three things against these dumps: our defaults, our importer's `$cfg`, and our loaded config.
They must match exactly (BetterMyAdmin additions are stripped before comparing).

```
pnpm vitest run --project unit packages/config
pnpm --filter @bettermyadmin/config typecheck
```
