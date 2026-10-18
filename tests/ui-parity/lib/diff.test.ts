import { describe, expect, it } from 'vitest'
import type { Control } from './capture.ts'
import { type PageMap, diffControls, formatDiff, validateMap } from './diff.ts'

const c = (p: Partial<Control> & Pick<Control, 'kind' | 'label'>): Control => ({
  role: p.kind,
  section: 'S',
  index: 0,
  ...p,
})
const list = (...cs: Control[]) => cs.map((x, i) => ({ ...x, index: i }))
const types = (r: ReturnType<typeof diffControls>) =>
  r.differences.map((d) => `${d.type}:${d.field ?? ''}:${d.control}`)

describe('diffControls', () => {
  it('matches by kind + label and reports missing, extra and field differences', () => {
    const pma = list(
      c({ kind: 'textbox', label: 'Name', value: 'a' }),
      c({ kind: 'checkbox', label: 'Ok', checked: true }),
      c({ kind: 'button', label: 'Go' }),
    )
    const ours = list(
      c({ kind: 'textbox', label: 'Name', value: 'b' }),
      c({ kind: 'checkbox', label: 'Ok', checked: true }),
      c({ kind: 'button', label: 'Run' }),
    )
    expect(types(diffControls(pma, ours))).toEqual([
      'field:value:textbox "Name"',
      'missing::button "Go"',
      'extra::button "Run"',
    ])
  })

  it('pairs unlabelled controls of phpMyAdmin with ours by id when neither has a name', () => {
    const pma = list(
      c({ kind: 'link', label: '', id: 'savePos' }),
      c({ kind: 'link', label: '', id: 'SaveAs' }),
    )
    const ours = list(
      c({ kind: 'link', label: 'Save page', id: 'savePos' }),
      c({ kind: 'link', label: 'Save page as', id: 'SaveAs' }),
    )
    const r = diffControls(pma, ours)
    expect(types(r)).toEqual([])
    expect(r.notes.join('\n')).toContain('accessible name added')
  })

  it('treats link vs button as a note, and ignores names and checkbox values', () => {
    const pma = list(
      c({ kind: 'link', label: 'Log out' }),
      c({ kind: 'checkbox', label: 'A', value: '1', name: 'a' }),
    )
    const ours = list(
      c({ kind: 'button', label: 'Log out' }),
      c({ kind: 'checkbox', label: 'A', value: 'on' }),
    )
    const r = diffControls(pma, ours)
    expect(r.differences).toEqual([])
    expect(r.notes[0]).toContain('link in phpMyAdmin, button in ours')
  })

  it('reports order differences within a section', () => {
    const pma = list(
      c({ kind: 'button', label: 'A' }),
      c({ kind: 'button', label: 'B' }),
      c({ kind: 'button', label: 'C' }),
    )
    const ours = list(
      c({ kind: 'button', label: 'C' }),
      c({ kind: 'button', label: 'A' }),
      c({ kind: 'button', label: 'B' }),
    )
    expect(types(diffControls(pma, ours))).toEqual(['order:order:button "C"'])
    expect(diffControls(pma, ours, { ignoreOrder: true }).differences).toEqual([])
  })

  it('applies section equivalences, renames, n/a, added and ignore rules', () => {
    const pma = list(
      c({ kind: 'textbox', label: 'User:', section: 'Login' }),
      c({ kind: 'link', label: 'Git' }),
      c({ kind: 'select', label: 'Lang', value: 'en' }),
    )
    const ours = list(
      c({ kind: 'textbox', label: 'Username:', section: 'Log in' }),
      c({ kind: 'select', label: 'Lang', value: 'de' }),
      c({ kind: 'select', label: 'Mode' }),
    )
    const map: PageMap = {
      sections: { Login: 'Log in' },
      rules: [
        { pma: { label: 'User:' }, ours: { label: 'Username:' }, exception: 'X33' },
        { pma: { label: 'Git' }, 'n/a': 'git checkout only' },
        { ours: { label: 'Mode' }, added: 'dark mode' },
        { match: { label: 'Lang' }, ignore: ['value'], reason: 'locale' },
      ],
    }
    expect(validateMap(map, new Set(['X33']))).toEqual([])
    expect(diffControls(pma, ours, map).differences).toEqual([])
  })

  it('replaces the product name in our texts', () => {
    const pma = list(c({ kind: 'link', label: 'About phpMyAdmin', section: 'phpMyAdmin' }))
    const ours = list(c({ kind: 'link', label: 'About BetterMyAdmin', section: 'BetterMyAdmin' }))
    const map: PageMap = { replace: [{ ours: 'BetterMyAdmin', pma: 'phpMyAdmin', exception: 'X33' }] }
    expect(diffControls(pma, ours, map).differences).toEqual([])
  })

  it('validates maps: label renames need an exception, ids must exist', () => {
    expect(
      validateMap({ rules: [{ pma: { label: 'a' }, ours: { label: 'b' }, reason: 'x' }] }, new Set()),
    ).toEqual(['rule 1: a label rename needs a parity-exception id'])
    expect(
      validateMap({ rules: [{ ours: { label: 'b' }, added: 'x', exception: 'X999' }] }, new Set()), // fake exception id
    ).toEqual(['rule 1: exception X999 is not in docs/reference/parity-exceptions.md'])
  })

  it('formats grouped differences', () => {
    const pma = list(
      c({ kind: 'link', label: 'a', section: 'X' }),
      c({ kind: 'link', label: 'b', section: 'X' }),
    )
    const ours = list(
      c({ kind: 'link', label: 'a', section: 'Y' }),
      c({ kind: 'link', label: 'b', section: 'Y' }),
    )
    expect(formatDiff('p', 'initial', diffControls(pma, ours))).toContain('section differs on 2 controls')
  })
})
