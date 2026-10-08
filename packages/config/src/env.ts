/**
 * Environment overrides.
 *
 *   BMA__<Directive>[__<SubDirective>...]=value    e.g. BMA__Servers__1__host=127.0.0.1
 *                                                       BMA__Export__format=csv
 *                                                       BMA__DefaultFunctions__FUNC_UUID=UUID_SHORT
 *
 * Path segments are separated by a double underscore, server indices are 1-based, values are
 * coerced by the directive's type (booleans: true/false/1/0/yes/no/on/off; lists: JSON or
 * comma-separated; objects and tuples: JSON). A group (e.g. `BMA__Listen`) or a server entry
 * accepts a JSON object.
 *
 * Shortcuts (applied first, so an explicit `BMA__...` variable wins):
 *   BMA_HOST, BMA_PORT, BMA_USER, BMA_PASSWORD -> Servers[1].host / port / user / password
 *   BMA_ARBITRARY_SERVER -> AllowArbitraryServer, BMA_ABSOLUTE_URI -> PmaAbsoluteUri
 */
import type { ConfigIssue } from './errors.ts'
import { type AnyNode, EnvValueError, type GroupNode, type LeafNode, eJson } from './nodes.ts'
import { suggestFor } from './resolve.ts'
import { configNode } from './schema.ts'

export const ENV_PREFIX = 'BMA__'

/** Shortcut variables and the directive path each one sets. */
export const ENV_SHORTCUTS: Readonly<Record<string, readonly string[]>> = {
  BMA_HOST: ['Servers', '1', 'host'],
  BMA_PORT: ['Servers', '1', 'port'],
  BMA_USER: ['Servers', '1', 'user'],
  BMA_PASSWORD: ['Servers', '1', 'password'],
  BMA_ARBITRARY_SERVER: ['AllowArbitraryServer'],
  BMA_ABSOLUTE_URI: ['PmaAbsoluteUri'],
}

/** Variable naming the config file (used by `loadConfig` when `file` is not given). */
export const ENV_CONFIG_FILE = 'BMA_CONFIG'

export interface EnvLayer {
  value: Record<string, unknown>
  /** Dotted directive path -> `env NAME`, for error messages. */
  origins: Map<string, string>
  issues: ConfigIssue[]
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cur = target
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i] as string
    const next = cur[k]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[path[path.length - 1] as string] = value
}

function findField(node: GroupNode, seg: string): string | undefined {
  const fields = node.fields as Record<string, AnyNode>
  if (Object.hasOwn(fields, seg)) return seg
  for (const [k, child] of Object.entries(fields)) if (child.opts.aliases?.includes(seg)) return k
  const lower = seg.toLowerCase()
  const ci = Object.keys(fields).filter((k) => k.toLowerCase() === lower)
  return ci.length === 1 ? ci[0] : undefined
}

type Target =
  | { ok: true; path: string[]; node: AnyNode; sub: string | undefined }
  | { ok: false; path: string; message: string }

function resolveEnvPath(segs: readonly string[]): Target {
  let node: AnyNode = configNode
  const path: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] as string
    if (seg === '') return { ok: false, path: path.join('.'), message: 'empty path segment' }
    if (node.kind === 'group') {
      const k = findField(node, seg)
      if (k === undefined) {
        const hint = suggestFor(node, path, seg)
        return {
          ok: false,
          path: [...path, seg].join('.'),
          message: `unknown directive "${seg}".${hint ? ` ${hint}` : ''}`,
        }
      }
      path.push(k)
      node = (node.fields as Record<string, AnyNode>)[k] as AnyNode
    } else if (node.kind === 'servers') {
      if (!/^[1-9]\d*$/.test(seg)) {
        return {
          ok: false,
          path: [...path, seg].join('.'),
          message: `expected a 1-based server index, got ${JSON.stringify(seg)}`,
        }
      }
      path.push(seg)
      node = node.server
    } else {
      const leaf: LeafNode = node
      if ((leaf.type === 'record' || leaf.type === 'tuple') && i === segs.length - 1) {
        if (leaf.type === 'tuple' && !/^\d+$/.test(seg)) {
          return { ok: false, path: [...path, seg].join('.'), message: 'expected a list index' }
        }
        return { ok: true, path, node, sub: seg }
      }
      return {
        ok: false,
        path: [...path, seg].join('.'),
        message: `"${path.join('.')}" has no sub-directives`,
      }
    }
  }
  return { ok: true, path, node, sub: undefined }
}

function parseValue(node: AnyNode, sub: string | undefined, raw: string): unknown {
  if (node.kind !== 'leaf') return eJson(raw)
  if (sub !== undefined) return raw // record value / tuple element: coerced later by the leaf
  return node.fromEnv(raw)
}

/** Builds a configuration layer from environment variables. Never throws; see `issues`. */
export function parseEnv(env: Readonly<Record<string, string | undefined>>): EnvLayer {
  const value: Record<string, unknown> = {}
  const origins = new Map<string, string>()
  const issues: ConfigIssue[] = []

  const apply = (name: string, segs: readonly string[], raw: string): void => {
    const t = resolveEnvPath(segs)
    if (!t.ok) {
      issues.push({ path: t.path, message: t.message, source: `env ${name}` })
      return
    }
    let v: unknown
    try {
      v = parseValue(t.node, t.sub, raw)
    } catch (e) {
      if (!(e instanceof EnvValueError)) throw e
      const secret = t.node.flags.secret
      issues.push({
        path: t.path.join('.'),
        message: secret ? e.message.replace(/, got .*$/, ' (value hidden)') : e.message,
        source: `env ${name}`,
      })
      return
    }
    const full = t.sub === undefined ? t.path : [...t.path, t.sub]
    setPath(value, full, v)
    origins.set(full.join('.'), `env ${name}`)
    origins.set(t.path.join('.'), `env ${name}`)
  }

  for (const [name, segs] of Object.entries(ENV_SHORTCUTS)) {
    const raw = env[name]
    if (raw !== undefined) apply(name, segs, raw)
  }
  const explicit = Object.keys(env)
    .filter((k) => k.startsWith(ENV_PREFIX) && env[k] !== undefined)
    .sort()
  for (const name of explicit) apply(name, name.slice(ENV_PREFIX.length).split('__'), env[name] as string)

  return { value, origins, issues }
}
