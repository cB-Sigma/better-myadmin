/**
 * Plural-form selection exactly as phpMyAdmin's gettext implementation (phpmyadmin/motranslator) does it.
 *
 * motranslator does NOT evaluate the Plural-Forms expression as C: it strips every character outside
 * `[n0-9:()?=!<>/%&| ]` and evaluates the rest with symfony/expression-language, then keeps the
 * result only when it is numeric. A boolean result (`plural=n != 1;`, `plural=(n > 1);` …) is not
 * numeric, so those locales always pick form 0. We reproduce that, because it is what phpMyAdmin shows.
 *
 * pma: vendor/phpmyadmin/motranslator/src/Translator.php::sanitizePluralExpression, ::extractPluralCount,
 *      ::selectString; vendor/symfony/expression-language/Parser.php (operator table)
 */

type Value = number | boolean | null
type Node = (n: number) => Value

/** Translator::extractPluralsForms on a header text. */
export function extractPluralsForms(header: string): string {
  let expr = 'nplurals=2; plural=n == 1 ? 0 : 1;'
  for (const line of header.split('\n')) {
    if (line.toLowerCase().startsWith('plural-forms:')) expr = line.slice(13)
  }
  return expr
}

/** Translator::sanitizePluralExpression */
export function sanitizePluralExpression(expr: string): string {
  const parts = expr.split(';')
  let e = (parts.length >= 2 ? parts[1]! : parts[0]!).toLowerCase().trim()
  if (e.startsWith('plural')) e = e.slice(6).replace(/^\s+/, '')
  if (e.startsWith('=')) e = e.slice(1).replace(/^\s+/, '')
  return e.replace(/[^n0-9:()?=!<>/%&| ]/g, '')
}

/** Translator::extractPluralCount */
export function extractPluralCount(expr: string): number {
  const first = expr.split(';')[0]!.trim()
  const i = first.indexOf('=')
  if (i === -1) return 1
  if (first.slice(0, i).trimEnd().toLowerCase() !== 'nplurals') return 1
  return phpIntval(first.slice(i + 1))
}

function phpIntval(s: string): number {
  const m = /^\s*[+-]?\d+/.exec(s)
  return m === null ? 0 : Number.parseInt(m[0], 10)
}

class PluralSyntaxError extends Error {}

const BINARY: Record<string, number> = {
  '||': 10,
  '&&': 15,
  '|': 16,
  '&': 18,
  '==': 20,
  '===': 20,
  '!=': 20,
  '!==': 20,
  '<': 20,
  '>': 20,
  '>=': 20,
  '<=': 20,
  '/': 60,
  '%': 60,
}

const truthy = (v: Value) => v !== null && v !== false && v !== 0
const num = (v: Value) => (v === null || v === false ? 0 : v === true ? 1 : v)
/** PHP 8 `==`: a bool or null operand compares as bool. */
const looseEquals = (a: Value, b: Value) =>
  typeof a === 'number' && typeof b === 'number' ? a === b : truthy(a) === truthy(b)

function tokenize(src: string): string[] {
  const out: string[] = []
  const re = /\s*(===|!==|==|!=|<=|>=|&&|\|\||\d+|n|[()?:<>!%/&|])/y
  let pos = 0
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break
    re.lastIndex = pos
    const m = re.exec(src)
    if (m === null) throw new PluralSyntaxError(src.slice(pos))
    out.push(m[1]!)
    pos = re.lastIndex
  }
  return out
}

/** Parses a sanitized expression the way ExpressionLanguage's Parser does (precedence climbing). */
export function compilePluralExpression(src: string): Node {
  const toks = tokenize(src)
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]

  const parseExpression = (precedence = 0): Node => {
    let expr = parsePrimary()
    for (
      let op = peek();
      op !== undefined && BINARY[op] !== undefined && BINARY[op]! >= precedence;
      op = peek()
    ) {
      next()
      const right = parseExpression(BINARY[op]! + 1)
      expr = binary(op, expr, right)
    }
    if (precedence === 0) return parseConditional(expr)
    return expr
  }

  const parseConditional = (cond: Node): Node => {
    let expr = cond
    while (peek() === '?') {
      next()
      const test = expr
      let a: Node
      let b: Node
      if (peek() !== ':') {
        a = parseExpression()
        if (peek() === ':') {
          next()
          b = parseExpression()
        } else {
          b = () => null
        }
      } else {
        next()
        a = test
        b = parseExpression()
      }
      expr = (n) => (truthy(test(n)) ? a(n) : b(n))
    }
    return expr
  }

  const parsePrimary = (): Node => {
    const t = next()
    if (t === undefined) throw new PluralSyntaxError('unexpected end')
    if (t === '!') {
      const operand = parseExpression(50)
      return (n) => !truthy(operand(n))
    }
    if (t === '(') {
      const inner = parseExpression()
      if (next() !== ')') throw new PluralSyntaxError('missing )')
      return inner
    }
    if (t === 'n') return (n) => n
    if (/^\d+$/.test(t)) {
      const v = Number.parseInt(t, 10)
      return () => v
    }
    throw new PluralSyntaxError(t)
  }

  const node = parseExpression()
  if (i !== toks.length) throw new PluralSyntaxError(`trailing ${toks[i]}`)
  return node
}

function binary(op: string, l: Node, r: Node): Node {
  switch (op) {
    case '||':
      return (n) => truthy(l(n)) || truthy(r(n))
    case '&&':
      return (n) => truthy(l(n)) && truthy(r(n))
    case '|':
      return (n) => num(l(n)) | num(r(n))
    case '&':
      return (n) => num(l(n)) & num(r(n))
    case '==':
      return (n) => looseEquals(l(n), r(n))
    case '!=':
      return (n) => !looseEquals(l(n), r(n))
    case '===':
      return (n) => l(n) === r(n)
    case '!==':
      return (n) => l(n) !== r(n)
    case '<':
      return (n) => num(l(n)) < num(r(n))
    case '>':
      return (n) => num(l(n)) > num(r(n))
    case '<=':
      return (n) => num(l(n)) <= num(r(n))
    case '>=':
      return (n) => num(l(n)) >= num(r(n))
    case '/':
      return (n) => {
        const d = num(r(n))
        if (d === 0) throw new PluralSyntaxError('division by zero')
        return num(l(n)) / d
      }
    case '%':
      return (n) => {
        const d = Math.trunc(num(r(n)))
        if (d === 0) throw new PluralSyntaxError('modulo by zero')
        return Math.trunc(num(l(n))) % d
      }
    default:
      throw new PluralSyntaxError(op)
  }
}

export interface PluralRule {
  /** The sanitized expression motranslator evaluates. */
  expression: string
  nplurals: number
  /** Translator::selectString */
  select(n: number): number
}

/** Builds the selector from a PO/MO header's Plural-Forms value (the part after `Plural-Forms:`). */
export function pluralRule(pluralForms: string): PluralRule {
  const expression = sanitizePluralExpression(pluralForms)
  const nplurals = extractPluralCount(pluralForms)
  let node: Node | null
  try {
    node = compilePluralExpression(expression)
  } catch {
    node = null
  }
  return {
    expression,
    nplurals,
    select(n: number): number {
      let plural = 0
      if (node !== null) {
        try {
          const v = node(Math.trunc(n))
          // is_numeric(bool) and is_numeric(null) are false → 0
          plural = typeof v === 'number' ? Math.trunc(v) : 0
        } catch {
          plural = 0
        }
      }
      if (plural >= nplurals) plural = nplurals - 1
      return plural
    },
  }
}
