import type { Context } from 'hono'
import type { z } from 'zod'
import { ValidationError } from './errors.ts'

/**
 * The one request validator of the route handlers (docs/architecture/16-golden-path.md#adding-an-endpoint):
 * a Zod schema from packages/contracts → the typed value, or the VALIDATION envelope listing every issue.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new ValidationError(
      'Invalid request.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return r.data
}

/** The JSON body, or `empty` when it is absent or malformed (the schema then decides). */
// biome-ignore lint/suspicious/noExplicitAny: any route path/input
export const jsonBody = (c: Context<any, any, any>, empty: unknown = null): Promise<unknown> =>
  c.req.json().catch(() => empty)

/** `parse(schema, await jsonBody(c, empty))` */
export async function parseJson<T extends z.ZodTypeAny>(
  // biome-ignore lint/suspicious/noExplicitAny: any route path/input
  c: Context<any, any, any>,
  schema: T,
  empty: unknown = null,
): Promise<z.output<T>> {
  return parse(schema, await jsonBody(c, empty))
}
