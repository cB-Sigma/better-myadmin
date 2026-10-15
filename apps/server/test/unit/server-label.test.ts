import { describe, expect, it } from 'vitest'
import { type ServerConfig, serverLabel } from '../../src/config.ts'

/** The labels of the server selection (home page, navigation, login). pma: src/Server/Select.php::render */
const s = (o: Partial<ServerConfig>) =>
  ({
    host: 'db.local',
    port: '',
    verbose: '',
    only_db: '',
    user: '',
    auth_type: 'cookie',
    ...o,
  }) as unknown as ServerConfig

describe('server selection labels [p06-c67ed8]', () => {
  it('verbose name, else host[:port]', () => {
    expect(serverLabel(s({ verbose: 'Production' }))).toBe('Production')
    expect(serverLabel(s({}))).toBe('db.local')
    expect(serverLabel(s({ port: '3307' }))).toBe('db.local:3307')
  })
  it('only_db: a string, or up to three names', () => {
    expect(serverLabel(s({ only_db: 'shop' }))).toBe('db.local - shop')
    expect(serverLabel(s({ only_db: ['a', 'b', 'c'] }))).toBe('db.local - a, b, c')
    expect(serverLabel(s({ only_db: ['a', 'b', 'c', 'd'] }))).toBe('db.local')
  })
  it('the user only with config authentication (two spaces before the parenthesis)', () => {
    expect(serverLabel(s({ user: 'app', auth_type: 'config' }))).toBe('db.local  (app)')
    expect(serverLabel(s({ user: 'app', auth_type: 'cookie' }))).toBe('db.local')
  })
})
