import type { z } from 'zod'
import { ValidationError } from './errors.ts'

/**
 * Request validation of the route handlers: the Zod output, or the one VALIDATION envelope with
 * the issues (docs/architecture/16-golden-path.md#adding-an-endpoint).
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
