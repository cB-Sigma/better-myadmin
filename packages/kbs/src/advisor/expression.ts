/**
 * Port of Symfony ExpressionLanguage 7.4 (lexer, parser, node evaluation), the engine phpMyAdmin's
 * advisor evaluates its rules with. Values follow PHP semantics (./php.ts).
 *
 * pma: vendor/symfony/expression-language/{Lexer,Parser,TokenStream,SyntaxError}.php, Node/*.php
 */
import {
  PhpError,
  type PhpValue,
  add,
  compare,
  div,
  inArrayStrict,
  levenshtein,
  looseEquals,
  mod,
  mul,
  negate,
  pcreToRegExp,
  pow,
  strictEquals,
  stripcslashes,
  sub,
  toPhpString,
  truthy,
} from './php.ts'

type TokenType = 'end of expression' | 'name' | 'number' | 'string' | 'operator' | 'punctuation'

interface Token {
  type: TokenType
  value: string | bigint | number | null
  cursor: number
}

/** SyntaxError::__construct (message, position, expression, "Did you mean"). */
export function syntaxError(
  message: string,
  cursor: number,
  expression: string,
  subject?: string,
  proposals?: string[],
): PhpError {
  let m = `${message.replace(/\.+$/, '')} around position ${cursor}`
  if (expression !== '') m += ` for expression \`${expression}\``
  m += '.'
  if (subject !== undefined && proposals !== undefined) {
    let min = Number.POSITIVE_INFINITY
    let guess: string | undefined
    for (const p of proposals) {
      const d = levenshtein(subject, p)
      if (d < min) {
        guess = p
        min = d
      }
    }
    if (guess !== undefined && min < 3) m += ` Did you mean "${guess}"?`
  }
  return new PhpError('SyntaxError', m)
}

const OPERATOR_RE =
  /^(?:(?<=^|[\s(])starts with(?=[\s(])|(?<=^|[\s(])ends with(?=[\s(])|(?<=^|[\s(])contains(?=[\s(])|(?<=^|[\s(])matches(?=[\s(])|(?<=^|[\s(])not in(?=[\s(])|(?<=^|[\s(])not(?=[\s(])|(?<=^|[\s(])xor(?=[\s(])|(?<=^|[\s(])and(?=[\s(])|===|!==|(?<=^|[\s(])or(?=[\s(])|\|\||&&|==|!=|>=|<=|(?<=^|[\s(])in(?=[\s(])|\.\.|\*\*|<<|>>|!|\||\^|&|<|>|\+|-|~|\*|\/|%)/
const NUMBER_RE =
  /^(?:\.[0-9]+(?:_[0-9]+)*|[0-9]+(?:_[0-9]+)*(?:\.(?!\.)(?:[0-9]+(?:_[0-9]+)*)?)?)(?:[eE][+-]?[0-9]+(?:_[0-9]+)*)?/
const STRING_RE = /^(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/s
const NAME_RE = /^[a-zA-Z_\x7f-\uffff][a-zA-Z0-9_\x7f-\uffff]*/

/** `0 + "123"` / `0 + "1.5"` of the lexer's number literal. */
function numberLiteral(text: string): bigint | number {
  const t = text.replaceAll('_', '')
  if (/^\d+$/.test(t)) {
    const b = BigInt(t)
    return b <= 2n ** 63n - 1n ? b : Number(t)
  }
  return Number(t.startsWith('.') ? `0${t}` : t)
}

/** Lexer::tokenize */
export function tokenize(input: string): Token[] {
  const expression = input.replace(/[\r\n\t\v\f]/g, ' ')
  let cursor = 0
  const tokens: Token[] = []
  const brackets: Array<[string, number]> = []
  const end = expression.length
  while (cursor < end) {
    const ch = expression[cursor]!
    if (ch === ' ') {
      cursor++
      continue
    }
    const rest = expression.slice(cursor)
    // the operator regex uses lookbehinds against the whole string, so test it at the cursor
    const opMatch = (() => {
      const re = new RegExp(OPERATOR_RE.source.replace(/^\^/, ''), 'y')
      re.lastIndex = cursor
      return re.exec(expression)
    })()
    const number = NUMBER_RE.exec(rest)
    const string = STRING_RE.exec(rest)
    const comment = /^\/\*[\s\S]*?\*\//.exec(rest)
    const name = NAME_RE.exec(rest)
    if (number !== null) {
      tokens.push({ type: 'number', value: numberLiteral(number[0]), cursor: cursor + 1 })
      cursor += number[0].length
    } else if ('([{'.includes(ch)) {
      brackets.push([ch, cursor])
      tokens.push({ type: 'punctuation', value: ch, cursor: cursor + 1 })
      cursor++
    } else if (')]}'.includes(ch)) {
      const open = brackets.pop()
      if (open === undefined) throw syntaxError(`Unexpected "${ch}".`, cursor, expression)
      const [expect, cur] = open
      if (ch !== { '(': ')', '[': ']', '{': '}' }[expect])
        throw syntaxError(`Unclosed "${expect}".`, cur, expression)
      tokens.push({ type: 'punctuation', value: ch, cursor: cursor + 1 })
      cursor++
    } else if (string !== null) {
      tokens.push({ type: 'string', value: stripcslashes(string[0].slice(1, -1)), cursor: cursor + 1 })
      cursor += string[0].length
    } else if (comment !== null) {
      cursor += comment[0].length
    } else if (opMatch !== null) {
      tokens.push({ type: 'operator', value: opMatch[0], cursor: cursor + 1 })
      cursor += opMatch[0].length
    } else if (ch === '?' && expression[cursor + 1] === '.') {
      tokens.push({ type: 'punctuation', value: '?.', cursor: ++cursor })
      cursor++
    } else if (ch === '?' && expression[cursor + 1] === '?') {
      tokens.push({ type: 'punctuation', value: '??', cursor: ++cursor })
      cursor++
    } else if ('.,?:'.includes(ch)) {
      tokens.push({ type: 'punctuation', value: ch, cursor: cursor + 1 })
      cursor++
    } else if (name !== null) {
      tokens.push({ type: 'name', value: name[0], cursor: cursor + 1 })
      cursor += name[0].length
    } else {
      throw syntaxError(`Unexpected character "${ch}".`, cursor, expression)
    }
  }
  tokens.push({ type: 'end of expression', value: null, cursor: cursor + 1 })
  const open = brackets.pop()
  if (open !== undefined) throw syntaxError(`Unclosed "${open[0]}".`, open[1], expression)
  return tokens
}

type Node =
  | { k: 'const'; value: PhpValue }
  | { k: 'name'; name: string }
  | { k: 'nullCoalescedName'; name: string }
  | { k: 'unary'; op: string; node: Node }
  | { k: 'binary'; op: string; left: Node; right: Node }
  | { k: 'cond'; expr1: Node; expr2: Node; expr3: Node }
  | { k: 'nullCoalesce'; expr1: Node; expr2: Node }
  | { k: 'function'; name: string; args: Node[] }
  | { k: 'array'; elements: Array<{ key: Node | null; value: Node }> }
  | { k: 'getAttr'; node: Node; attr: Node; type: 'property' | 'method' | 'array' }

const UNARY: Record<string, number> = { not: 50, '!': 50, '-': 500, '+': 500, '~': 500 }
const BINARY: Record<string, [number, 'left' | 'right']> = {
  or: [10, 'left'],
  '||': [10, 'left'],
  xor: [12, 'left'],
  and: [15, 'left'],
  '&&': [15, 'left'],
  '|': [16, 'left'],
  '^': [17, 'left'],
  '&': [18, 'left'],
  '==': [20, 'left'],
  '===': [20, 'left'],
  '!=': [20, 'left'],
  '!==': [20, 'left'],
  '<': [20, 'left'],
  '>': [20, 'left'],
  '>=': [20, 'left'],
  '<=': [20, 'left'],
  'not in': [20, 'left'],
  in: [20, 'left'],
  contains: [20, 'left'],
  'starts with': [20, 'left'],
  'ends with': [20, 'left'],
  matches: [20, 'left'],
  '..': [25, 'left'],
  '<<': [25, 'left'],
  '>>': [25, 'left'],
  '+': [30, 'left'],
  '-': [30, 'left'],
  '~': [40, 'left'],
  '*': [60, 'left'],
  '/': [60, 'left'],
  '%': [60, 'left'],
  '**': [200, 'right'],
}

const valueText = (v: Token['value']) =>
  v === null ? '' : typeof v === 'number' ? toPhpString(v) : String(v)

/** Parser::parse (with TokenStream) */
class Parser {
  readonly #tokens: Token[]
  readonly #expression: string
  readonly #names: string[]
  readonly #nameSet: Set<string>
  readonly #functions: Set<string>
  #pos = 0
  #nesting = 0

  constructor(tokens: Token[], expression: string, names: string[], functions: Set<string>) {
    this.#tokens = tokens
    this.#expression = expression
    this.#names = names
    this.#nameSet = new Set(names)
    this.#functions = functions
  }

  get current(): Token {
    return this.#tokens[this.#pos]!
  }

  next(): void {
    this.#pos++
    if (this.#tokens[this.#pos] === undefined) {
      this.#pos--
      throw syntaxError('Unexpected end of expression.', this.current.cursor, this.#expression)
    }
  }

  test(t: Token, type: TokenType, value?: string): boolean {
    return t.type === type && (value === undefined || t.value === value)
  }

  expect(type: TokenType, value?: string, message?: string): void {
    const t = this.current
    if (!this.test(t, type, value)) {
      throw syntaxError(
        `${message !== undefined ? `${message}. ` : ''}Unexpected token "${t.type}" of value "${valueText(t.value)}" ("${type}" expected${value !== undefined ? ` with value "${value}"` : ''}).`,
        t.cursor,
        this.#expression,
      )
    }
    this.next()
  }

  enterNesting(): void {
    if (256 < ++this.#nesting) {
      throw syntaxError(
        'Expression is nested too deeply, the maximum nesting level is 256',
        this.current.cursor,
        this.#expression,
      )
    }
  }

  parse(): Node {
    this.#nesting = 0
    const node = this.parseExpression()
    if (this.current.type !== 'end of expression') {
      throw syntaxError(
        `Unexpected token "${this.current.type}" of value "${valueText(this.current.value)}".`,
        this.current.cursor,
        this.#expression,
      )
    }
    return node
  }

  parseExpression(precedence = 0): Node {
    const level = this.#nesting
    this.enterNesting()
    try {
      let expr = this.getPrimary()
      let token = this.current
      while (
        token.type === 'operator' &&
        BINARY[token.value as string] !== undefined &&
        BINARY[token.value as string]![0] >= precedence
      ) {
        this.enterNesting()
        const [prec, assoc] = BINARY[token.value as string]!
        this.next()
        const right = this.parseExpression(assoc === 'left' ? prec + 1 : prec)
        expr = { k: 'binary', op: token.value as string, left: expr, right }
        token = this.current
      }
      if (precedence === 0) return this.parseConditional(expr)
      return expr
    } finally {
      this.#nesting = level
    }
  }

  getPrimary(): Node {
    const token = this.current
    if (token.type === 'operator' && UNARY[token.value as string] !== undefined) {
      this.next()
      const expr = this.parseExpression(UNARY[token.value as string])
      return this.parsePostfix({ k: 'unary', op: token.value as string, node: expr })
    }
    if (this.test(token, 'punctuation', '(')) {
      this.next()
      const expr = this.parseExpression()
      this.expect('punctuation', ')', 'An opened parenthesis is not properly closed')
      return this.parsePostfix(expr)
    }
    return this.parsePrimaryExpression()
  }

  parseConditional(expr0: Node): Node {
    let expr = expr0
    while (this.test(this.current, 'punctuation', '??')) {
      this.enterNesting()
      this.next()
      expr = { k: 'nullCoalesce', expr1: expr, expr2: this.parseExpression() }
    }
    while (this.test(this.current, 'punctuation', '?')) {
      this.enterNesting()
      this.next()
      let expr2: Node
      let expr3: Node
      if (!this.test(this.current, 'punctuation', ':')) {
        expr2 = this.parseExpression()
        if (this.test(this.current, 'punctuation', ':')) {
          this.next()
          expr3 = this.parseExpression()
        } else {
          expr3 = { k: 'const', value: null }
        }
      } else {
        this.next()
        expr2 = expr
        expr3 = this.parseExpression()
      }
      expr = { k: 'cond', expr1: expr, expr2, expr3 }
    }
    return expr
  }

  parsePrimaryExpression(): Node {
    const token = this.current
    let node: Node
    switch (token.type) {
      case 'name': {
        this.next()
        const name = token.value as string
        if (name === 'true' || name === 'TRUE') return { k: 'const', value: true }
        if (name === 'false' || name === 'FALSE') return { k: 'const', value: false }
        if (name === 'null' || name === 'NULL') return { k: 'const', value: null }
        if (this.current.value === '(') {
          if (!this.#functions.has(name)) {
            throw syntaxError(
              `The function "${name}" does not exist.`,
              token.cursor,
              this.#expression,
              name,
              [...this.#functions],
            )
          }
          node = { k: 'function', name, args: this.parseArguments() }
        } else {
          if (!this.#nameSet.has(name)) {
            if (this.test(this.current, 'punctuation', '??')) return { k: 'nullCoalescedName', name }
            throw syntaxError(
              `Variable "${name}" is not valid.`,
              token.cursor,
              this.#expression,
              name,
              this.#names,
            )
          }
          node = { k: 'name', name }
        }
        break
      }
      case 'number':
      case 'string':
        this.next()
        return { k: 'const', value: token.value as PhpValue }
      default:
        if (this.test(token, 'punctuation', '[')) node = this.parseArray()
        else if (this.test(token, 'punctuation', '{')) node = this.parseHash()
        else {
          throw syntaxError(
            `Unexpected token "${token.type}" of value "${valueText(token.value)}".`,
            token.cursor,
            this.#expression,
          )
        }
    }
    return this.parsePostfix(node)
  }

  parseArray(): Node {
    this.expect('punctuation', '[', 'An array element was expected')
    const elements: Array<{ key: Node | null; value: Node }> = []
    let first = true
    while (!this.test(this.current, 'punctuation', ']')) {
      if (!first) {
        this.expect('punctuation', ',', 'An array element must be followed by a comma')
        if (this.test(this.current, 'punctuation', ']')) break
      }
      first = false
      elements.push({ key: null, value: this.parseExpression() })
    }
    this.expect('punctuation', ']', 'An opened array is not properly closed')
    return { k: 'array', elements }
  }

  parseHash(): Node {
    this.expect('punctuation', '{', 'A hash element was expected')
    const elements: Array<{ key: Node | null; value: Node }> = []
    let first = true
    while (!this.test(this.current, 'punctuation', '}')) {
      if (!first) {
        this.expect('punctuation', ',', 'A hash value must be followed by a comma')
        if (this.test(this.current, 'punctuation', '}')) break
      }
      first = false
      let key: Node
      const c = this.current
      if (c.type === 'string' || c.type === 'name' || c.type === 'number') {
        key = { k: 'const', value: c.value as PhpValue }
        this.next()
      } else if (this.test(c, 'punctuation', '(')) {
        key = this.parseExpression()
      } else {
        throw syntaxError(
          `A hash key must be a quoted string, a number, a name, or an expression enclosed in parentheses (unexpected token "${c.type}" of value "${valueText(c.value)}".`,
          c.cursor,
          this.#expression,
        )
      }
      this.expect('punctuation', ':', 'A hash key must be followed by a colon (:)')
      elements.push({ key, value: this.parseExpression() })
    }
    this.expect('punctuation', '}', 'An opened hash is not properly closed')
    return { k: 'array', elements }
  }

  parsePostfix(node0: Node): Node {
    let node = node0
    let token = this.current
    while (token.type === 'punctuation') {
      if (token.value === '.' || token.value === '?.') {
        this.enterNesting()
        this.next()
        token = this.current
        this.next()
        if (
          token.type !== 'name' &&
          (token.type !== 'operator' || !/^[a-zA-Z_\x7f-\uffff]/.test(String(token.value)))
        ) {
          throw syntaxError('Expected name.', token.cursor, this.#expression)
        }
        const attr: Node = { k: 'const', value: token.value as PhpValue }
        if (this.test(this.current, 'punctuation', '(')) {
          this.parseArguments()
          node = { k: 'getAttr', node, attr, type: 'method' }
        } else {
          node = { k: 'getAttr', node, attr, type: 'property' }
        }
      } else if (token.value === '[') {
        this.enterNesting()
        this.next()
        const attr = this.parseExpression()
        this.expect('punctuation', ']')
        node = { k: 'getAttr', node, attr, type: 'array' }
      } else {
        break
      }
      token = this.current
    }
    return node
  }

  parseArguments(): Node[] {
    const args: Node[] = []
    this.expect('punctuation', '(', 'A list of arguments must begin with an opening parenthesis')
    while (!this.test(this.current, 'punctuation', ')')) {
      if (args.length > 0) this.expect('punctuation', ',', 'Arguments must be separated by a comma')
      args.push(this.parseExpression())
    }
    this.expect('punctuation', ')', 'A list of arguments must be closed by a parenthesis')
    return args
  }
}

/** An ExpressionFunction's evaluator: receives the evaluated arguments (without `$values`). */
export type ExpressionFunction = (values: ReadonlyMap<string, PhpValue>, args: PhpValue[]) => PhpValue

/** Integer-or-float shift helpers for `<<`/`>>`/bitwise ops (operands as int). */
function intOperand(v: PhpValue, op: string, other: PhpValue): bigint {
  const n = mul(v, 1n)
  if (Array.isArray(v)) throw new PhpError('TypeError', `Unsupported operand types: array ${op} ${other}`)
  return typeof n === 'bigint' ? n : BigInt.asIntN(64, BigInt(Math.trunc(n as number)))
}

function evaluate(
  node: Node,
  fns: ReadonlyMap<string, ExpressionFunction>,
  values: ReadonlyMap<string, PhpValue>,
): PhpValue {
  switch (node.k) {
    case 'const':
      return node.value
    case 'name':
      return values.get(node.name) ?? null
    case 'nullCoalescedName':
      return values.get(node.name) ?? null
    case 'unary': {
      const v = evaluate(node.node, fns, values)
      if (node.op === 'not' || node.op === '!') return !truthy(v)
      if (node.op === '-') return negate(v)
      if (node.op === '~') return ~intOperand(v, '~', null)
      return v
    }
    case 'cond':
      return truthy(evaluate(node.expr1, fns, values))
        ? evaluate(node.expr2, fns, values)
        : evaluate(node.expr3, fns, values)
    case 'nullCoalesce': {
      const v = evaluate(node.expr1, fns, values)
      return v ?? evaluate(node.expr2, fns, values)
    }
    case 'function': {
      const args = node.args.map((a) => evaluate(a, fns, values))
      return fns.get(node.name)!(values, args)
    }
    case 'array':
      return node.elements.map((e) => evaluate(e.value, fns, values))
    case 'getAttr': {
      const base = evaluate(node.node, fns, values)
      if (node.type === 'array' && Array.isArray(base)) {
        const key = evaluate(node.attr, fns, values)
        return base[Number(key)] ?? null
      }
      // GetAttrNode::evaluate on a non-object (this port has no objects)
      const dump = (n: Node) =>
        n.k === 'name'
          ? n.name
          : n.k === 'const'
            ? toPhpString(n.value)
            : n.k === 'function'
              ? `${n.name}(...)`
              : '...'
      const message =
        node.type === 'property'
          ? `Unable to get property "${dump(node.attr)}" of non-object "${dump(node.node)}".`
          : node.type === 'method'
            ? `Unable to call method "${dump(node.attr)}" of non-object "${dump(node.node)}".`
            : `Unable to get an item of non-array "${dump(node.node)}".`
      throw new PhpError('TypeError', message)
    }
    case 'binary':
      return evaluateBinary(node, fns, values)
  }
}

function evaluateBinary(
  node: Extract<Node, { k: 'binary' }>,
  fns: ReadonlyMap<string, ExpressionFunction>,
  values: ReadonlyMap<string, PhpValue>,
): PhpValue {
  const left = evaluate(node.left, fns, values)
  const op = node.op
  const right = () => evaluate(node.right, fns, values)
  switch (op) {
    case 'or':
    case '||':
      return truthy(left) || truthy(right())
    case 'and':
    case '&&':
      return truthy(left) && truthy(right())
    case 'xor':
      return truthy(left) !== truthy(right())
  }
  const r = right()
  switch (op) {
    case '**':
      return pow(left, r)
    case '..': {
      const from = Number(left)
      const to = Number(r)
      const out: PhpValue[] = []
      for (let i = from; from <= to ? i <= to : i >= to; i += from <= to ? 1 : -1) out.push(BigInt(i))
      return out
    }
    case 'in':
      return inArrayStrict(left, r)
    case 'not in':
      return !inArrayStrict(left, r)
    case 'contains':
      return toPhpString(left).includes(toPhpString(r))
    case 'starts with':
      return toPhpString(left).startsWith(toPhpString(r))
    case 'ends with':
      return toPhpString(left).endsWith(toPhpString(r))
    case '|':
      return intOperand(left, '|', r) | intOperand(r, '|', left)
    case '^':
      return intOperand(left, '^', r) ^ intOperand(r, '^', left)
    case '&':
      return intOperand(left, '&', r) & intOperand(r, '&', left)
    case '<<':
      return BigInt.asIntN(64, intOperand(left, '<<', r) << intOperand(r, '<<', left))
    case '>>':
      return intOperand(left, '>>', r) >> intOperand(r, '>>', left)
    case '==':
      return looseEquals(left, r)
    case '===':
      return strictEquals(left, r)
    case '!=':
      return !looseEquals(left, r)
    case '!==':
      return !strictEquals(left, r)
    case '<':
      return compare(left, r) < 0
    case '>':
      return compare(left, r) > 0
    case '>=':
      return compare(left, r) >= 0
    case '<=':
      return compare(left, r) <= 0
    case '+':
      return add(left, r)
    case '-':
      return sub(left, r)
    case '~':
      return toPhpString(left) + toPhpString(r)
    case '*':
      return mul(left, r)
    case '/':
      if (looseEquals(0n, r)) throw new PhpError('DivisionByZeroError', 'Division by zero.')
      return div(left, r)
    case '%':
      if (looseEquals(0n, r)) throw new PhpError('DivisionByZeroError', 'Modulo by zero.')
      return mod(left, r)
    case 'matches': {
      const re = pcreToRegExp(toPhpString(r))
      if (re === null) {
        throw new PhpError('SyntaxError', `Regexp "${toPhpString(r)}" passed to "matches" is not valid`)
      }
      return re.test(toPhpString(left)) ? 1n : 0n
    }
  }
  throw new PhpError('TypeError', `"BinaryNode" does not support the "${op}" operator.`)
}

/**
 * ExpressionLanguage with the given functions: `evaluate(expression, values)` parses with the value
 * names as the allowed variables (unknown names are a SyntaxError, like Symfony) and evaluates.
 * Parsed expressions are cached per (expression, names) like ExpressionLanguage's ArrayAdapter.
 */
export class ExpressionLanguage {
  readonly #functions = new Map<string, ExpressionFunction>()
  readonly #cache = new Map<string, Node>()

  constructor() {
    // ExpressionLanguage::registerFunctions: constant, min, max, enum
    this.register('min', (_v, args) => phpMinMax(args, -1))
    this.register('max', (_v, args) => phpMinMax(args, 1))
    this.register('constant', (_v, args) => {
      throw new PhpError('ValueError', `Undefined constant "${toPhpString(args[0] ?? null)}"`)
    })
    this.register('enum', (_v, args) => {
      throw new PhpError('ValueError', `Undefined constant "${toPhpString(args[0] ?? null)}"`)
    })
  }

  register(name: string, fn: ExpressionFunction): void {
    this.#functions.set(name, fn)
  }

  parse(expression: string, names: string[]): Node {
    const key = `${expression}//${names.join('|')}`
    let node = this.#cache.get(key)
    if (node === undefined) {
      const tokens = tokenize(expression)
      node = new Parser(
        tokens,
        expression.replace(/[\r\n\t\v\f]/g, ' '),
        names,
        new Set(this.#functions.keys()),
      ).parse()
      this.#cache.set(key, node)
    }
    return node
  }

  evaluate(expression: string, values: ReadonlyMap<string, PhpValue>): PhpValue {
    return evaluate(this.parse(expression, [...values.keys()]), this.#functions, values)
  }
}

function phpMinMax(args: PhpValue[], dir: 1 | -1): PhpValue {
  const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
  if (list.length === 0) {
    throw new PhpError(
      'ValueError',
      `${dir > 0 ? 'max' : 'min'}(): Argument #1 ($value) must contain at least one element`,
    )
  }
  let best: PhpValue = list[0] ?? null
  for (const v of list.slice(1)) if (compare(v, best) * dir > 0) best = v
  return best
}
