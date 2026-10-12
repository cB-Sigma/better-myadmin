import { FORM_FIELDS, type FormDef, type FormFieldDef, type FormMsg } from '@bettermyadmin/config'
import type { PrefsField, PrefsForm, PrefsFormItem, PrefsOption } from '@bettermyadmin/contracts'
import { type Gettext, convertBBCode, getDocumentationLink, sprintf } from '@bettermyadmin/i18n'
import { phpIdentical } from '@bettermyadmin/metadata'
import { php } from '@bettermyadmin/mysql-types'
import { type ConfigFile, canonical } from './config-file.ts'
import { fieldValidators, requestString, validate } from './validator.ts'

export interface FormDisplayContext {
  tr: Gettext
  /** Config::$baseSettings (no user preferences), `Servers` keyed from 1; null in the setup script */
  base: Record<string, unknown> | null
  /** UserFormList::getFields() */
  userprefsKeys: ReadonlySet<string>
  /** $cfg['UserprefsDisallow'] */
  disallow: ReadonlySet<string>
  /** $cfg['AvailableCharsets'] */
  charsets: readonly string[]
  /**
   * FormDisplay::registerForm's server id (the setup script's Servers form): `Servers/1/…` fields
   * are read and posted as `Servers/<id>/…`; 0 is a new server, saved as the next index.
   */
  serverId?: number | null
}

/** A posted form: browser-style strings, `string[]` for multi-valued names. */
export type PostedForm = Record<string, unknown>

/** Descriptions::get(path, type): translated, BBCode converted; the path is the name fallback. */
export function describe(tr: Gettext, path: string, type: 'name' | 'desc' | 'cmt'): string {
  const def = FORM_FIELDS[path]
  const raw = def?.[type]
  if (raw === undefined) return type === 'name' ? path : ''
  return bbcode(tr, tr.gettext(raw))
}

export function bbcode(tr: Gettext, s: string): string {
  return convertBBCode(tr, s, false, { linkUrl: (u) => u })
}

export function msgText(tr: Gettext, m: FormMsg | number | boolean): string | number | boolean {
  if (typeof m !== 'object') return m
  if (m.msgid === '') return ''
  return m.context !== undefined ? tr.pgettext(m.context, m.msgid) : tr.gettext(m.msgid)
}

/** The form's field paths keyed by their name (Form::readFormPaths, last path segment). */
const fieldsOf = (form: FormDef): string[] => form.items.flatMap((i) => ('path' in i ? [i.path] : []))

/** PHP `settype($v, 'integer')` of a request string. */
export function phpIntval(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = requestString(v)
  if (php.isNumericString(s)) return Math.trunc(Number(s))
  const m = /^[+-]?\d+/.exec(s)
  return m === null ? 0 : Number(m[0])
}

/** PHP `(bool)` */
export function phpBoolval(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null || v === undefined) return false
  if (typeof v === 'object') return Object.keys(v).length > 0
  return v !== '' && v !== '0'
}

const phpIsNumeric = (v: unknown): boolean =>
  typeof v === 'number' || (typeof v === 'string' && php.isNumericString(v.trim()))

/** PHP 8 loose `==` between an array key (int|string) and a scalar. */
function looseEquals(key: string | number, value: unknown): boolean {
  if (typeof value === 'boolean') return phpBoolval(key) === value
  if (value === null || value === undefined) return key === '' || key === 0
  if (typeof value === 'object') return false
  if (typeof key === 'number') {
    if (typeof value === 'number') return key === value
    const s = String(value)
    return php.isNumericString(s.trim()) ? key === Number(s) : String(key) === s
  }
  if (typeof value === 'number')
    return php.isNumericString(key.trim()) ? Number(key) === value : key === String(value)
  const s = String(value)
  if (php.isNumericString(key.trim()) && php.isNumericString(s.trim())) return Number(key) === Number(s)
  return key === s
}

/** The option keys of a select (Form::getOptionValueList). */
export function selectValues(
  def: FormFieldDef,
  charsets: readonly string[],
): Array<{ key: string | number; label: unknown }> {
  if (def.valuesFrom === 'AvailableCharsets') return ['', ...charsets].map((c) => ({ key: c, label: c }))
  return def.values ?? []
}

/**
 * FormDisplay::validateSelect: the value matches a key (numeric-ness must agree), then takes the
 * key's type unless it is a boolean.
 */
export function validateSelect(
  value: unknown,
  allowed: Array<{ key: string | number }>,
): { ok: true; value: unknown } | { ok: false } {
  const cmp = typeof value === 'boolean' ? (value ? 1 : 0) : value
  for (const { key } of allowed) {
    const loose = looseEquals(key, value) && phpIsNumeric(cmp) === phpIsNumeric(key)
    if (!loose && key !== value) continue
    if (typeof value === 'boolean') return { ok: true, value }
    return { ok: true, value: typeof key === 'number' ? phpIntval(value) : requestStringKeep(value) }
  }
  return { ok: false }
}

/** settype($v, 'string') */
function requestStringKeep(v: unknown): string {
  if (typeof v === 'boolean') return v ? '1' : ''
  if (v === null || v === undefined) return ''
  return String(v)
}

/** PHP string conversion of a value echoed into an input (`{{ value }}`). */
function echo(v: unknown): string {
  if (v === null || v === undefined || v === false) return ''
  if (v === true) return '1'
  if (typeof v === 'object') return 'Array'
  return String(v)
}

/** `(array) $value` */
function toList(v: unknown): Array<[string, unknown]> {
  if (v !== null && typeof v === 'object') return Object.entries(v as object)
  if (v === null || v === undefined) return []
  return [['0', v]]
}

/**
 * One preferences form set (a Settings tab or a page settings group): processing a submit,
 * validation and the display model.
 *
 * pma: src/Config/FormDisplay.php, src/Config/FormDisplayTemplate.php
 */
export class FormDisplay {
  readonly forms: readonly FormDef[]
  readonly cf: ConfigFile
  readonly ctx: FormDisplayContext
  errors: Record<string, string[]> = {}
  #validated = false

  constructor(forms: readonly FormDef[], cf: ConfigFile, ctx: FormDisplayContext) {
    this.forms = forms
    this.cf = cf
    this.ctx = ctx
  }

  #def(path: string): FormFieldDef {
    return FORM_FIELDS[path] ?? { type: 'string' }
  }

  /** registerForm: the work path of a field (its server index) */
  #work(path: string): string {
    const id = this.ctx.serverId
    return id === undefined || id === null ? path : path.replace('Servers/1/', `Servers/${id}/`)
  }

  /** the system path of a work path or form name (array_search($path, $this->systemPaths)) */
  #toWork(systemPath: string): string {
    return FORM_FIELDS[systemPath] !== undefined ? this.#work(systemPath) : systemPath
  }

  /** The paths and values validate() checks (system paths). */
  validationInput(): { paths: string[]; values: Record<string, unknown> } {
    const paths: string[] = []
    const values: Record<string, unknown> = {}
    for (const form of this.forms) {
      paths.push(form.name)
      for (const path of fieldsOf(form)) {
        values[path] = this.cf.getValue(this.#work(path))
        paths.push(path)
      }
    }
    return { paths, values }
  }

  /** The validation errors (keyed by system path or form name) become this form set's errors. */
  setValidationErrors(errors: Record<string, string[]>): void {
    if (Object.keys(errors).length > 0) {
      this.errors = {}
      for (const [path, list] of Object.entries(errors)) this.errors[this.#toWork(path)] = list
    }
    this.#validated = true
  }

  /** FormDisplay::validate (once) */
  validate(): void {
    if (this.#validated) return
    const { paths, values } = this.validationInput()
    this.setValidationErrors(validate(this.ctx.tr, paths, values, this.ctx.base))
  }

  hasErrors(): boolean {
    return Object.keys(this.errors).length > 0
  }

  /**
   * FormDisplay::save via process(): casts the posted values to each field's type and stores them;
   * with `allowPartialSave` false nothing is stored when a value is missing or invalid.
   */
  process(
    post: PostedForm,
    allowPartialSave: boolean,
    opts: { keepDefaults?: boolean; skipValidation?: boolean } = {},
  ): boolean {
    const tr = this.ctx.tr
    let result = true
    const values: Record<string, unknown> = {}
    const toSave: Array<[work: string, path: string]> = []
    const setup = this.ctx.base === null
    // $form->index === 0: a new server, saved as the next one
    const changeIndex = this.ctx.serverId === 0 ? this.cf.getServerCount() + 1 : null
    const disallow = new Set(setup ? ((this.cf.get('UserprefsDisallow', []) as string[]) ?? []) : [])
    this.errors = {}
    this.#validated = false
    for (const form of this.forms) {
      for (const path of fieldsOf(form)) {
        const work = this.#work(path)
        const key = work.replaceAll('/', '-')
        const def = this.#def(path)
        let v: unknown = post[key]
        // getFlatDefaultConfig() splits lists starting with null (TextImageLink): no value posted
        if (v === undefined && opts.keepDefaults === true) continue
        if (v === undefined) {
          if (def.type !== 'boolean') {
            this.errors[form.name] ??= []
            this.errors[form.name]?.push(
              sprintf(tr.gettext('Missing data for %s'), `<i>${describe(tr, path, 'name')}</i>`),
            )
            result = false
            continue
          }
          v = false
        }
        // user preferences allow/disallow (setup)
        if (setup && this.ctx.userprefsKeys.has(path)) {
          if (post[`${key}-userprefs-allow`] !== undefined) disallow.delete(path)
          else disallow.add(path)
        }
        switch (def.type) {
          case 'double':
            v = Number.parseFloat(requestString(v)) || 0
            break
          case 'boolean':
            if (v !== '') v = phpBoolval(requestString(v))
            break
          case 'integer':
            if (v !== '') v = phpIntval(requestString(v))
            break
          case 'select': {
            const r = validateSelect(v, selectValues(def, this.ctx.charsets))
            // an import posts phpMyAdmin's defaults for the fields the file lacks: FirstDayOfCalendar's
            // default (0) is no option of its select, that is not an error of the file
            if (!r.ok && opts.keepDefaults === true && phpIdentical(v, this.cf.getDefault(path))) continue
            if (!r.ok) {
              this.errors[work] ??= []
              this.errors[work]?.push(tr.gettext('Incorrect value!'))
              result = false
              continue
            }
            v = r.value
            break
          }
          case 'string':
          case 'short_string':
            v = requestString(v)
            break
          case 'array': {
            const lines = v !== null && typeof v === 'object' ? Object.values(v) : String(v ?? '').split('\n')
            v = lines.map((x) => requestString(x)).filter((x) => x !== '')
            break
          }
        }
        values[path] = v
        toSave.push([
          changeIndex === null ? work : work.replace('Servers/0/', `Servers/${changeIndex}/`),
          path,
        ])
      }
    }
    if (!allowPartialSave && this.hasErrors()) {
      if (opts.skipValidation !== true) this.validate()
      return result
    }
    for (const [work, path] of toSave) {
      let value = values[path]
      // TrustedProxies requires changes before saving: `IP: header` pairs, other lines kept as -N
      if (path === 'TrustedProxies') {
        const proxies: Record<string, unknown> = {}
        let i = 0
        for (const line of (value as string[]) ?? []) {
          const m = /^(.+):(?:[ ]?)(\w+)$/.exec(line)
          if (m !== null) proxies[(m[1] as string).trim()] = (m[2] as string).trim()
          else proxies[`-${i++}`] = line
        }
        value = proxies
      }
      this.cf.set(work, value, path)
    }
    if (setup) this.cf.set('UserprefsDisallow', [...disallow])
    if (opts.skipValidation !== true) this.validate()
    return result
  }

  /** FormDisplay::fixErrors: fields with errors get their default value. */
  fixErrors(): void {
    this.validate()
    for (const work of Object.keys(this.errors)) {
      const path = canonical(work)
      if (FORM_FIELDS[path] === undefined) continue
      this.cf.set(work, this.cf.getDefault(path))
    }
  }

  /** FormDisplay::displayErrors: `<dl><dt>name</dt><dd>…</dd></dl>` per field or form. */
  displayErrors(): Array<{ name: string; errors: string[] }> {
    this.validate()
    const tr = this.ctx.tr
    return Object.entries(this.errors).map(([work, errors]) => {
      const path = canonical(work)
      return {
        name: FORM_FIELDS[path] !== undefined ? describe(tr, path, 'name') : formTitle(tr, work, this.forms),
        errors,
      }
    })
  }

  /** FormDisplay::getDisplay: the tabs (one per form) with their rows. */
  display(): PrefsForm[] {
    this.validate()
    const tr = this.ctx.tr
    return this.forms.map((form) => {
      let group = 0
      const items: PrefsFormItem[] = []
      for (const item of form.items) {
        if ('group' in item) {
          group++
          if (item.group !== '') items.push({ kind: 'group', title: tr.gettext(item.group), group })
          continue
        }
        if ('groupEnd' in item) {
          group--
          continue
        }
        let trClass = group > 0 ? `group-field group-field-${group}` : ''
        let setvalue = item.setvalue
        if (setvalue === ':group') {
          setvalue = undefined
          group++
          trClass = `group-header-field group-header-${group}`
        }
        items.push({ kind: 'field', field: this.#field(item.path, trClass, setvalue) })
      }
      return {
        name: form.name,
        title: describeForm(tr, form, 'name'),
        desc: describeForm(tr, form, 'desc'),
        errors: this.errors[form.name] ?? [],
        items,
      }
    })
  }

  #field(path: string, trClass: string, setvalue: string | undefined): PrefsField {
    const tr = this.ctx.tr
    const def = this.#def(path)
    const work = this.#work(path)
    const id = work.replaceAll('/', '-')
    let value = this.cf.get(work)
    let valueDefault = this.cf.getDefault(path)
    let isDefault = false
    if (value === null || phpIdentical(value, valueDefault)) {
      value = valueDefault
      isDefault = true
    }
    let type: PrefsField['type'] = 'text'
    let options: PrefsOption[] | undefined
    let selected: string | null = null
    switch (def.type) {
      case 'string':
        type = 'text'
        break
      case 'short_string':
        type = 'short_text'
        break
      case 'double':
      case 'integer':
        type = 'number_text'
        break
      case 'boolean':
        type = 'checkbox'
        break
      case 'select': {
        type = 'select'
        options = selectValues(def, this.ctx.charsets).map(({ key, label }) => {
          let text = msgText(tr, label as FormMsg)
          if (text === true) text = tr.gettext('Yes')
          else if (text === false) text = tr.gettext('No')
          const s = String(text)
          return { value: String(key), label: s, ...(s === '' ? { emptyLabel: true } : {}) }
        })
        const keys = selectValues(def, this.ctx.charsets)
        const hit = keys.find(
          ({ key }) => key === value || (value === true && key === 1) || (value === false && key === 0),
        )
        selected = hit === undefined ? null : String(hit.key)
        break
      }
      case 'array':
        type = 'list'
        value = Object.fromEntries(toList(value))
        valueDefault = Object.fromEntries(toList(valueDefault))
        break
    }
    if (type === 'text' && (id.endsWith('-password') || id.endsWith('pass') || id.endsWith('Pass')))
      type = 'password'

    let shown: string | boolean
    let jsDefault: unknown
    switch (type) {
      case 'checkbox':
        shown = phpBoolval(value)
        jsDefault = phpBoolval(valueDefault)
        break
      case 'select':
        shown = selected ?? ''
        jsDefault = [typeof valueDefault === 'boolean' ? (valueDefault ? 1 : 0) : valueDefault]
        break
      case 'list': {
        // `{% for key, val in value %}{% if key != 'wrapper_params' %}{{ val }}{{ not loop.last ? "\n" }}`;
        // the HTML parser then drops one leading newline of the textarea
        const entries = toList(value)
        shown = entries
          .map(([k, v], i) => (k === 'wrapper_params' ? '' : echo(v) + (i < entries.length - 1 ? '\n' : '')))
          .join('')
          .replace(/^\r?\n/, '')
        jsDefault = toList(valueDefault)
          .filter(([k]) => k !== 'wrapper_params')
          .map(([, v]) => echo(v))
          .join('\n')
        break
      }
      default:
        shown = type === 'short_text' && value !== null && typeof value === 'object' ? '' : echo(value)
        jsDefault = echo(valueDefault)
    }

    const setup = this.ctx.base === null
    const disallowed = setup
      ? ((this.cf.get('UserprefsDisallow', []) as string[] | null) ?? []).includes(path)
      : this.ctx.disallow.has(path)
    const allow = this.ctx.userprefsKeys.has(path) ? !disallowed : null
    const doc =
      path.startsWith('Import') || path.startsWith('Export')
        ? ''
        : getDocumentationLink(
            'config',
            `cfg_${path.replace('Servers/1/', 'Servers/').replaceAll('/', '_')}`,
            {
              linkUrl: (u) => u,
            },
          )
    return {
      path,
      id,
      type,
      name: describe(tr, path, 'name'),
      desc: describe(tr, path, 'desc'),
      doc,
      value: shown,
      isDefault,
      jsDefault: jsDefault as PrefsField['jsDefault'],
      ...(options !== undefined ? { options } : {}),
      // the setup script shows the "allow users to customize" checkbox instead of disabling
      disabled: !setup && allow === false,
      ...(setup && allow !== null ? { userprefsAllow: allow } : {}),
      ...(setvalue !== undefined ? { setvalue } : {}),
      errors: this.errors[work] ?? [],
      validators: fieldValidators(path, this.ctx.base).map((v) => ({
        name: v.name,
        args: v.name === 'validateUpperBound' ? v.args.map((a) => Number(a)) : v.args,
      })),
      trClass,
    }
  }
}

function describeForm(tr: Gettext, form: FormDef, type: 'name' | 'desc'): string {
  const raw = type === 'name' ? form.title : form.desc
  if (raw === '') return type === 'name' ? `Form_${form.name}` : ''
  return bbcode(tr, tr.gettext(raw))
}

function formTitle(tr: Gettext, name: string, forms: readonly FormDef[]): string {
  const f = forms.find((x) => x.name === name)
  return f === undefined ? `Form_${name}` : describeForm(tr, f, 'name')
}
