/**
 * Merges what one request changed in its session into the session as stored now. Requests of a
 * session run concurrently (PHP serialises them with the session lock); writing the request's
 * whole snapshot back would undo what another request stored meanwhile, so only the values the
 * request changed (by JSON value, per object key, recursively) are applied to the latest copy.
 */
type Json = unknown

const isObject = (v: Json): v is Record<string, Json> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b)

/**
 * `latest` with the differences between `before` (the request's session as loaded, a JSON copy)
 * and `after` (the request's session at its end) applied; `latest` is not modified.
 */
export function mergeChanges<T>(latest: T, before: Json, after: Json): T {
  return merge(latest as Json, before, after) as T
}

function merge(latest: Json, before: Json, after: Json): Json {
  if (same(before, after)) return latest
  if (!isObject(before) || !isObject(after) || !isObject(latest)) return after
  const out: Record<string, Json> = { ...latest }
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[k]
    const a = after[k]
    if (same(b, a)) continue
    if (!(k in after)) delete out[k]
    else out[k] = k in latest ? merge(latest[k], b, a) : a
  }
  return out
}
