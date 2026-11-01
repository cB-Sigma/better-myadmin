import { afterEach, describe, expect, it } from 'vitest'
import { type PaletteCommand, registerCommands, registeredCommands } from './registry.ts'

const cmd = (id: string, label = id): PaletteCommand => ({ id, label, group: 'G', run: () => {} })
const scope = { server: 1, db: '', table: '' }
const cleanups: Array<() => void> = []
const register = (...a: Parameters<typeof registerCommands>) => {
  const off = registerCommands(...a)
  cleanups.push(off)
  return off
}

afterEach(() => {
  for (const off of cleanups.splice(0)) off()
})

describe('command registry', () => {
  it('lists registered commands in registration order until they are removed', () => {
    const off = register([cmd('a'), cmd('b')])
    register([cmd('c')])
    expect(registeredCommands(scope).map((c) => c.id)).toEqual(['a', 'b', 'c'])
    off()
    expect(registeredCommands(scope).map((c) => c.id)).toEqual(['c'])
    // removing twice is harmless
    off()
    expect(registeredCommands(scope).map((c) => c.id)).toEqual(['c'])
  })

  it('calls scope functions with the current scope', () => {
    register((s) => (s.db === '' ? [] : [cmd(`db:${s.db}`)]))
    expect(registeredCommands(scope)).toEqual([])
    expect(registeredCommands({ ...scope, db: 'sakila' }).map((c) => c.id)).toEqual(['db:sakila'])
  })

  it('lets a later registration replace a command with the same id', () => {
    register([cmd('x', 'first'), cmd('y')])
    register([cmd('x', 'second')])
    expect(registeredCommands(scope).map((c) => [c.id, c.label])).toEqual([
      ['y', 'y'],
      ['x', 'second'],
    ])
  })
})
