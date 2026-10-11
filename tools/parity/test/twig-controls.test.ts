import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTemplate, transMsgids } from '../src/extract/twig-controls.ts'

const fixture = readFileSync(join(import.meta.dirname, 'fixtures/templates/form.twig'), 'utf8')
const controls = parseTemplate('fixture/form.twig', fixture)
const byLocal = new Map(controls.map((c) => [c.local, c]))

describe('Twig control extraction', () => {
  it('keys controls by template and name, else id, else kind + label', () => {
    expect(controls.map((c) => c.local)).toEqual([
      'name',
      'pass_*',
      'text:Type to filter',
      'mode',
      'db',
      'what',
      'selected[]',
      'single',
      'sql_query',
      'button:Preview SQL',
      'submit:Go',
      'link:Drop',
      'link:Empty',
    ])
    expect(byLocal.get('name')?.key).toBe('fixture/form.twig#name')
  })

  it('skips hidden inputs, comments and script bodies', () => {
    const locals = controls.map((c) => c.local)
    expect(locals).not.toContain('token')
    expect(locals).not.toContain('commented_out')
    expect(locals).not.toContain('from_script')
  })

  it('attaches <label for> text and reads attribute labels', () => {
    expect(byLocal.get('name')).toMatchObject({
      kind: 'input',
      type: 'text',
      id: 'input_name',
      label: 'Name:',
    })
    expect(byLocal.get('sql_query')).toMatchObject({ kind: 'textarea', label: 'SQL query' })
    expect(byLocal.get('submit:Go')).toMatchObject({ kind: 'submit', type: 'submit', label: 'Go' })
  })

  it('turns Twig output inside names into *', () => {
    expect(byLocal.get('pass_*')).toMatchObject({
      kind: 'input',
      type: 'password',
      name: 'pass_*',
      id: 'pass_*',
    })
  })

  it('lists static select options and flags dynamic ones', () => {
    expect(byLocal.get('mode')).toMatchObject({ kind: 'select', options: ['a', 'b', 'plain'] })
    expect(byLocal.get('mode')?.dynamicOptions).toBeUndefined()
    expect(byLocal.get('db')).toMatchObject({ kind: 'select', options: [], dynamicOptions: true })
  })

  it('groups radios and same-name checkboxes', () => {
    expect(byLocal.get('what')).toMatchObject({
      kind: 'radio-group',
      options: ['structure', 'data'],
      count: 2,
    })
    expect(byLocal.get('selected[]')).toMatchObject({
      kind: 'checkbox-group',
      options: ['t1', 't2'],
      count: 2,
    })
    expect(byLocal.get('single')).toMatchObject({ kind: 'checkbox', options: ['1'], count: 1 })
  })

  it('extracts translated action links (incl. get_icon titles and link_or_button), not data links', () => {
    expect(byLocal.get('link:Drop')).toMatchObject({ kind: 'link', label: 'Drop', count: 2 })
    expect(byLocal.get('link:Empty')).toMatchObject({ kind: 'link', label: 'Empty' })
    expect(controls.filter((c) => c.kind === 'link')).toHaveLength(2)
  })

  it('reports the line of the first occurrence, counting newlines inside Twig tags', () => {
    expect(byLocal.get('name')?.line).toBe(8)
    expect(byLocal.get('link:Empty')?.line).toBe(32)
  })

  it('reads t() msgids, with named message and escaped quotes', () => {
    expect(transMsgids(`{{ t('Don\\'t', context = 'x') }} {{ t(message = "Two") }}`)).toEqual([
      "Don't",
      'Two',
    ])
  })
})
