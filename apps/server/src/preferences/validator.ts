import { isIP } from 'node:net'
import { FORM_VALIDATORS, type FormValidator, USER_VALIDATORS } from '@bettermyadmin/config'
import { type Gettext, sprintf } from '@bettermyadmin/i18n'
import { pcreToRegExp } from '@bettermyadmin/kbs'
import { arrayRead, phpEmpty } from '@bettermyadmin/metadata'
import { php } from '@bettermyadmin/mysql-types'
import { canonical } from './config-file.ts'

/** Util::requestString: the first scalar of an array, trimmed string. */
export function requestString(value: unknown): string {
  let v = value
  while (v !== null && typeof v === 'object') v = Object.values(v as object)[0]
  if (v === undefined || v === null || v === false) return ''
  if (v === true) return '1'
  return String(v).trim()
}

/** PHP 8 `$a <= $b` for an int bound and a scalar value. */
function lessOrEqual(value: unknown, max: number): boolean {
  if (typeof value === 'number') return value <= max
  if (typeof value === 'boolean') return value ? max >= 1 || max !== 0 : true
  if (value === null || value === undefined) return true
  const s = String(value)
  if (php.isNumericString(s.trim())) return Number(s) <= max
  // non-numeric string vs int: compared as strings
  return s <= String(max)
}

/**
 * The validators of a field (Validator::loadValidators): for user preferences also the user
 * validators with `value:` resolved from `base`; the setup script (`base` null) has none of those.
 */
export function fieldValidators(path: string, base: Record<string, unknown> | null): FormValidator[] {
  const own = FORM_VALIDATORS[path] ?? []
  if (base === null) return own
  const user = (USER_VALIDATORS[path] ?? []).map((v) => ({
    name: v.name,
    args: v.args.map((a) => (a.startsWith('value:') ? String(arrayRead(a.slice(6), base) ?? '') : a)),
  }))
  return [...own, ...user]
}

/**
 * `@preg_match('/' . $v . '/', '')` error text for hide_db (Validator::validateRegex): delimiter
 * errors exactly as PHP prints them, compilation errors in PCRE2's wording for the usual mistakes.
 */
export function pcreError(body: string): string | null {
  const pattern = `/${body}/`
  // find the closing delimiter like PHP: the first unescaped '/'
  let i = 1
  let end = -1
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '/') {
      end = i
      break
    }
    i++
  }
  if (end === -1) return "No ending delimiter '/' found"
  const inner = pattern.slice(1, end)
  const modifiers = pattern.slice(end + 1)
  for (const mod of modifiers) {
    if (!'imsxuADSUXJn'.includes(mod)) return `Unknown modifier '${mod}'`
  }
  try {
    new RegExp(inner, modifiers.includes('u') ? 'u' : '')
    return null
  } catch (e) {
    const msg = (e as Error).message
    const at = (n: number) => ` at offset ${n}`
    if (/Unterminated group/i.test(msg))
      return `Compilation failed: missing closing parenthesis${at(inner.length)}`
    if (/Unmatched '\)'/i.test(msg)) {
      let depth = 0
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k]
        if (ch === '\\') k++
        else if (ch === '(') depth++
        else if (ch === ')') {
          if (depth === 0) return `Compilation failed: unmatched closing parenthesis${at(k)}`
          depth--
        }
      }
    }
    if (/Unterminated character class/i.test(msg))
      return `Compilation failed: missing terminating ] for character class${at(inner.length)}`
    if (/Nothing to repeat/i.test(msg)) {
      const k = inner.search(/[*+?{]/)
      return `Compilation failed: quantifier does not follow a repeatable item${at(Math.max(k, 0))}`
    }
    if (/numbers out of order/i.test(msg)) {
      const k = inner.indexOf('}')
      return `Compilation failed: numbers out of order in {} quantifier${at(Math.max(k, 0))}`
    }
    return `Compilation failed: ${msg.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, '')}`
  }
}

/** One validator run (Validator::validate*): '' when valid. */
function runValidator(tr: Gettext, v: FormValidator, path: string, value: unknown): string | string[] {
  const number = (allowZero: boolean, max: number, err: string): string => {
    if (phpEmpty(value)) return ''
    const s = requestString(value)
    const n = Number(s)
    if (!php.isNumericString(s) || !Number.isInteger(n) || n < 0 || (!allowZero && n === 0) || n > max)
      return err
    return ''
  }
  switch (v.name) {
    case 'validatePositiveNumber':
      return number(false, Number.MAX_SAFE_INTEGER, tr.gettext('Not a positive number!'))
    case 'validateNonNegativeNumber':
      return number(true, Number.MAX_SAFE_INTEGER, tr.gettext('Not a non-negative number!'))
    case 'validatePortNumber':
      return number(false, 65535, tr.gettext('Not a valid port number!'))
    case 'validateByRegex':
      if (value === undefined || value === null) return ''
      return pcreToRegExp(v.args[0] ?? '')?.test(requestString(value)) === true
        ? ''
        : tr.gettext('Incorrect value!')
    case 'validateUpperBound': {
      const max = Number.parseInt(v.args[0] ?? '0', 10)
      return lessOrEqual(value, max)
        ? ''
        : sprintf(tr.gettext('Value must be less than or equal to %s!'), max)
    }
    case 'validateRegex':
      if (phpEmpty(value)) return ''
      return pcreError(requestString(value)) ?? ''
    default:
      void path
      return ''
  }
}

/**
 * Validator::validate($paths, $values, false) for user preferences: errors keyed by path, empty
 * results skipped.
 */
export function validate(
  tr: Gettext,
  paths: readonly string[],
  values: Record<string, unknown>,
  base: Record<string, unknown> | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const p of paths) {
    const vid = canonical(p)
    for (const v of fieldValidators(vid, base)) {
      const r = runValidator(tr, v, vid, values[vid])
      const list = (Array.isArray(r) ? r : [r]).filter((x) => x !== '')
      if (list.length === 0) continue
      out[p] ??= []
      out[p].push(...list)
    }
  }
  return out
}

/** Validator::testDBConnection: a connection attempt, the PHP warning appended to the error. */
export type ConnectionTest = (
  host: string,
  port: string,
  socket: string,
  user: string,
  password: string,
) => Promise<string | null>

const str = (v: unknown): string => (phpEmpty(v) ? '' : String(v))

/** pma: Validator::validateServer */
async function validateServer(
  tr: Gettext,
  values: Record<string, unknown>,
  test: ConnectionTest,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {
    Server: '',
    'Servers/1/user': '',
    'Servers/1/SignonSession': '',
    'Servers/1/SignonURL': '',
  }
  let error = false
  let authType = values['Servers/1/auth_type']
  if (phpEmpty(authType)) {
    authType = ''
    result['Servers/1/auth_type'] = tr.gettext('Invalid authentication type!')
    error = true
  }
  if (authType === 'config' && phpEmpty(values['Servers/1/user'])) {
    result['Servers/1/user'] = tr.gettext(
      'Empty username while using [kbd]config[/kbd] authentication method!',
    )
    error = true
  }
  if (authType === 'signon' && phpEmpty(values['Servers/1/SignonSession'])) {
    result['Servers/1/SignonSession'] = tr.gettext(
      'Empty signon session name while using [kbd]signon[/kbd] authentication method!',
    )
    error = true
  }
  if (authType === 'signon' && phpEmpty(values['Servers/1/SignonURL'])) {
    result['Servers/1/SignonURL'] = tr.gettext(
      'Empty signon URL while using [kbd]signon[/kbd] authentication method!',
    )
    error = true
  }
  if (!error && authType === 'config') {
    const e = await test(
      str(values['Servers/1/host']),
      str(values['Servers/1/port']),
      str(values['Servers/1/socket']),
      str(values['Servers/1/user']),
      str(values['Servers/1/password']),
    )
    if (e !== null) result.Server = e
  }
  return result
}

/** pma: Validator::validatePMAStorage */
async function validatePMAStorage(
  tr: Gettext,
  values: Record<string, unknown>,
  test: ConnectionTest,
): Promise<Record<string, string>> {
  if (phpEmpty(values['Servers/1/pmadb']))
    return { Server_pmadb: '', 'Servers/1/controluser': '', 'Servers/1/controlpass': '' }
  const result: Record<string, string> = {}
  let error = false
  if (phpEmpty(values['Servers/1/controluser'])) {
    result['Servers/1/controluser'] = tr.gettext(
      'Empty phpMyAdmin control user while using phpMyAdmin configuration storage!',
    )
    error = true
  }
  if (phpEmpty(values['Servers/1/controlpass'])) {
    result['Servers/1/controlpass'] = tr.gettext(
      'Empty phpMyAdmin control user password while using phpMyAdmin configuration storage!',
    )
    error = true
  }
  if (!error) {
    const e = await test(
      str(values['Servers/1/host']),
      str(values['Servers/1/port']),
      str(values['Servers/1/socket']),
      str(values['Servers/1/controluser']),
      str(values['Servers/1/controlpass']),
    )
    if (e !== null) result.Server_pmadb = e
  }
  return result
}

const htmlspecialchars = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

/** FILTER_VALIDATE_IP (v4 or v6) */
const isIp = (s: string) => isIP(s) !== 0

/** pma: Validator::validateTrustedProxies */
export function validateTrustedProxies(tr: Gettext, value: unknown): string[] {
  if (phpEmpty(value)) return []
  let lines: string[]
  if (value !== null && typeof value === 'object') {
    // value already processed by FormDisplay::save
    lines = Object.entries(value as Record<string, unknown>).map(([ip, v]) =>
      /^-\d+$/.test(ip) ? requestString(v) : `${ip}: ${requestString(v)}`,
    )
  } else lines = String(value).split('\n')
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    const m = /^(.+):(?:[ ]?)\w+$/.exec(line)
    if (m === null) {
      out.push(`${tr.gettext('Incorrect value:')} ${htmlspecialchars(line)}`)
      continue
    }
    if (!isIp(m[1] as string))
      out.push(sprintf(tr.gettext('Incorrect IP address: %s'), htmlspecialchars((m[1] as string).trim())))
  }
  return out
}

/**
 * Validator::validate($paths, $values, $isPostSource) of the setup script: the field validators,
 * TrustedProxies and the form validators (validateServer, validatePMAStorage, which test the
 * connection). BBCode is converted by the caller. With `isPostSource` empty results are kept (the
 * AJAX validation clears those fields' errors).
 */
export async function validateSetup(
  tr: Gettext,
  paths: readonly string[],
  values: Record<string, unknown>,
  test: ConnectionTest,
  isPostSource = false,
): Promise<Record<string, string[]> | false> {
  const out: Record<string, string[]> = {}
  let matched = false
  const add = (key: string, list: string[]) => {
    if (!isPostSource && list.length === 0) return
    out[key] ??= []
    out[key].push(...list)
  }
  for (const p of paths) {
    const vid = canonical(p)
    const validators = FORM_VALIDATORS[vid]
    if (validators === undefined) continue
    matched = true
    for (const v of validators) {
      if (v.name === 'validateServer' || v.name === 'validatePMAStorage') {
        const r = await (v.name === 'validateServer' ? validateServer : validatePMAStorage)(tr, values, test)
        for (const [k, e] of Object.entries(r)) add(k, e === '' ? [] : [e])
      } else if (v.name === 'validateTrustedProxies') {
        add(vid, validateTrustedProxies(tr, values[vid]))
      } else {
        const r = runValidator(tr, v, vid, values[vid])
        add(
          vid,
          (Array.isArray(r) ? r : [r]).filter((x) => x !== ''),
        )
      }
    }
  }
  return matched ? out : false
}
