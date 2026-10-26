import { describe, expect, it } from 'vitest'
import { validateConfig } from '../src/index.ts'

describe('config issues under zod 4', () => {
  it('a list directive with a wrong value reports one issue (zod 4 reports the union once per option)', () => {
    const r = validateConfig({ ForeignKeyDropdownOrder: 'zz_junk' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.map((i) => i.path)).toEqual(['ForeignKeyDropdownOrder'])
      expect(r.issues[0]?.message).toBe('expected a list of "content-id", "id-content", got "zz_junk"')
    }
  })

  it('size bounds read zod 4 issue origins (number and array)', () => {
    const r = validateConfig({ MaxRows: -5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.message).toMatch(/^must be >= /)
  })
})
