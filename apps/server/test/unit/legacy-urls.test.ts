import { describe, expect, it } from 'vitest'
import { isPageRequest } from '../../src/auth/page-gate.ts'
import { legacyTarget } from '../../src/http/legacy-urls.ts'

describe('legacyTarget: phpMyAdmin routes to BetterMyAdmin pages', () => {
  it('index.php with no route opens the deepest level its parameters name', () => {
    expect(legacyTarget('/', 1, '', '')).toBe('/s/1/')
    expect(legacyTarget('/', 2, 'shop', '')).toBe('/s/2/db/shop/')
    expect(legacyTarget('/', 1, 'shop', 'orders')).toBe('/s/1/db/shop/t/orders/')
  })
  it('maps server, database and table routes', () => {
    expect(legacyTarget('/server/databases', 1, '', '')).toBe('/s/1/databases')
    expect(legacyTarget('/server/status/processes', 1, '', '')).toBe('/s/1/status/processes')
    expect(legacyTarget('/database/structure', 1, 'my db', '')).toBe('/s/1/db/my%20db/structure')
    expect(legacyTarget('/database/central_columns', 1, 'shop', '')).toBe('/s/1/db/shop/central-columns')
    expect(legacyTarget('/table/structure', 1, 'shop', 'orders')).toBe('/s/1/db/shop/t/orders/structure')
    expect(legacyTarget('/table/change', 1, 'shop', 'orders')).toBe('/s/1/db/shop/t/orders/insert')
  })
  it('/sql browses a table, else opens the SQL box of the level', () => {
    expect(legacyTarget('/sql', 1, 'shop', 'orders')).toBe('/s/1/db/shop/t/orders/browse')
    expect(legacyTarget('/sql', 1, 'shop', '')).toBe('/s/1/db/shop/sql')
    expect(legacyTarget('/sql', 1, '', '')).toBe('/s/1/sql')
  })
  it('a route missing its database or table falls back to what is known', () => {
    expect(legacyTarget('/table/structure', 1, 'shop', '')).toBe('/s/1/db/shop/')
    expect(legacyTarget('/database/structure', 1, '', '')).toBe('/s/1/')
  })
})

describe('isPageRequest', () => {
  it('counts SPA pages whose last segment has a dot (a table named logs.2024)', () => {
    expect(isPageRequest('GET', '/s/1/db/app/t/logs.2024')).toBe(true)
    expect(isPageRequest('GET', '/assets/index-abc.js')).toBe(false)
    expect(isPageRequest('GET', '/favicon.ico')).toBe(false)
  })
})
