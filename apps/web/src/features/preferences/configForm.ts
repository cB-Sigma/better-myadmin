import type { PrefsField, PrefsFormSet } from '@bettermyadmin/contracts'
import { t } from '../../lib/i18n'

/**
 * The client side of phpMyAdmin's configuration forms: field values as the browser holds them,
 * the default marking, restore-default and the JS validators.
 * pma: resources/js/modules/config.ts
 */

/** One value per field id: checkbox state, or the input / selected option / textarea text. */
export type FormValues = Record<string, string | boolean>

export function fieldsOf(formSet: PrefsFormSet): PrefsField[] {
  return formSet.forms.flatMap((f) => f.items.flatMap((i) => (i.kind === 'field' ? [i.field] : [])))
}

/** A select without a selected option shows (and submits) its first option. */
function selectValue(field: PrefsField, value: string): string {
  const options = field.options ?? []
  return options.some((o) => o.value === value) ? value : (options[0]?.value ?? '')
}

export function initialValues(formSet: PrefsFormSet): FormValues {
  const out: FormValues = {}
  for (const f of fieldsOf(formSet)) {
    out[f.id] = f.type === 'select' ? selectValue(f, String(f.value)) : f.value
  }
  return out
}

/** checkFieldDefault: compared with `data-default-values` strictly (select: `[value]`). */
export function isDefault(field: PrefsField, value: string | boolean): boolean {
  const def = field.jsDefault
  if (field.type === 'select') {
    const list = Array.isArray(def) ? def : [def]
    return list.length === 1 && list[0] === value
  }
  return value === def
}

/** setFieldValue(field, type, defaultValues[id]) */
export function restoredValue(field: PrefsField): string | boolean {
  const def = field.jsDefault
  if (field.type === 'checkbox') return def === true
  if (field.type === 'select') {
    // options[i].selected = value.indexOf(options[i].value) !== -1, then the select resets
    const list = Array.isArray(def) ? def : [def]
    const hit = (field.options ?? []).find((o) => list.indexOf(o.value) !== -1)
    return hit?.value ?? field.options?.[0]?.value ?? ''
  }
  return typeof def === 'string' ? def : String(def)
}

const regExpNumeric = /^[0-9]+$/
const regExpPcreExtract = /(.)(.*)\1(.*)?/

/**
 * The validator of a field (registerFieldValidator keeps only the first registered one); `true`
 * or the error. Text inputs validate on change (the keyup handler is never bound: jQuery's
 * `attr('tagName')` is undefined).
 */
export function validateField(field: PrefsField, value: string | boolean, isKeyUp = false): string[] {
  const v = field.validators[0]
  if (v === undefined || typeof value !== 'string') return []
  let result: true | string = true
  switch (v.name) {
    case 'validatePositiveNumber':
      if (!(isKeyUp && value === ''))
        result = value !== '0' && regExpNumeric.test(value) ? true : t('Not a positive number!')
      break
    case 'validateNonNegativeNumber':
      if (!(isKeyUp && value === ''))
        result = regExpNumeric.test(value) ? true : t('Not a non-negative number!')
      break
    case 'validatePortNumber':
      if (value !== '')
        result =
          regExpNumeric.test(value) && value !== '0' && Number(value) <= 65535
            ? true
            : t('Not a valid port number!')
      break
    case 'validateByRegex': {
      if (isKeyUp && value === '') break
      const parts = String(v.args[0] ?? '').match(regExpPcreExtract)
      let ok = true
      try {
        ok = parts !== null && value.match(new RegExp(parts[2] ?? '', parts[3] ?? '')) !== null
      } catch {
        ok = false
      }
      result = ok ? true : t('Incorrect value!')
      break
    }
    case 'validateUpperBound': {
      const val = Number.parseInt(value, 10)
      const max = Number(v.args[0])
      if (!Number.isNaN(val) && val > max)
        result = t('Value must be less than or equal to %s!', String(v.args[0]))
      break
    }
    default:
      break
  }
  return result === true ? [] : [result]
}

/** Every field's errors after a full validation (setDisplayError, the Reset button). */
export function validateAll(formSet: PrefsFormSet, values: FormValues): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const f of fieldsOf(formSet)) out[f.id] = validateField(f, values[f.id] ?? '')
  return out
}

/** The posted fields: unchecked checkboxes are absent, like a browser form. */
export function postedValues(formSet: PrefsFormSet, values: FormValues): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fieldsOf(formSet)) {
    const v = values[f.id]
    if (f.type === 'checkbox') {
      if (v === true) out[f.id] = 'on'
    } else out[f.id] = String(v ?? '')
  }
  return out
}
