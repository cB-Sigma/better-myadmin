/**
 * The advisor: runs phpMyAdmin's rule set (generated/advisor-rules.json, exported from
 * src/Advisory/Rules.php) on the server's status and variables with the same expression engine and
 * helper functions.
 *
 * pma: src/Advisory/Advisor.php
 */
import { type Gettext, formatByteDown, htmlspecialchars, timespanFormat } from '@bettermyadmin/i18n'
import { phpRound, sprintf } from '@bettermyadmin/i18n/php'
import rulesJson from '../generated/advisor-rules.json' with { type: 'json' }
import { ExpressionLanguage } from './expression.ts'
import {
  PhpError,
  type PhpValue,
  floatToInt,
  looseEquals,
  numericString,
  pcreToRegExp,
  stringToInt,
  substr,
  toPhpString,
  truthy,
  typeName,
} from './php.ts'

/** One rule of src/Advisory/Rules.php (msgids untranslated). */
export interface AdvisorRule {
  id: string
  name: string
  precondition?: string
  formula: string
  test: string
  issue: string
  recommendation: string
  justification: string
  justification_formula?: string
}

export const GENERIC_RULES = rulesJson.generic as AdvisorRule[]
export const BEFORE_MYSQL_80003_RULES = rulesJson.beforeMySql80003 as AdvisorRule[]

export interface AdvisorRuleResult {
  id: string
  name: string
  /** HTML (phpMyAdmin renders it raw): `{variable}` became a link to the variables page. */
  issue: string
  /** HTML: variable links, external links open in a new tab. */
  recommendation: string
  /** Plain text. */
  justification: string
  formula: string
  test: string
}

export interface AdvisorResult {
  fired: AdvisorRuleResult[]
  notfired: AdvisorRuleResult[]
  unchecked: string[]
  errors: string[]
}

export interface AdvisorInput {
  /** SHOW GLOBAL STATUS as name → value. */
  status: Record<string, string>
  /** SHOW GLOBAL VARIABLES as name → value. */
  variables: Record<string, string>
  /** SysInfo::memory()['MemTotal'] (KiB), 0 when unknown. */
  systemMemory: number
  /** DatabaseInterface::getVersion() */
  versionInt: number
  isMariaDb: boolean
}

export interface AdvisorOptions {
  tr: Gettext
  /** Url::getFromRoute('/server/variables', ['filter' => name]) */
  variableUrl: (name: string) => string
  /** Core::linkURL for the external links of recommendations. */
  linkUrl?: (url: string) => string
}

/** Coercive-mode parameter passing of the registered closures (PHP userland type declarations). */
type ParamType = 'float' | 'int' | 'string' | 'int|string'

function coerce(
  fn: string,
  position: number,
  param: string,
  type: ParamType,
  v: PhpValue | undefined,
): PhpValue {
  const fail = (): never => {
    throw new PhpError(
      'TypeError',
      `PhpMyAdmin\\Advisory\\Advisor::PhpMyAdmin\\Advisory\\{closure}(): Argument #${position} ($${param}) must be of type ${type}, ${v === undefined ? 'null' : typeName(v)} given, called in {ROOT}/vendor/symfony/expression-language/Node/FunctionNode.php on line 50`,
    )
  }
  if (v === undefined || v === null || Array.isArray(v)) return fail()
  if (type === 'string') {
    if (typeof v === 'string') return v
    return toPhpString(v)
  }
  if (type === 'int|string') {
    if (typeof v === 'string' || typeof v === 'bigint') return v
    if (typeof v === 'boolean') return v ? 1n : 0n
    return Number.isInteger(v) ? BigInt(v) : toPhpString(v)
  }
  // numeric types
  let n: bigint | number
  if (typeof v === 'boolean') n = v ? 1n : 0n
  else if (typeof v === 'string') {
    const parsed = numericString(v)
    if (parsed === null) return fail()
    n = parsed
  } else n = v
  if (type === 'float') return typeof n === 'bigint' ? Number(n) : n
  if (typeof n === 'bigint') return n
  if (!Number.isFinite(n) || n >= 2 ** 63 || n < -(2 ** 63)) return fail()
  // a fractional float is deprecated (8.1) but still truncated
  return floatToInt(n)
}

function args(fn: string, given: PhpValue[], params: Array<[string, ParamType, PhpValue?]>): PhpValue[] {
  const required = params.filter((p) => p.length === 2).length
  if (given.length < required) {
    throw new PhpError(
      'ArgumentCountError',
      `Too few arguments to function PhpMyAdmin\\Advisory\\Advisor::PhpMyAdmin\\Advisory\\{closure}(), ${given.length + 1} passed in {ROOT}/vendor/symfony/expression-language/Node/FunctionNode.php on line 50 and ${required === params.length ? 'exactly' : 'at least'} ${required + 1} expected`,
    )
  }
  return params.map(([name, type, def], i) =>
    i < given.length ? coerce(fn, i + 2, name, type, given[i]) : (def as PhpValue),
  )
}

/** Advisor::byTime */
export function byTime(tr: Gettext, num0: number, precision: number): string {
  let num = num0
  let per: string
  if (num >= 1) {
    per = tr.gettext('per second')
  } else if (num * 60 >= 1) {
    num *= 60
    per = tr.gettext('per minute')
  } else if (num * 60 * 60 >= 1) {
    num *= 60 * 60
    per = tr.gettext('per hour')
  } else {
    num *= 24 * 60 * 60
    per = tr.gettext('per day')
  }
  const rounded = phpRound(num, precision)
  const shown = rounded === 0 ? `<${toPhpString(10 ** -precision)}` : toPhpString(rounded)
  return `${shown} ${per}`
}

/** vsprintf with PHP's conversion of each argument (floats as `(string)` with precision 14 for %s). */
export function vsprintf(format: string, params: PhpValue[]): string {
  const specs: string[] = []
  let next = 0
  for (const m of format.matchAll(/%(?:(\d+)\$)?[-+ 0]*(?:'.)?\d*(?:\.\d+)?l?([a-zA-Z%])/g)) {
    if (m[2] === '%') continue
    const idx = m[1] !== undefined ? Number(m[1]) - 1 : next++
    specs[idx] = m[2]!
  }
  const converted = params.map((p, i) => {
    if (typeof p === 'bigint') return p.toString()
    if (typeof p === 'number') return specs[i] === 's' ? toPhpString(p) : p
    if (Array.isArray(p)) return 'Array'
    return p
  })
  return sprintf(format, ...converted)
}

/** Advisor */
export class Advisor {
  readonly #expression = new ExpressionLanguage()
  readonly #opts: AdvisorOptions
  #variables = new Map<string, PhpValue>()
  #globals = new Map<string, PhpValue>()
  #rules: AdvisorRule[] = []
  #fired: AdvisorRuleResult[] = []
  #notFired: AdvisorRuleResult[] = []
  #unchecked: string[] = []
  #errors: string[] = []

  constructor(opts: AdvisorOptions) {
    this.#opts = opts
    const { tr } = opts
    const e = this.#expression
    e.register('round', (_v, a) => {
      const [num] = args('round', a, [['num', 'float']])
      return phpRound(num as number)
    })
    e.register('substr', (_v, a) => {
      const [s, start, length] = args('substr', a, [
        ['string', 'string'],
        ['start', 'int'],
        ['length', 'int'],
      ])
      return substr(s as string, Number(start), Number(length))
    })
    e.register('preg_match', (_v, a) => {
      const [pattern, subject] = args('preg_match', a, [
        ['pattern', 'string'],
        ['subject', 'string'],
      ])
      const re = pcreToRegExp(pattern as string)
      if (re === null) return false
      return re.test(subject as string) ? 1n : 0n
    })
    e.register('ADVISOR_bytime', (_v, a) => {
      const [num, precision] = args('ADVISOR_bytime', a, [
        ['num', 'float'],
        ['precision', 'int'],
      ])
      return byTime(tr, num as number, Number(precision))
    })
    e.register('ADVISOR_timespanFormat', (_v, a) => {
      const [seconds] = args('ADVISOR_timespanFormat', a, [['seconds', 'string']])
      return timespanFormat(tr, Number(stringToInt(seconds as string)))
    })
    e.register('ADVISOR_formatByteDown', (_v, a) => {
      const [value, limes, comma] = args('ADVISOR_formatByteDown', a, [
        ['value', 'int'],
        ['limes', 'int', 6n],
        ['comma', 'int', 0n],
      ])
      return formatByteDown(tr, Number(value), Number(limes), Number(comma))!.join(' ')
    })
    e.register('fired', (_v, a) => {
      const [value] = args('fired', a, [['value', 'int|string']])
      // Did matching rule fire?
      return this.#fired.some((rule) => looseEquals(rule.id, value as PhpValue)) ? '1' : '0'
    })
  }

  /** Advisor::run with the variables the caller read (setVariables) */
  run(input: AdvisorInput): AdvisorResult {
    this.#globals = new Map<string, PhpValue>([
      ['PMA_MYSQL_INT_VERSION', BigInt(input.versionInt)],
      ['IS_MARIADB', input.isMariaDb],
    ])
    // array_merge($globalStatus, $globalVariables, $systemMemory)
    const merged = new Map<string, PhpValue>()
    for (const [k, v] of Object.entries(input.status)) merged.set(k, v)
    for (const [k, v] of Object.entries(input.variables)) merged.set(k, v)
    merged.set('system_memory', BigInt(input.systemMemory))
    this.#variables = merged
    this.#setRules(input)
    this.#runRules()
    return {
      fired: this.#fired,
      notfired: this.#notFired,
      unchecked: this.#unchecked,
      errors: this.#errors,
    }
  }

  #setRules(input: AdvisorInput): void {
    const version = toPhpString(this.#variables.get('version') ?? null)
    const isMariaDb = version.includes('MariaDB')
    this.#rules =
      !isMariaDb && input.versionInt >= 80003
        ? GENERIC_RULES
        : [...GENERIC_RULES, ...BEFORE_MYSQL_80003_RULES]
  }

  #storeError(description: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e)
    this.#errors.push(
      `${description} ${sprintf(this.#opts.tr.gettext('Error when evaluating: %s'), message)}`,
    )
  }

  #runRules(): void {
    const { tr } = this.#opts
    this.#fired = []
    this.#notFired = []
    this.#unchecked = []
    this.#errors = []
    for (const rule of this.#rules) {
      this.#variables.set('value', 0n)
      let precondition: PhpValue = true
      const name = tr.gettext(rule.name)
      if (rule.precondition !== undefined) {
        try {
          precondition = this.#evaluate(rule.precondition)
        } catch (e) {
          this.#storeError(sprintf(tr.gettext("Failed evaluating precondition for rule '%s'."), name), e)
          continue
        }
      }
      if (!truthy(precondition)) {
        this.#unchecked.push(rule.id)
        continue
      }
      let value: PhpValue
      try {
        value = this.#evaluate(rule.formula)
      } catch (e) {
        this.#storeError(sprintf(tr.gettext("Failed calculating value for rule '%s'."), name), e)
        continue
      }
      this.#variables.set('value', value)
      try {
        this.#addRule(truthy(this.#evaluate(rule.test)) ? 'fired' : 'notfired', rule)
      } catch (e) {
        this.#storeError(sprintf(tr.gettext("Failed running test for rule '%s'."), name), e)
      }
    }
  }

  /** Advisor::addRule (for fired / notfired) */
  #addRule(type: 'fired' | 'notfired', rule: AdvisorRule): void {
    const { tr } = this.#opts
    let justification = tr.gettext(rule.justification)
    if (rule.justification_formula !== undefined) {
      let params: PhpValue
      try {
        params = this.#evaluate(`[${rule.justification_formula}]`)
      } catch (e) {
        this.#storeError(
          sprintf(tr.gettext("Failed formatting string for rule '%s'."), tr.gettext(rule.name)),
          e,
        )
        return
      }
      justification = vsprintf(justification, params as PhpValue[])
    }
    const variableLink = (_m: string, name: string) =>
      `<a href="${this.#opts.variableUrl(name)}">${htmlspecialchars(name)}</a>`
    const linkUrl = this.#opts.linkUrl ?? ((u: string) => u)
    let recommendation = tr.gettext(rule.recommendation).replace(/\{([a-z_0-9]+)\}/gi, variableLink)
    const issue = tr.gettext(rule.issue).replace(/\{([a-z_0-9]+)\}/gi, variableLink)
    recommendation = recommendation.replace(
      /href=("|')(https?:\/\/[^"']+)\1/gi,
      (_m, _q, url: string) => `href="${linkUrl(url)}" target="_blank" rel="noopener noreferrer"`,
    )
    const result: AdvisorRuleResult = {
      id: rule.id,
      name: tr.gettext(rule.name),
      issue,
      recommendation,
      justification,
      formula: rule.formula,
      test: rule.test,
    }
    if (type === 'notfired') this.#notFired.push(result)
    else this.#fired.push(result)
  }

  /** Advisor::evaluateRuleExpression */
  #evaluate(expression: string): PhpValue {
    const values = new Map<string, PhpValue>([...this.#variables, ...this.#globals])
    // Set default values for missing InnoDB variables when InnoDB is disabled
    for (const k of ['innodb_buffer_pool_size', 'innodb_log_file_size', 'innodb_log_files_in_group']) {
      if (!values.has(k) || values.get(k) === null) values.set(k, 0n)
    }
    return this.#expression.evaluate(expression, values)
  }
}
