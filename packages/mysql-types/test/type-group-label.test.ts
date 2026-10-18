import { describe, expect, it } from 'vitest'
import { getColumns, typeGroupLabel } from '../src/index.ts'

/** Types::getColumns() keys: the groups translated with their contexts; JSON, UUID, VECTOR, XML are not. */
describe('typeGroupLabel', () => {
  const seen: Array<[string, string]> = []
  const pgettext = (context: string, msgid: string) => {
    seen.push([context, msgid])
    return `${context}:${msgid}`
  }

  it('the contexts of phpMyAdmin', () => {
    const groups = getColumns({ vendor: 'mariadb', version: 110402 }).flatMap((e) =>
      typeof e === 'object' && e !== null && 'group' in e ? [e.group as string] : [],
    )
    expect(groups.map((g) => typeGroupLabel(g, pgettext))).toEqual(
      groups.map(
        (g) =>
          ({
            Numeric: 'numeric types:Numeric',
            'Date and time': 'date and time types:Date and time',
            String: 'string types:String',
            Spatial: 'spatial types:Spatial',
          })[g] ?? g,
      ),
    )
    expect(seen).toContainEqual(['string types', 'String'])
    expect(typeGroupLabel('JSON', pgettext)).toBe('JSON')
  })
})
