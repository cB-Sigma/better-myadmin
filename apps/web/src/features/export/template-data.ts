/** A saved export template: field → value, list (repeated names), or null (unchecked checkbox). */
export type TemplateData = Record<string, string | string[] | null>

const EXCLUDE = new Set([
  'token',
  'server',
  'db',
  'table',
  'single_table',
  'export_type',
  'export_method',
  'sql_query',
  'template_id',
])

/**
 * The dump form as a template object: repeated names become arrays, unchecked checkboxes are
 * stored as null (so loading unchecks them), selects without a selection as [].
 * pma: resources/js/export.ts::getTemplateData
 */
export function getTemplateData(form: HTMLFormElement): TemplateData {
  const obj: TemplateData = {}
  for (const [name, v] of new FormData(form).entries()) {
    if (EXCLUDE.has(name)) continue
    const value = String(v)
    const prev = obj[name]
    if (prev !== undefined) obj[name] = Array.isArray(prev) ? [...prev, value] : [prev ?? '', value]
    else obj[name] = value
  }
  for (const el of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:checked)')) {
    if (el.name !== '' && obj[el.name] === undefined) obj[el.name] = null
  }
  for (const el of form.querySelectorAll<HTMLSelectElement>('select')) {
    if (el.selectedOptions.length === 0 && el.name !== '') obj[el.name] = []
  }
  return obj
}

/**
 * Applies a loaded template to the form like jQuery `.val()`: checkboxes, radios and multiple
 * selects take a list of values to check, `null` unchecks a checkbox.
 * pma: resources/js/export.ts::loadTemplate
 */
export function applyTemplateData(form: HTMLFormElement, data: TemplateData): void {
  for (const [key, value] of Object.entries(data)) {
    const elements = [
      ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(key)}"]`),
    ]
    if (elements.length === 0) continue
    for (const el of elements) {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        if (value === null) {
          el.checked = false
          continue
        }
        const list = Array.isArray(value) ? value : [value]
        el.checked = list.includes(el.value)
      } else if (el instanceof HTMLSelectElement && el.multiple) {
        const list = value === null ? [] : Array.isArray(value) ? value : [value]
        for (const o of el.options) o.selected = list.includes(o.value)
      } else if (value !== null && el.type !== 'hidden') {
        el.value = Array.isArray(value) ? (value[0] ?? '') : value
      }
    }
  }
}
