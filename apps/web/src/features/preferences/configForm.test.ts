import type { PrefsField, PrefsFormSet } from '@bettermyadmin/contracts'
import { describe, expect, it } from 'vitest'
import { initialValues, isDefault, postedValues, restoredValue, validateField } from './configForm.ts'
import { formatDateTime, savedOn } from './manage.ts'

const field = (over: Partial<PrefsField>): PrefsField => ({
  path: 'MaxRows',
  id: 'MaxRows',
  type: 'text',
  name: 'n',
  desc: '',
  doc: '',
  value: '',
  isDefault: true,
  jsDefault: '',
  disabled: false,
  errors: [],
  validators: [],
  trClass: '',
  ...over,
})

const set = (fields: PrefsField[]): PrefsFormSet => ({
  forms: [
    { name: 'F', title: 'F', desc: '', errors: [], items: fields.map((f) => ({ kind: 'field', field: f })) },
  ],
  hasErrors: false,
  errorList: [],
  error: null,
})

describe('config form values (pma: resources/js/modules/config.ts)', () => {
  const select = field({
    id: 'FirstDayOfCalendar',
    type: 'select',
    value: '',
    jsDefault: [0],
    options: [
      { value: '1', label: 'Monday' },
      { value: '2', label: 'Tuesday' },
    ],
  })

  it('a select without a matching option submits its first option', () => {
    expect(initialValues(set([select]))).toEqual({ FirstDayOfCalendar: '1' })
  })

  it('[p08-779a14] defaults compare strictly like checkFieldDefault (numeric selects stay custom)', () => {
    expect(isDefault(select, '1')).toBe(false)
    expect(isDefault(field({ type: 'select', jsDefault: ['both'] }), 'both')).toBe(true)
    expect(isDefault(field({ type: 'select', jsDefault: [25] }), '25')).toBe(false)
    expect(isDefault(field({ type: 'checkbox', jsDefault: true }), true)).toBe(true)
    expect(isDefault(field({ jsDefault: '25' }), '25')).toBe(true)
  })

  it('restore default resets a select to the first option when no option matches', () => {
    expect(restoredValue(select)).toBe('1')
    expect(restoredValue(field({ jsDefault: '1000' }))).toBe('1000')
    expect(restoredValue(field({ type: 'checkbox', jsDefault: false }))).toBe(false)
  })

  it('unchecked checkboxes are not posted', () => {
    const fs = set([
      field({ id: 'A', type: 'checkbox' }),
      field({ id: 'B', type: 'checkbox' }),
      field({ id: 'C' }),
    ])
    expect(postedValues(fs, { A: true, B: false, C: 'x' })).toEqual({ A: 'on', C: 'x' })
  })
})

describe('JS validators', () => {
  it('[p08-d2dece] only the first registered validator runs', () => {
    const f = field({
      validators: [
        { name: 'validatePositiveNumber', args: [] },
        { name: 'validateUpperBound', args: [100] },
      ],
    })
    expect(validateField(f, '0')).toEqual(['Not a positive number!'])
    expect(validateField(f, '500')).toEqual([])
    expect(validateField(f, '')).toEqual(['Not a positive number!'])
    expect(validateField(f, '', true)).toEqual([])
  })

  it('regex and upper bound', () => {
    const re = field({ validators: [{ name: 'validateByRegex', args: ['/^.$/'] }] })
    expect(validateField(re, 'ab')).toEqual(['Incorrect value!'])
    expect(validateField(re, ';')).toEqual([])
    const ub = field({ validators: [{ name: 'validateUpperBound', args: [100] }] })
    expect(validateField(ub, '101')).toEqual(['Value must be less than or equal to 100!'])
    expect(validateField(ub, 'x')).toEqual([])
  })
})

describe('browser storage', () => {
  it('[p08-10a75c] Saved on: date as formatDateTime', () => {
    expect(formatDateTime(new Date(2024, 0, 5, 7, 3))).toBe('2024-01-05 07:03')
    expect(savedOn('Saved on: @DATE@', new Date(2024, 0, 5, 7, 3).toUTCString())).toBe(
      'Saved on: 2024-01-05 07:03',
    )
  })
})
