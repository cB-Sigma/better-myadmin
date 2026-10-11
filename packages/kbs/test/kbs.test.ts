import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANY,
  MARIADB,
  MYSQL,
  getByName,
  getStaticVariables,
  getVariableType,
  loadKbs,
  variableDocUrl,
} from '../src/index.ts'

/** Expected values computed by the PHP library itself (scripts/gen-fixtures.php). */
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as Record<
  string,
  { any: string | null; mysql: string | null; mariadb: string | null; type: string | null } | number
>

describe('mariadb-mysql-kbs Search port', async () => {
  const data = await loadKbs()
  for (const [name, exp] of Object.entries(fixtures)) {
    if (typeof exp === 'number') continue
    it(name, () => {
      expect(getByName(data, name, ANY)).toBe(exp.any)
      expect(getByName(data, name, MYSQL)).toBe(exp.mysql)
      expect(getByName(data, name, MARIADB)).toBe(exp.mariadb)
      expect(getVariableType(data, name)).toBe(exp.type)
    })
  }
  it('static variables', () => {
    expect(getStaticVariables(data).length).toBe(fixtures.__static_count)
  })
  it('picks the documentation of the connected server type', () => {
    expect(variableDocUrl(data, 'max_connections', false)).toMatch(/^https:\/\/dev\.mysql\.com\//)
    expect(variableDocUrl(data, 'max_connections', true)).toMatch(/^https:\/\/mariadb\.com\//)
  })
})
