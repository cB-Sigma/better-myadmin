/**
 * Configuration loading: defaults <- config file <- environment.
 *
 * pma: src/Config.php::loadFromFile (config.inc.php) — replaced by
 * `bettermyadmin.config.{ts,js,mjs,json,yaml,yml}` (parity exception X6).
 */
import { access, readFile } from 'node:fs/promises'
import { basename, isAbsolute, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { ENV_CONFIG_FILE, parseEnv } from './env.ts'
import { ConfigError } from './errors.ts'
import { type Layer, type ResolveResult, resolveLayers } from './resolve.ts'
import type { ConfigInput } from './schema.ts'

/** Config file names looked up in `cwd`, in this order. */
export const CONFIG_FILE_NAMES = [
  'bettermyadmin.config.ts',
  'bettermyadmin.config.js',
  'bettermyadmin.config.mjs',
  'bettermyadmin.config.json',
  'bettermyadmin.config.yaml',
  'bettermyadmin.config.yml',
] as const

export interface LoadConfigOptions {
  /**
   * Config file path (relative to `cwd`). `false` disables file loading. Default: the
   * `BMA_CONFIG` variable, else the first existing {@link CONFIG_FILE_NAMES} entry in `cwd`
   * (no file is fine: defaults + env).
   */
  file?: string | false
  /** Environment to read overrides from. Default `process.env`; pass `{}` to ignore it. */
  env?: Readonly<Record<string, string | undefined>>
  /** Directory for relative paths and config file lookup. Default `process.cwd()`. */
  cwd?: string
}

export interface LoadedConfig extends ResolveResult {
  /** Absolute path of the config file that was read, if any. */
  file: string | undefined
}

/**
 * Identity helper giving autocomplete and type checking over every directive:
 *
 * ```ts
 * import { defineConfig } from '@bettermyadmin/config'
 * export default defineConfig({ Servers: [{ host: 'db', port: 3306 }], MaxRows: 50 })
 * ```
 */
export function defineConfig<const T extends ConfigInput>(config: T): T {
  return config
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function findConfigFile(cwd: string): Promise<{ file: string | undefined; warnings: string[] }> {
  const found: string[] = []
  for (const name of CONFIG_FILE_NAMES) {
    const p = resolvePath(cwd, name)
    if (await exists(p)) found.push(p)
  }
  const warnings =
    found.length > 1
      ? [
          `several config files found (${found.map((f) => basename(f)).join(', ')}); using ${basename(found[0] as string)}`,
        ]
      : []
  return { file: found[0], warnings }
}

/** Reads a config file into a raw (unvalidated) object. */
export async function readConfigFile(file: string): Promise<unknown> {
  const name = basename(file)
  const lower = name.toLowerCase()
  if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (e) {
      // pma: src/Config.php::loadFromFile (English: the configuration loads before the language)
      const message =
        (e as NodeJS.ErrnoException).code === 'EACCES'
          ? `Existing configuration file (${file}) is not readable.`
          : `cannot read config file: ${(e as Error).message}`
      throw new ConfigError([{ path: '', message, source: name }])
    }
    try {
      return lower.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
    } catch (e) {
      throw new ConfigError([{ path: '', message: `syntax error: ${(e as Error).message}`, source: name }])
    }
  }
  if (/\.(c|m)?(t|j)s$/.test(lower)) {
    let mod: { default?: unknown }
    try {
      mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      const hint =
        err.code === 'ERR_UNKNOWN_FILE_EXTENSION' && lower.endsWith('ts')
          ? ' (this Node.js version cannot import TypeScript; use Node >= 22.18, run through tsx, or use a .js/.json/.yaml config)'
          : ''
      throw new ConfigError([
        { path: '', message: `cannot load config module: ${err.message}${hint}`, source: name },
      ])
    }
    let value = mod.default
    if (typeof value === 'function') value = await (value as () => unknown)()
    if (value === undefined) {
      throw new ConfigError([{ path: '', message: 'config module has no default export', source: name }])
    }
    return value
  }
  throw new ConfigError([
    {
      path: '',
      message: `unsupported config file type; expected one of ${CONFIG_FILE_NAMES.join(', ')}`,
      source: name,
    },
  ])
}

/**
 * Loads the configuration: defaults <- config file <- environment. Throws {@link ConfigError}
 * listing every unknown directive (with the nearest known name) and invalid value.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const warnings: string[] = []
  let file: string | undefined
  if (options.file !== false) {
    const explicit = options.file ?? env[ENV_CONFIG_FILE]
    if (explicit !== undefined && explicit !== '') {
      file = isAbsolute(explicit) ? explicit : resolvePath(cwd, explicit)
      if (!(await exists(file))) {
        throw new ConfigError([{ path: '', message: `config file not found: ${file}` }])
      }
    } else {
      const found = await findConfigFile(cwd)
      file = found.file
      warnings.push(...found.warnings)
    }
  }

  const layers: Layer[] = []
  if (file !== undefined) layers.push({ value: await readConfigFile(file), label: basename(file) })
  const envLayer = parseEnv(env)
  layers.push({ value: envLayer.value, label: 'environment', origins: envLayer.origins })

  let result: ResolveResult
  try {
    result = resolveLayers(layers, envLayer.issues)
  } catch (e) {
    if (e instanceof ConfigError && file !== undefined) {
      throw new ConfigError(e.issues, `Invalid BetterMyAdmin configuration (${file})`)
    }
    throw e
  }
  return { config: result.config, warnings: [...warnings, ...result.warnings], file }
}
