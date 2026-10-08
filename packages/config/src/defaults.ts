/**
 * Default configuration, one-to-one with phpMyAdmin's `Settings` defaults.
 *
 * pma: src/Config/Settings.php::asArray (with `new Settings([])`)
 * pma: src/Config/Settings/Server.php::asArray (with `new Server([])`)
 *
 * The values are derived from the directive tree in schema.ts; test/defaults.test.ts asserts
 * they equal test/fixtures/pma-defaults.json, which scripts/dump-pma-defaults.php produces by
 * running phpMyAdmin itself. Regenerate the fixture after bumping the reference commit.
 *
 * `Servers` semantics (pma: Settings.php::setServers):
 *  - indices are 1-based; with no `Servers` configured there is exactly one default server at
 *    index 1 (`localhost`, cookie auth);
 *  - every configured entry is filled with the `Server.php` defaults individually
 *    (`serverDefaults` below), so `Servers[2]` does not inherit from `Servers[1]`;
 *  - an entry whose `host` and `verbose` are both empty is named `Server <i>`.
 */
import { defaultOf } from './nodes.ts'
import { type ResolvedConfig, type ServerConfig, configNode, serverNode } from './schema.ts'

/** Defaults for one `Servers[i]` entry (including BetterMyAdmin's `max_connections`). */
export function serverDefaults(): ServerConfig {
  return defaultOf(serverNode) as ServerConfig
}

/** Fresh copy of the full default configuration. */
export function defaultConfig(): ResolvedConfig {
  return defaultOf(configNode) as ResolvedConfig
}

/** Frozen default configuration (read-only reference). */
export const defaults: Readonly<ResolvedConfig> = deepFreeze(defaultConfig())

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}
