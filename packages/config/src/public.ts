/**
 * Client-visible subset of the configuration (`GET /api/meta/config-public`).
 *
 * Built from the allow-list flags in schema.ts (user-preference directives plus
 * `CLIENT_VISIBLE_EXTRA_PATHS`), never from a deny-list. Secrets and everything under
 * `Servers` are never included (docs/architecture/07-security.md).
 */
import type { AnyNode, GroupNode } from './nodes.ts'
import { type ResolvedConfig, configNode } from './schema.ts'

/** Recursive partial of the resolved config: what `publicConfig` can return. */
export type PublicConfig = DeepPartial<Omit<ResolvedConfig, 'Servers'>>
type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

function pick(node: GroupNode, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, child] of Object.entries(node.fields as Record<string, AnyNode>)) {
    if (!child.flags.clientVisible || child.flags.secret || child.kind === 'servers') continue
    if (!Object.hasOwn(value, k)) continue
    const v = value[k]
    if (child.kind === 'group') {
      if (v && typeof v === 'object') out[k] = pick(child, v as Record<string, unknown>)
    } else {
      out[k] = structuredClone(v)
    }
  }
  return out
}

/** Returns only the directives flagged `clientVisible`, as a nested object. */
export function publicConfig(cfg: ResolvedConfig): PublicConfig {
  return pick(configNode, cfg as unknown as Record<string, unknown>) as PublicConfig
}
