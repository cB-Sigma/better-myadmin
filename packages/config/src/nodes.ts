/**
 * Directive tree building blocks.
 *
 * Every directive is a node carrying:
 *  - a strict Zod schema (the *resolved* type, what consumers read),
 *  - its default (mirrors phpMyAdmin's `Settings` setters),
 *  - a lenient `coerce` step mirroring the lossless part of PHP's scalar casts
 *    (`'4'` -> `4` for ints, `3306` -> `'3306'` for strings, `0|1` -> bool), applied to
 *    file / imported values before validation,
 *  - an env-string parser (`fromEnv`),
 *  - metadata flags (`secret`, `clientVisible`, `userPref`, `bma`).
 *
 * The tree is the single source for defaults, validation, env coercion, unknown-key
 * suggestions, the public allow-list and the camelCase mapping.
 */
import { z } from 'zod'

export type LeafType =
  | 'boolean'
  | 'integer'
  | 'string'
  | 'enum'
  | 'nullable-string'
  | 'nullable-boolean'
  | 'table'
  | 'string-list'
  | 'tuple'
  | 'record'
  | 'mixed'

export interface DirectiveFlags {
  /** Never logged, never sent to the client, redacted in error messages. */
  secret: boolean
  /** Included in `/api/meta/config-public` (allow-list). */
  clientVisible: boolean
  /** Can be overridden as a user preference (phpMyAdmin `UserFormList::getFields()` + custom-handled keys). */
  userPref: boolean
  /** BetterMyAdmin-only addition (not in phpMyAdmin's Settings.php). */
  bma: boolean
}

export interface NodeOptions {
  secret?: boolean
  bma?: boolean
  /** Alternative input names accepted for this directive (e.g. `control_host` for `controlhost`). */
  aliases?: readonly string[]
  description?: string
}

export type MergeMode = 'replace' | 'elementwise' | 'shallow'

export interface LeafNode<Z extends z.ZodTypeAny = z.ZodTypeAny, O extends boolean = boolean> {
  readonly kind: 'leaf'
  readonly type: LeafType
  readonly schema: Z
  readonly default: z.output<Z> | undefined
  readonly optional: O
  /** `null` is a real value (otherwise `null` means "unset", like PHP's `isset`). */
  readonly nullable: boolean
  /** Allowed values for enum-like directives (canonical values only). */
  readonly values: readonly unknown[] | undefined
  /** Accepted legacy spellings, mapped to canonical values. */
  readonly legacy: Readonly<Record<string, unknown>> | undefined
  readonly merge: MergeMode
  readonly coerce: (v: unknown) => unknown
  readonly fromEnv: (raw: string) => unknown
  readonly opts: NodeOptions
  flags: DirectiveFlags
  path: string
}

export interface GroupNode<F extends Record<string, AnyNode> = Record<string, AnyNode>> {
  readonly kind: 'group'
  readonly fields: F
  readonly opts: NodeOptions
  flags: DirectiveFlags
  path: string
}

export interface ServersNode<S extends GroupNode = GroupNode> {
  readonly kind: 'servers'
  readonly server: S
  readonly opts: NodeOptions
  flags: DirectiveFlags
  path: string
}

// biome-ignore lint/suspicious/noExplicitAny: variance helper for heterogeneous trees
export type AnyNode = LeafNode<any, any> | GroupNode<any> | ServersNode<any>

// ---------------------------------------------------------------------------
// Type-level mapping: resolved (output) and input shapes
// ---------------------------------------------------------------------------

type Simplify<T> = { [K in keyof T]: T[K] } & {}

// biome-ignore lint/suspicious/noExplicitAny: conditional type matching
type OptionalKeys<F> = { [K in keyof F]: F[K] extends LeafNode<any, true> ? K : never }[keyof F]

export type Out<N> = N extends LeafNode<infer Z, infer _O>
  ? z.output<Z>
  : N extends GroupNode<infer F>
    ? Simplify<
        { [K in Exclude<keyof F, OptionalKeys<F>>]: Out<F[K]> } & { [K in OptionalKeys<F>]?: Out<F[K]> }
      >
    : N extends ServersNode<infer S>
      ? Record<number, Out<S>>
      : never

/** Tuples merge element-wise, so any prefix / sparse subset of the elements may be given. */
type TupleIn<T extends readonly z.ZodTypeAny[]> = { [K in keyof T]?: z.input<T[K]> | null }

/** Input shape: everything optional; `null` means "not set" (PHP `isset` semantics). */
export type In<N> = N extends LeafNode<infer Z, infer _O>
  ? // biome-ignore lint/suspicious/noExplicitAny: tuple rest
    (Z extends z.ZodTuple<infer I extends readonly z.ZodTypeAny[], any> ? TupleIn<I> : z.input<Z>) | null
  : N extends GroupNode<infer F>
    ? { [K in keyof F]?: In<F[K]> }
    : N extends ServersNode<infer S>
      ? In<S>[] | Record<number, In<S>>
      : never

// ---------------------------------------------------------------------------
// Coercers
// ---------------------------------------------------------------------------

const INT_RE = /^[+-]?\d+$/

/** PHP-like lossless int cast: numeric strings and integral floats. */
export function cInt(v: unknown): unknown {
  if (typeof v === 'string' && INT_RE.test(v.trim())) return Number.parseInt(v.trim(), 10)
  return v
}

/** PHP-like lossless string cast: numbers become their decimal form. */
export function cStr(v: unknown): unknown {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return v
}

/** PHP-like bool cast restricted to the unambiguous 0/1 forms. */
export function cBool(v: unknown): unknown {
  if (v === 0 || v === '0' || v === '') return false
  if (v === 1 || v === '1') return true
  return v
}

const identity = (v: unknown): unknown => v

export class EnvValueError extends Error {}

export function eBool(raw: string): unknown {
  const s = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off', ''].includes(s)) return false
  throw new EnvValueError(`expected a boolean (true/false/1/0/yes/no/on/off), got ${JSON.stringify(raw)}`)
}

export function eInt(raw: string): unknown {
  if (INT_RE.test(raw.trim())) return Number.parseInt(raw.trim(), 10)
  throw new EnvValueError(`expected an integer, got ${JSON.stringify(raw)}`)
}

export function eJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new EnvValueError(`expected a JSON value, got ${JSON.stringify(raw)}`)
  }
}

const eStr = (raw: string): unknown => raw

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const NO_FLAGS = (): DirectiveFlags => ({ secret: false, clientVisible: false, userPref: false, bma: false })

interface LeafInit<Z extends z.ZodTypeAny, O extends boolean> {
  type: LeafType
  schema: Z
  default: z.output<Z> | undefined
  optional?: O
  nullable?: boolean
  values?: readonly unknown[] | undefined
  legacy?: Readonly<Record<string, unknown>> | undefined
  merge?: MergeMode
  coerce?: (v: unknown) => unknown
  fromEnv?: (raw: string) => unknown
  opts?: NodeOptions
}

export function leaf<Z extends z.ZodTypeAny, O extends boolean = false>(
  init: LeafInit<Z, O>,
): LeafNode<Z, O> {
  return {
    kind: 'leaf',
    type: init.type,
    schema: init.schema,
    default: init.default,
    optional: (init.optional ?? false) as O,
    nullable: init.nullable ?? false,
    values: init.values,
    legacy: init.legacy,
    merge: init.merge ?? 'replace',
    coerce: init.coerce ?? identity,
    fromEnv: init.fromEnv ?? eJson,
    opts: init.opts ?? {},
    flags: NO_FLAGS(),
    path: '',
  }
}

export interface IntOptions extends NodeOptions {
  min?: number
  max?: number
}

export function bool(def: boolean, opts: NodeOptions = {}): LeafNode<z.ZodBoolean, false> {
  return leaf({ type: 'boolean', schema: z.boolean(), default: def, coerce: cBool, fromEnv: eBool, opts })
}

export function int(def: number, opts: IntOptions = {}): LeafNode<z.ZodNumber, false> {
  let schema = z.number().int()
  if (opts.min !== undefined) schema = schema.min(opts.min)
  if (opts.max !== undefined) schema = schema.max(opts.max)
  return leaf({ type: 'integer', schema, default: def, coerce: cInt, fromEnv: eInt, opts })
}

export function str(def: string, opts: NodeOptions = {}): LeafNode<z.ZodString, false> {
  return leaf({ type: 'string', schema: z.string(), default: def, coerce: cStr, fromEnv: eStr, opts })
}

/** `string|int` input normalised to string (ports: phpMyAdmin casts with `(string)`). */
export function port(def: string, opts: NodeOptions = {}) {
  const schema = z.union([z.string(), z.number().int().nonnegative().transform(String)])
  return leaf({ type: 'string', schema, default: def, fromEnv: eStr, opts })
}

/** `string|null`, default `null`. */
export function nstr(opts: NodeOptions = {}) {
  return leaf({
    type: 'nullable-string',
    schema: z.string().nullable(),
    default: null,
    nullable: true,
    coerce: cStr,
    fromEnv: (raw) => (raw === 'null' ? null : raw),
    opts,
  })
}

/** `bool|null`, default `null`. */
export function nbool(opts: NodeOptions = {}) {
  return leaf({
    type: 'nullable-boolean',
    schema: z.boolean().nullable(),
    default: null,
    nullable: true,
    coerce: cBool,
    fromEnv: (raw) => (raw.trim().toLowerCase() === 'null' ? null : eBool(raw)),
    opts,
  })
}

/** pmadb table name: `string|false` (`''` = auto-detect, `false` = feature disabled). */
export function table(opts: NodeOptions = {}) {
  return leaf({
    type: 'table',
    schema: z.union([z.string(), z.literal(false)]),
    default: '',
    values: undefined,
    coerce: cStr,
    fromEnv: (raw) => (raw.trim().toLowerCase() === 'false' ? false : raw),
    opts,
  })
}

/** List of strings; env accepts JSON or comma-separated values. */
export function list(def: readonly string[], opts: NodeOptions = {}) {
  return leaf({
    type: 'string-list',
    schema: z.array(z.string()),
    default: [...def],
    coerce: (v) => (Array.isArray(v) ? v.map(cStr) : isIntKeyedObject(v) ? Object.values(v).map(cStr) : v),
    fromEnv: (raw) =>
      raw.trim().startsWith('[')
        ? eJson(raw)
        : raw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== ''),
    opts,
  })
}

/** Map of string to string. `merge: 'shallow'` mirrors `array_replace($defaults, $value)`. */
export function record(
  def: Readonly<Record<string, string>>,
  opts: NodeOptions & { merge?: MergeMode } = {},
) {
  return leaf({
    type: 'record',
    schema: z.record(z.string(), z.string()),
    default: { ...def },
    merge: opts.merge ?? 'replace',
    coerce: (v) =>
      Array.isArray(v) && v.length === 0
        ? {}
        : v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cStr(x)]))
          : v,
    opts,
  })
}

export interface OneOfOptions<A> extends NodeOptions {
  /** Legacy/alternative spellings accepted on input, mapped to canonical values. */
  legacy?: A
}

/**
 * String enum. Legacy spellings (phpMyAdmin's setter `match` arms, e.g. `browse` -> `/sql`)
 * are accepted on input and normalised.
 */
export function oneOf<
  const V extends readonly [string, ...string[]],
  const A extends Readonly<Record<string, V[number]>> = Record<never, V[number]>,
>(values: V, def: V[number], opts: OneOfOptions<A> = {}) {
  const base = z.enum(values as unknown as [V[number], ...V[number][]])
  const legacy = opts.legacy as Readonly<Record<string, V[number]>> | undefined
  const legacyKeys = legacy ? Object.keys(legacy) : []
  const schema = (legacyKeys.length > 0 && legacy
    ? z.union([base, z.enum(legacyKeys as [string, ...string[]]).transform((k) => legacy[k] as V[number])])
    : base) as unknown as z.ZodType<V[number], V[number] | Extract<keyof A, string>>
  const { legacy: _l, ...nodeOpts } = opts
  return leaf({
    type: 'enum',
    schema,
    default: def,
    values,
    legacy,
    coerce: cStr,
    fromEnv: eStr,
    opts: nodeOpts,
  })
}

/** Leaf with a hand-written schema (unions such as `bool|'sameorigin'`, tuples). */
export function custom<Z extends z.ZodTypeAny>(
  type: LeafType,
  schema: Z,
  def: z.output<Z>,
  extra: {
    values?: readonly unknown[]
    merge?: MergeMode
    coerce?: (v: unknown) => unknown
    fromEnv?: (raw: string) => unknown
    nullable?: boolean
  } & NodeOptions = {},
): LeafNode<Z, false> {
  const { values, merge, coerce, fromEnv, nullable, ...opts } = extra
  return leaf({
    type,
    schema,
    default: def,
    ...(values !== undefined ? { values } : {}),
    ...(merge !== undefined ? { merge } : {}),
    ...(coerce !== undefined ? { coerce } : {}),
    ...(fromEnv !== undefined ? { fromEnv } : {}),
    ...(nullable !== undefined ? { nullable } : {}),
    opts,
  })
}

/**
 * Fixed-size positional option list (`DefaultTransformations`). Merged element-wise like
 * phpMyAdmin's `Transformations` setters: every element that is set (non-null) replaces the
 * default at that position, the others keep their default.
 */
// biome-ignore lint/suspicious/noExplicitAny: any tuple schema
export function tuple<Z extends z.ZodTuple<any, any>>(
  schema: Z,
  def: z.output<Z>,
  elements: readonly ((v: unknown) => unknown)[],
  opts: NodeOptions = {},
): LeafNode<Z, false> {
  return leaf({
    type: 'tuple',
    schema,
    default: def,
    merge: 'elementwise',
    coerce: (v) => {
      const arr: unknown[] | undefined = Array.isArray(v)
        ? v
        : isIntKeyedObject(v)
          ? Object.entries(v).reduce<unknown[]>((acc, [k, x]) => {
              acc[Number(k)] = x
              return acc
            }, [])
          : undefined
      if (!arr) return v
      return Array.from({ length: arr.length }, (_, i) => {
        const x = arr[i]
        if (x === null || x === undefined) return x
        const c = elements[i]
        return c ? c(x) : x
      })
    },
    opts,
  })
}

/** Optional leaf with no default (absent from the resolved object unless set). */
export function optional<Z extends z.ZodTypeAny>(
  type: LeafType,
  schema: Z,
  extra: {
    coerce?: (v: unknown) => unknown
    fromEnv?: (raw: string) => unknown
    values?: readonly unknown[]
  } & NodeOptions = {},
): LeafNode<Z, true> {
  const { coerce, fromEnv, values, ...opts } = extra
  return leaf({
    type,
    schema,
    default: undefined,
    optional: true,
    ...(values !== undefined ? { values } : {}),
    ...(coerce !== undefined ? { coerce } : {}),
    ...(fromEnv !== undefined ? { fromEnv } : {}),
    opts,
  })
}

export function group<const F extends Record<string, AnyNode>>(
  fields: F,
  opts: NodeOptions = {},
): GroupNode<F> {
  return { kind: 'group', fields, opts, flags: NO_FLAGS(), path: '' }
}

export function servers<S extends GroupNode>(server: S, opts: NodeOptions = {}): ServersNode<S> {
  return { kind: 'servers', server, opts, flags: NO_FLAGS(), path: '' }
}

// ---------------------------------------------------------------------------
// Tree utilities
// ---------------------------------------------------------------------------

export function isIntKeyedObject(v: unknown): v is Record<string, unknown> {
  return (
    !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => /^(0|[1-9]\d*)$/.test(k))
  )
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Zod schema validating a fully merged (resolved) value of `node`. */
export function toZod(node: AnyNode): z.ZodTypeAny {
  switch (node.kind) {
    case 'leaf':
      return node.optional ? node.schema.optional() : node.schema
    case 'group': {
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [k, child] of Object.entries(node.fields as Record<string, AnyNode>)) shape[k] = toZod(child)
      return z.object(shape).strict()
    }
    case 'servers':
      return z.record(
        z.string().regex(/^[1-9]\d*$/, 'server index must be a positive integer (Servers are 1-based)'),
        toZod(node.server),
      )
  }
}

/** Default value of a node (deep copy). `Servers` gets one default server at index 1. */
export function defaultOf(node: AnyNode): unknown {
  switch (node.kind) {
    case 'leaf':
      return structuredClone(node.default)
    case 'group': {
      const out: Record<string, unknown> = {}
      for (const [k, child] of Object.entries(node.fields as Record<string, AnyNode>)) {
        if (child.kind === 'leaf' && child.optional) continue
        out[k] = defaultOf(child)
      }
      return out
    }
    case 'servers':
      return { 1: defaultOf(node.server) }
  }
}

/** Assigns `path` to every node (phpMyAdmin `/` notation, `Servers/*` for the server template). */
export function assignPaths(node: AnyNode, path: string): void {
  node.path = path
  if (node.kind === 'group') {
    for (const [k, child] of Object.entries(node.fields as Record<string, AnyNode>)) {
      assignPaths(child, path === '' ? k : `${path}/${k}`)
    }
  } else if (node.kind === 'servers') {
    assignPaths(node.server, `${path}/*`)
  }
}

export interface LeafEntry {
  path: string
  node: LeafNode
}

/** Depth-first list of leaves. */
export function leaves(node: AnyNode): LeafEntry[] {
  const out: LeafEntry[] = []
  const walk = (n: AnyNode): void => {
    if (n.kind === 'leaf') out.push({ path: n.path, node: n })
    else if (n.kind === 'group') for (const c of Object.values(n.fields as Record<string, AnyNode>)) walk(c)
    else walk(n.server)
  }
  walk(node)
  return out
}
