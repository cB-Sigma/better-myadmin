/**
 * Layer normalisation, merging and validation (no I/O).
 *
 * pma: src/Config/Settings.php::__construct, ::setServers
 * pma: src/Config/Settings/Server.php::__construct
 *
 * Order: defaults <- layer 1 <- layer 2 ... Each layer is normalised first (unknown keys,
 * aliases, removed directives, `null` = unset, PHP-like lossless scalar casts), merged
 * directive by directive, and the merged result validated once with the strict Zod schema.
 */
import type { z } from 'zod'
import { serverDefaults } from './defaults.ts'
import { ConfigError, type ConfigIssue } from './errors.ts'
import { type AnyNode, type GroupNode, type LeafNode, defaultOf, isPlainObject } from './nodes.ts'
import {
  type ConfigInput,
  REMOVED_DIRECTIVES,
  type ResolvedConfig,
  USERPREF_PATHS,
  configNode,
  resolvedConfigSchema,
  serverNode,
} from './schema.ts'
import { type Candidate, isClose, nearest } from './suggest.ts'

/** One configuration source. */
export interface Layer {
  /** Raw (unvalidated) configuration object. */
  value: unknown
  /** Human-readable origin used in error messages, e.g. `bettermyadmin.config.ts`. */
  label: string
  /** Optional per-directive origin (dotted path -> label), e.g. the env variable name. */
  origins?: ReadonlyMap<string, string>
}

export interface ResolveResult {
  config: ResolvedConfig
  /** Non-fatal notices (removed directives, ignored `Servers[0]`, ...). */
  warnings: string[]
}

const SKIP = Symbol('skip')

interface Ctx {
  issues: ConfigIssue[]
  warnings: string[]
  label: string
  origins: ReadonlyMap<string, string> | undefined
  sources: Map<string, string>
}

const dotted = (path: readonly (string | number)[]): string => path.join('.')

function sourceOf(ctx: Ctx, path: readonly (string | number)[]): string {
  return ctx.origins?.get(dotted(path)) ?? ctx.label
}

function preview(v: unknown): string {
  let s: string
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v))
  } catch {
    s = String(v)
  }
  return s.length > 60 ? `${s.slice(0, 57)}...` : s
}

/** Template path (phpMyAdmin `/` notation with `Servers/*`). */
function templatePath(path: readonly (string | number)[]): string {
  const out: string[] = []
  for (let i = 0; i < path.length; i++) {
    out.push(String(path[i]))
    if (path[i] === 'Servers' && i === 0 && i + 1 < path.length) {
      out.push('*')
      i++
    }
  }
  return out.join('/')
}

function displayTemplate(tpl: string): string {
  return tpl.replace('/*/', '.<i>.').replaceAll('/', '.')
}

// ---------------------------------------------------------------------------
// Unknown-key suggestions
// ---------------------------------------------------------------------------

let globalCandidates: Candidate[] | undefined

function allCandidates(): Candidate[] {
  if (globalCandidates) return globalCandidates
  const out: Candidate[] = []
  const walk = (n: AnyNode): void => {
    if (n.path !== '') {
      const name = n.path.slice(n.path.lastIndexOf('/') + 1)
      if (name !== '*') out.push({ name, display: displayTemplate(n.path) })
    }
    if (n.kind === 'group') for (const c of Object.values(n.fields as Record<string, AnyNode>)) walk(c)
    else if (n.kind === 'servers') walk(n.server)
  }
  walk(configNode)
  globalCandidates = out
  return out
}

function siblingCandidates(node: GroupNode, prefix: readonly (string | number)[]): Candidate[] {
  const base = prefix.length === 0 ? '' : `${dotted(prefix)}.`
  const out: Candidate[] = []
  for (const [k, child] of Object.entries(node.fields as Record<string, AnyNode>)) {
    out.push({ name: k, display: `${base}${k}` })
    for (const a of child.opts.aliases ?? []) out.push({ name: a, display: `${base}${k}` })
  }
  return out
}

/** "Did you mean" text for an unknown key in `node` at `path`. */
export function suggestFor(node: GroupNode, path: readonly (string | number)[], key: string): string {
  const local = nearest(key, siblingCandidates(node, path))
  if (local && isClose(key, local.distance)) return `Did you mean "${local.candidate.display}"?`
  const global = nearest(key, allCandidates())
  if (global && isClose(key, global.distance) && (!local || global.distance < local.distance)) {
    return `Did you mean "${global.candidate.display}"?`
  }
  return local ? `Nearest directive: "${local.candidate.display}".` : ''
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function aliasTarget(node: GroupNode, key: string): string | undefined {
  for (const [k, child] of Object.entries(node.fields as Record<string, AnyNode>)) {
    if (child.opts.aliases?.includes(key)) return k
  }
  return undefined
}

function normalize(node: AnyNode, value: unknown, path: (string | number)[], ctx: Ctx): unknown {
  switch (node.kind) {
    case 'leaf':
      return node.coerce(value)
    case 'group':
      return normalizeGroup(node, value, path, ctx)
    case 'servers':
      return normalizeServers(value, path, ctx)
  }
}

function normalizeGroup(node: GroupNode, value: unknown, path: (string | number)[], ctx: Ctx): unknown {
  if (!isPlainObject(value)) {
    ctx.issues.push({
      path: dotted(path),
      message: `expected an object of directives, got ${preview(value)}`,
      source: sourceOf(ctx, path),
    })
    return SKIP
  }
  const fields = node.fields as Record<string, AnyNode>
  const out: Record<string, unknown> = {}
  for (const [rawKey, v] of Object.entries(value)) {
    let key = rawKey
    let child = Object.hasOwn(fields, key) ? fields[key] : undefined
    if (!child) {
      const target = aliasTarget(node, rawKey)
      if (target !== undefined) {
        // pma: Server.php::setControlHost etc. check the canonical name first
        if (Object.hasOwn(value, target) && value[target] !== null && value[target] !== undefined) {
          ctx.warnings.push(`${dotted([...path, rawKey])}: ignored because "${target}" is also set`)
          continue
        }
        key = target
        child = fields[target]
      }
    }
    const childPath = [...path, key]
    if (!child) {
      const tpl = templatePath(childPath)
      const removedIn = REMOVED_DIRECTIVES[tpl]
      if (removedIn !== undefined) {
        ctx.warnings.push(
          `${dotted(childPath)}: removed in phpMyAdmin ${removedIn}; ignored (${sourceOf(ctx, childPath)})`,
        )
        continue
      }
      const hint = suggestFor(node, path, rawKey)
      ctx.issues.push({
        path: dotted(childPath),
        message: `unknown directive "${rawKey}".${hint ? ` ${hint}` : ''}`,
        source: sourceOf(ctx, childPath),
      })
      continue
    }
    if (v === null || v === undefined) {
      // PHP isset() semantics: null means "not set" unless null is a legal value
      if (child.kind === 'leaf' && child.nullable && v === null) out[key] = null
      continue
    }
    const r = normalize(child, v, childPath, ctx)
    if (r !== SKIP) out[key] = r
  }
  return out
}

function normalizeServers(value: unknown, path: (string | number)[], ctx: Ctx): unknown {
  let entries: [string, unknown][]
  if (Array.isArray(value)) {
    // array form: element 0 is server 1
    entries = value.map((v, i) => [String(i + 1), v])
  } else if (isPlainObject(value)) {
    entries = []
    for (const [k, v] of Object.entries(value)) {
      if (!/^\d+$/.test(k)) {
        ctx.issues.push({
          path: dotted([...path, k]),
          message: `server index must be a positive integer (Servers are 1-based), got ${JSON.stringify(k)}`,
          source: sourceOf(ctx, [...path, k]),
        })
        continue
      }
      if (Number(k) < 1) {
        // pma: Settings.php::setServers skips keys < 1
        ctx.warnings.push(
          `${dotted([...path, k])}: ignored, server indices are 1-based (like phpMyAdmin) (${sourceOf(ctx, [...path, k])})`,
        )
        continue
      }
      entries.push([String(Number(k)), v])
    }
  } else {
    ctx.issues.push({
      path: dotted(path),
      message: `expected a list of servers or an object keyed by 1-based server index, got ${preview(value)}`,
      source: sourceOf(ctx, path),
    })
    return SKIP
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue
    const r = normalizeGroup(serverNode, v, [...path, k], ctx)
    if (r !== SKIP) out[k] = r
  }
  return out
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function merge(node: AnyNode, base: unknown, layer: unknown, path: (string | number)[], ctx: Ctx): unknown {
  switch (node.kind) {
    case 'leaf':
      ctx.sources.set(dotted(path), sourceOf(ctx, path))
      return mergeLeaf(node, base, layer)
    case 'group': {
      if (!isPlainObject(layer)) return base
      const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {}
      const fields = node.fields as Record<string, AnyNode>
      for (const [k, v] of Object.entries(layer)) {
        const child = fields[k]
        if (child) out[k] = merge(child, out[k], v, [...path, k], ctx)
      }
      return out
    }
    case 'servers': {
      if (!isPlainObject(layer)) return base
      const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {}
      for (const [k, v] of Object.entries(layer)) {
        // pma: every Servers[$i] is a new Server($server): defaults applied per entry
        out[k] = merge(serverNode, out[k] ?? serverDefaults(), v, [...path, k], ctx)
      }
      return out
    }
  }
}

function mergeLeaf(node: LeafNode, base: unknown, layer: unknown): unknown {
  switch (node.merge) {
    case 'replace':
      return structuredClone(layer)
    case 'elementwise': {
      if (!Array.isArray(layer) || !Array.isArray(base)) return structuredClone(layer)
      const out = [...base]
      for (let i = 0; i < Math.min(base.length, layer.length); i++) {
        const x = layer[i]
        if (x !== null && x !== undefined) out[i] = x
      }
      return out
    }
    case 'shallow':
      return isPlainObject(base) && isPlainObject(layer) ? { ...base, ...layer } : structuredClone(layer)
  }
}

// ---------------------------------------------------------------------------
// Validation messages
// ---------------------------------------------------------------------------

function leafAt(path: readonly (string | number)[]): { node: AnyNode; rest: (string | number)[] } {
  let node: AnyNode = configNode
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]
    if (node.kind === 'leaf') return { node, rest: path.slice(i) }
    if (node.kind === 'servers') {
      node = node.server
      continue
    }
    const next: AnyNode | undefined = (node.fields as Record<string, AnyNode>)[String(seg)]
    if (!next) return { node, rest: path.slice(i) }
    node = next
  }
  return { node, rest: [] }
}

function valueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let v = root
  for (const seg of path) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[String(seg)]
  }
  return v
}

const fmtValues = (values: readonly unknown[]): string => values.map((x) => JSON.stringify(x)).join(', ')

/** Human description of what a directive accepts. */
export function expectation(node: AnyNode): string {
  if (node.kind === 'group') return 'an object of directives'
  if (node.kind === 'servers') return 'a list of servers'
  if (node.opts.description) return node.opts.description
  switch (node.type) {
    case 'boolean':
      return 'true or false'
    case 'integer':
      return 'an integer'
    case 'string':
      return 'a string'
    case 'enum':
      return `one of ${fmtValues(node.values ?? [])}`
    case 'nullable-string':
      return 'a string or null'
    case 'nullable-boolean':
      return 'true, false or null'
    case 'table':
      return 'a table name (string) or false'
    case 'string-list':
      return node.values ? `a list of ${fmtValues(node.values)}` : 'a list of strings'
    case 'tuple':
      return `a list like ${JSON.stringify(node.default)}`
    case 'record':
      return 'an object of string values'
    case 'mixed':
      return node.values ? `one of ${fmtValues(node.values)}` : 'a value of the documented type'
  }
}

function friendly(issue: z.core.$ZodIssue, merged: unknown, ctx: Ctx): ConfigIssue {
  // the configuration is plain data: no symbol keys in a path
  const path = issue.path as (string | number)[]
  const { node, rest } = leafAt(path)
  const leafPath = path.slice(0, path.length - rest.length)
  const value = valueAt(merged, path)
  const secret = node.flags.secret
  const got = secret ? '(secret value hidden)' : preview(value)
  let message: string
  if ((issue.code === 'too_small' || issue.code === 'too_big') && issue.origin === 'number') {
    const bound = issue.code === 'too_small' ? `>= ${issue.minimum}` : `<= ${issue.maximum}`
    message = `must be ${bound}, got ${got}`
  } else if ((issue.code === 'too_small' || issue.code === 'too_big') && issue.origin === 'array') {
    message =
      issue.code === 'too_small'
        ? `must contain at least ${issue.minimum} item(s)`
        : `must contain at most ${issue.maximum} item(s)`
  } else {
    const at = rest.length > 0 ? ` (at ${rest.map((r) => `[${JSON.stringify(r)}]`).join('')})` : ''
    message = `expected ${expectation(node)}, got ${got}${at}`
  }
  const source = ctx.sources.get(dotted(leafPath)) ?? ctx.sources.get(dotted(path))
  return { path: dotted(path), message, ...(source !== undefined ? { source } : {}) }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Merges `defaults <- layers[0] <- layers[1] ...` and validates. Throws {@link ConfigError}. */
export function resolveLayers(
  layers: readonly Layer[],
  initialIssues: readonly ConfigIssue[] = [],
): ResolveResult {
  const issues: ConfigIssue[] = [...initialIssues]
  const warnings: string[] = []
  const sources = new Map<string, string>()
  const base = defaultOf(configNode) as Record<string, unknown>
  let merged: unknown = { ...base, Servers: {} }

  for (const layer of layers) {
    const ctx: Ctx = { issues, warnings, label: layer.label, origins: layer.origins, sources }
    if (layer.value === undefined || layer.value === null) continue
    const normalized = normalizeGroup(configNode, layer.value, [], ctx)
    if (normalized === SKIP) continue
    merged = merge(configNode, merged, normalized, [], ctx)
  }
  if (issues.length > 0) throw new ConfigError(issues)

  const cfg = merged as Record<string, unknown> & { Servers: Record<string, Record<string, unknown>> }
  // pma: Settings.php::setServers — no (valid) server configured means one default server
  if (Object.keys(cfg.Servers).length === 0) cfg.Servers = { 1: serverDefaults() as Record<string, unknown> }
  // pma: Settings.php::setServers — a server without host and verbose is named "Server %d"
  for (const [k, s] of Object.entries(cfg.Servers)) {
    if (s.host === '' && s.verbose === '') s.verbose = `Server ${k}`
  }

  const parsed = resolvedConfigSchema.safeParse(cfg)
  if (!parsed.success) {
    const ctx: Ctx = { issues, warnings, label: 'config', origins: undefined, sources }
    // one issue per path and message: zod 4 can report a union's failure once per option
    const found = parsed.error.issues.map((i) => friendly(i, cfg, ctx))
    const seen = new Set<string>()
    throw new ConfigError(
      found.filter((i) => {
        const key = `${i.path}\u0000${i.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
    )
  }
  const config = parsed.data as ResolvedConfig
  warnings.push(...userprefsDisallowWarnings(config))
  return { config, warnings }
}

/** Merges defaults with the given inputs (later wins) and validates. Throws {@link ConfigError}. */
export function resolveConfig(...inputs: ConfigInput[]): ResolvedConfig {
  return resolveLayers(inputs.map((value, i) => ({ value, label: `input #${i + 1}` }))).config
}

/** Validates a single input without throwing; returns issues instead. */
export function validateConfig(
  input: ConfigInput | unknown,
): { ok: true; config: ResolvedConfig; warnings: string[] } | { ok: false; issues: readonly ConfigIssue[] } {
  try {
    const r = resolveLayers([{ value: input, label: 'input' }])
    return { ok: true, config: r.config, warnings: r.warnings }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, issues: e.issues }
    throw e
  }
}

const userprefPathSet = new Set(USERPREF_PATHS)

function userprefsDisallowWarnings(cfg: ResolvedConfig): string[] {
  const out: string[] = []
  for (const p of cfg.UserprefsDisallow) {
    const tpl = p.replace(/^Servers?\/\d+\//, 'Servers/*/').replace(/^Server\//, 'Servers/*/')
    if (!userprefPathSet.has(tpl)) {
      out.push(`UserprefsDisallow: "${p}" is not a user-preference directive; it has no effect`)
    }
  }
  return out
}
