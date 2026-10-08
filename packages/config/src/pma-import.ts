/**
 * `importPmaConfig(phpSource)`: converts a phpMyAdmin `config.inc.php` into a BetterMyAdmin
 * config object without a PHP runtime (`bma import-pma-config`, parity exception X6).
 *
 * pma: config.sample.inc.php, examples/config.manyhosts.inc.php, src/Config.php::loadFromFile
 *
 * A small lexer, parser and interpreter for the PHP subset found in configuration files:
 *  - `<?php`, `?>`, `declare(strict_types=1);`, `namespace`/`use` lines (ignored), comments
 *    (`//`, `#`, `/* *\/`)
 *  - assignments to variables and array paths: `$cfg['X'] = ...;`,
 *    `$cfg['Servers'][$i]['host'] = ...;`, `$cfg['Servers'][] = [...];`, compound `.=`, `+=`, `-=`
 *  - `$i++`, `++$i`, `$i--`, `--$i`
 *  - `foreach (expr as [$k =>] $v) ...`, `if / elseif / else`, `{ ... }` blocks, `return;`
 *  - literals: single/double quoted strings (escapes, `$var` / `{$expr}` interpolation),
 *    ints (decimal, hex, octal, binary, `_` separators), floats, `true`/`false`/`null`,
 *    `array(...)` and `[...]` (nested, keyed or positional, trailing commas)
 *  - operators: `.`, `+ - * / %`, `! && || and or`, `== != === !== < <= > >=`, `?:`, `??`, casts
 *  - functions: `sodium_hex2bin`, `hex2bin` (kept as the hex string, see below), `getenv`
 *    (from `options.env`), `isset`, `empty`, `strval`, `intval`, `boolval`, `implode`, `explode`,
 *    `trim`, `strtolower`, `strtoupper`, `sprintf` (`%s`/`%d`), `dirname`; constants `__DIR__`,
 *    `__FILE__`, `PHP_EOL`, `DIRECTORY_SEPARATOR`
 *
 * PHP array semantics are reproduced: ordered keys, `"1"` keys normalised to int 1, `[]`
 * appends at max-int-key + 1, copy-on-assign. An array whose keys are exactly 0..n-1 becomes a
 * JS array, anything else an object (so `$cfg['Servers'][1..n]` becomes `{ "1": ..., "2": ... }`,
 * which the loader treats as 1-based server indices).
 *
 * `blowfish_secret = sodium_hex2bin('<64 hex>')` (what phpMyAdmin's setup writes) yields raw
 * bytes in PHP; we keep the 64-character hex string instead (a valid 32+ byte secret, since
 * BetterMyAdmin derives keys with HKDF and does not share cookies with phpMyAdmin) and emit a
 * warning.
 */

export class PmaImportError extends Error {
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(`config.inc.php:${line}:${column}: ${message}`)
    this.name = 'PmaImportError'
    this.line = line
    this.column = column
  }
}

export interface PmaImportOptions {
  /** Values returned by `getenv()`; missing names return `false` like PHP. */
  env?: Readonly<Record<string, string | undefined>>
  /** Value of `__DIR__` (default `.`). */
  dir?: string
  /** Value of `__FILE__` (default `<dir>/config.inc.php`). */
  file?: string
}

export interface PmaImportResult {
  /** `$cfg` converted to plain JS values (unvalidated; pass to the loader / `validateConfig`). */
  config: Record<string, unknown>
  warnings: string[]
}

// ---------------------------------------------------------------------------
// PHP values
// ---------------------------------------------------------------------------

type Key = string | number
type PVal = null | boolean | number | string | PhpArray

class PhpArray {
  readonly map = new Map<Key, PVal>()
  nextIndex = 0

  static normalizeKey(k: PVal, at: Pos): Key {
    if (typeof k === 'number') return Math.trunc(k)
    if (typeof k === 'boolean') return k ? 1 : 0
    if (k === null) return ''
    if (typeof k === 'string') {
      if (/^(0|-?[1-9]\d*)$/.test(k) && Number.isSafeInteger(Number(k))) return Number(k)
      return k
    }
    throw err('illegal offset type (array used as key)', at)
  }

  set(k: Key, v: PVal): void {
    this.map.set(k, v)
    if (typeof k === 'number' && k >= this.nextIndex) this.nextIndex = k + 1
  }

  push(v: PVal): void {
    this.set(this.nextIndex, v)
  }

  clone(): PhpArray {
    const a = new PhpArray()
    for (const [k, v] of this.map) a.map.set(k, v instanceof PhpArray ? v.clone() : v)
    a.nextIndex = this.nextIndex
    return a
  }
}

const copy = (v: PVal): PVal => (v instanceof PhpArray ? v.clone() : v)

function truthy(v: PVal): boolean {
  if (v instanceof PhpArray) return v.map.size > 0
  return !(v === null || v === false || v === 0 || v === '' || v === '0')
}

function toStr(v: PVal, at: Pos, warnings: string[]): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (v === true) return '1'
  if (v === false || v === null) return ''
  warnings.push(`line ${at.line}: array to string conversion`)
  return 'Array'
}

function toNum(v: PVal): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null) return 0
  if (typeof v === 'string') {
    const m = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(v)
    return m ? Number(m[0]) : 0
  }
  return v.map.size > 0 ? 1 : 0
}

function looseEq(a: PVal, b: PVal): boolean {
  if (a instanceof PhpArray || b instanceof PhpArray) return strictEq(a, b)
  if (typeof a === typeof b) return a === b
  if (a === null || b === null || typeof a === 'boolean' || typeof b === 'boolean')
    return truthy(a) === truthy(b)
  return toNum(a) === toNum(b)
}

function strictEq(a: PVal, b: PVal): boolean {
  if (a instanceof PhpArray && b instanceof PhpArray) {
    if (a.map.size !== b.map.size) return false
    const ka = [...a.map.keys()]
    const kb = [...b.map.keys()]
    return ka.every((k, i) => k === kb[i] && strictEq(a.map.get(k) ?? null, b.map.get(k) ?? null))
  }
  return a === b
}

/** PHP value -> JS value (`array_is_list` arrays become JS arrays). */
function toJs(v: PVal): unknown {
  if (!(v instanceof PhpArray)) return v
  const keys = [...v.map.keys()]
  const isList = keys.every((k, i) => k === i)
  if (isList) return keys.map((k) => toJs(v.map.get(k) ?? null))
  const out: Record<string, unknown> = {}
  for (const [k, x] of v.map) out[String(k)] = toJs(x)
  return out
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

interface Pos {
  line: number
  col: number
}

type TplPart = string | { code: string; pos: Pos }

type Tok =
  | ({ t: 'var'; v: string } & Pos)
  | ({ t: 'id'; v: string } & Pos)
  | ({ t: 'num'; v: number } & Pos)
  | ({ t: 'str'; v: string } & Pos)
  | ({ t: 'tpl'; parts: TplPart[] } & Pos)
  | ({ t: 'op'; v: string } & Pos)
  | ({ t: 'cast'; v: string } & Pos)
  | ({ t: 'eof' } & Pos)

function err(message: string, at: Pos): PmaImportError {
  return new PmaImportError(message, at.line, at.col)
}

const OPS = [
  '===',
  '!==',
  '**=',
  '...',
  '<=>',
  '??=',
  '=>',
  '==',
  '!=',
  '<>',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '++',
  '--',
  '.=',
  '+=',
  '-=',
  '*=',
  '/=',
  '::',
  '->',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  ';',
  ',',
  '=',
  '.',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '?',
  ':',
  '<',
  '>',
  '&',
  '@',
]

const CASTS = new Set(['int', 'integer', 'bool', 'boolean', 'string', 'float', 'double', 'array'])

function lex(src: string, startPos: Pos = { line: 1, col: 1 }, codeMode = false): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = startPos.line
  let col = startPos.col
  const pos = (): Pos => ({ line, col })
  const advance = (n: number): void => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++
        col = 1
      } else col++
      i++
    }
  }

  let inPhp = codeMode
  while (i < src.length) {
    if (!inPhp) {
      const open = src.indexOf('<?php', i)
      if (open === -1) break
      // inline HTML before <?php is ignored (PHP would output it)
      advance(open - i + 5)
      inPhp = true
      continue
    }
    const c = src[i] as string
    if (/\s/.test(c)) {
      advance(1)
      continue
    }
    if (src.startsWith('?>', i)) {
      advance(2)
      toks.push({ t: 'op', v: ';', ...pos() })
      inPhp = false
      continue
    }
    if (src.startsWith('//', i) || (c === '#' && src[i + 1] !== '[')) {
      while (i < src.length && src[i] !== '\n' && !src.startsWith('?>', i)) advance(1)
      continue
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw err('unterminated comment', pos())
      advance(end + 2 - i)
      continue
    }
    const start = pos()
    if (c === '$' && /[A-Za-z_\x80-￿]/.test(src[i + 1] ?? '')) {
      let j = i + 1
      while (j < src.length && /[\w\x80-￿]/.test(src[j] as string)) j++
      toks.push({ t: 'var', v: src.slice(i + 1, j), ...start })
      advance(j - i)
      continue
    }
    if (/[A-Za-z_\\\x80-￿]/.test(c)) {
      let j = i
      while (j < src.length && /[\w\\\x80-￿]/.test(src[j] as string)) j++
      const word = src.slice(i, j)
      toks.push({ t: 'id', v: word, ...start })
      advance(j - i)
      continue
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(\d[\d_]*)?\.?[\d_]*([eE][+-]?\d+)?)/.exec(
        src.slice(i),
      )
      const text = (m?.[0] ?? c).replaceAll('_', '')
      let v: number
      if (/^0[xX]/.test(text)) v = Number.parseInt(text.slice(2), 16)
      else if (/^0[bB]/.test(text)) v = Number.parseInt(text.slice(2), 2)
      else if (/^0[oO]/.test(text)) v = Number.parseInt(text.slice(2), 8)
      else if (/^0\d+$/.test(text)) v = Number.parseInt(text.slice(1), 8)
      else v = Number(text)
      if (Number.isNaN(v)) throw err(`invalid number ${JSON.stringify(m?.[0])}`, start)
      toks.push({ t: 'num', v, ...start })
      advance(m?.[0].length ?? 1)
      continue
    }
    if (c === "'") {
      let j = i + 1
      let out = ''
      while (j < src.length && src[j] !== "'") {
        if (src[j] === '\\' && (src[j + 1] === "'" || src[j + 1] === '\\')) {
          out += src[j + 1]
          j += 2
        } else {
          out += src[j]
          j++
        }
      }
      if (j >= src.length) throw err('unterminated string', start)
      toks.push({ t: 'str', v: out, ...start })
      advance(j + 1 - i)
      continue
    }
    if (c === '"') {
      const { parts, end } = lexDoubleQuoted(src, i + 1, start)
      const simple = parts.every((p) => typeof p === 'string')
      if (simple) toks.push({ t: 'str', v: parts.join(''), ...start })
      else toks.push({ t: 'tpl', parts, ...start })
      advance(end + 1 - i)
      continue
    }
    if (src.startsWith('<<<', i)) throw err('heredoc/nowdoc strings are not supported', start)
    if (c === '(') {
      const m = /^\(\s*([A-Za-z]+)\s*\)/.exec(src.slice(i))
      if (m && CASTS.has((m[1] as string).toLowerCase())) {
        toks.push({ t: 'cast', v: (m[1] as string).toLowerCase(), ...start })
        advance(m[0].length)
        continue
      }
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw err(`unexpected character ${JSON.stringify(c)}`, start)
    toks.push({ t: 'op', v: op, ...start })
    advance(op.length)
  }
  toks.push({ t: 'eof', ...pos() })
  return toks
}

function lexDoubleQuoted(src: string, from: number, start: Pos): { parts: TplPart[]; end: number } {
  const parts: TplPart[] = []
  let buf = ''
  let j = from
  const flush = (): void => {
    if (buf !== '') parts.push(buf)
    buf = ''
  }
  while (j < src.length && src[j] !== '"') {
    const ch = src[j] as string
    if (ch === '\\') {
      const n = src[j + 1] ?? ''
      const simple: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        v: '\v',
        e: '\x1b',
        f: '\f',
        '\\': '\\',
        $: '$',
        '"': '"',
      }
      if (n in simple) {
        buf += simple[n]
        j += 2
      } else if (/[0-7]/.test(n)) {
        const m = /^[0-7]{1,3}/.exec(src.slice(j + 1)) as RegExpExecArray
        buf += String.fromCharCode(Number.parseInt(m[0], 8) & 0xff)
        j += 1 + m[0].length
      } else if (n === 'x' && /[\da-fA-F]/.test(src[j + 2] ?? '')) {
        const m = /^[\da-fA-F]{1,2}/.exec(src.slice(j + 2)) as RegExpExecArray
        buf += String.fromCharCode(Number.parseInt(m[0], 16))
        j += 2 + m[0].length
      } else if (n === 'u' && src[j + 2] === '{') {
        const close = src.indexOf('}', j + 3)
        buf += String.fromCodePoint(Number.parseInt(src.slice(j + 3, close), 16))
        j = close + 1
      } else {
        buf += ch
        j++
      }
      continue
    }
    if (ch === '$' && /[A-Za-z_]/.test(src[j + 1] ?? '')) {
      flush()
      let k = j + 1
      while (k < src.length && /\w/.test(src[k] as string)) k++
      let code = src.slice(j, k)
      // simple syntax: "$arr[key]" / "$arr[0]" / "$arr[$i]"
      const m = /^\[(\$?\w+)\]/.exec(src.slice(k))
      if (m) {
        const key = m[1] as string
        code += /^(\$|\d)/.test(key) ? `[${key}]` : `['${key}']`
        k += m[0].length
      }
      parts.push({ code, pos: start })
      j = k
      continue
    }
    if ((ch === '{' && src[j + 1] === '$') || (ch === '$' && src[j + 1] === '{')) {
      flush()
      let depth = 1
      let k = j + (ch === '{' ? 1 : 2)
      const codeStart = k
      while (k < src.length && depth > 0) {
        if (src[k] === '{') depth++
        else if (src[k] === '}') depth--
        if (depth > 0) k++
      }
      const inner = src.slice(codeStart, k)
      parts.push({ code: ch === '$' ? `$${inner}` : inner, pos: start })
      j = k + 1
      continue
    }
    buf += ch
    j++
  }
  if (j >= src.length) throw err('unterminated string', start)
  flush()
  return { parts, end: j }
}

// ---------------------------------------------------------------------------
// Parser (AST)
// ---------------------------------------------------------------------------

type Expr =
  | ({ k: 'lit'; v: PVal } & Pos)
  | ({ k: 'var'; name: string } & Pos)
  | ({ k: 'idx'; base: Expr; key: Expr | null } & Pos)
  | ({ k: 'arr'; items: { key: Expr | null; value: Expr }[] } & Pos)
  | ({ k: 'bin'; op: string; l: Expr; r: Expr } & Pos)
  | ({ k: 'un'; op: string; e: Expr } & Pos)
  | ({ k: 'cast'; type: string; e: Expr } & Pos)
  | ({ k: 'call'; name: string; args: Expr[] } & Pos)
  | ({ k: 'tern'; c: Expr; a: Expr | null; b: Expr } & Pos)
  | ({ k: 'tpl'; parts: (string | Expr)[] } & Pos)
  | ({ k: 'const'; name: string } & Pos)
  | ({ k: 'assign'; target: Expr; op: string; value: Expr } & Pos)
  | ({ k: 'incdec'; target: Expr; op: '++' | '--'; prefix: boolean } & Pos)

type Stmt =
  | ({ k: 'expr'; e: Expr } & Pos)
  | ({ k: 'foreach'; subject: Expr; key: Expr | null; value: Expr; body: Stmt[] } & Pos)
  | ({ k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; otherwise: Stmt[] | null } & Pos)
  | ({ k: 'block'; body: Stmt[] } & Pos)
  | ({ k: 'return' } & Pos)
  | ({ k: 'unset'; targets: Expr[] } & Pos)

class Parser {
  private i = 0
  private readonly toks: Tok[]

  constructor(toks: Tok[]) {
    this.toks = toks
  }

  private peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)] as Tok
  }

  private next(): Tok {
    const t = this.peek()
    if (this.i < this.toks.length - 1) this.i++
    return t
  }

  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o)
    return t.t === 'op' && t.v === v
  }

  private isId(v: string, o = 0): boolean {
    const t = this.peek(o)
    return t.t === 'id' && t.v.toLowerCase() === v
  }

  private expectOp(v: string): Tok {
    const t = this.next()
    if (t.t !== 'op' || t.v !== v) throw err(`expected "${v}", found ${describe(t)}`, t)
    return t
  }

  atEnd(): boolean {
    return this.peek().t === 'eof'
  }

  program(): Stmt[] {
    const out: Stmt[] = []
    while (!this.atEnd()) {
      const s = this.statement()
      if (s) out.push(s)
    }
    return out
  }

  private block(): Stmt[] {
    if (this.isOp('{')) {
      this.next()
      const body: Stmt[] = []
      while (!this.isOp('}')) {
        if (this.atEnd()) throw err('unexpected end of file, expected "}"', this.peek())
        const s = this.statement()
        if (s) body.push(s)
      }
      this.next()
      return body
    }
    if (this.isOp(':')) throw err('alternative syntax (endif/endforeach) is not supported', this.peek())
    const s = this.statement()
    return s ? [s] : []
  }

  private skipToSemicolon(): void {
    while (!this.isOp(';') && !this.atEnd()) this.next()
    if (this.isOp(';')) this.next()
  }

  private statement(): Stmt | null {
    const t = this.peek()
    if (t.t === 'op' && t.v === ';') {
      this.next()
      return null
    }
    if (t.t === 'op' && t.v === '{') return { k: 'block', body: this.block(), line: t.line, col: t.col }
    if (t.t === 'id') {
      const w = t.v.toLowerCase()
      if (w === 'declare' || w === 'namespace' || w === 'use') {
        this.skipToSemicolon()
        return null
      }
      if (w === 'return' || w === 'exit' || w === 'die') {
        this.skipToSemicolon()
        return { k: 'return', line: t.line, col: t.col }
      }
      if (w === 'foreach') return this.foreachStmt()
      if (w === 'if') return this.ifStmt()
      if (w === 'unset') {
        this.next()
        this.expectOp('(')
        const targets: Expr[] = []
        while (!this.isOp(')')) {
          targets.push(this.expression())
          if (this.isOp(',')) this.next()
        }
        this.next()
        this.expectOp(';')
        return { k: 'unset', targets, line: t.line, col: t.col }
      }
      if (['require', 'require_once', 'include', 'include_once'].includes(w)) {
        throw err(`${w} is not supported; inline the included file`, t)
      }
      if (['function', 'class', 'for', 'while', 'do', 'switch'].includes(w)) {
        throw err(`"${t.v}" is not supported in imported configuration files`, t)
      }
    }
    const e = this.expression()
    this.expectOp(';')
    return { k: 'expr', e, line: t.line, col: t.col }
  }

  private foreachStmt(): Stmt {
    const t = this.next()
    this.expectOp('(')
    const subject = this.expression()
    if (!this.isId('as')) throw err('expected "as" in foreach', this.peek())
    this.next()
    let key: Expr | null = null
    let value = this.postfix()
    if (this.isOp('=>')) {
      this.next()
      key = value
      value = this.postfix()
    }
    this.expectOp(')')
    return { k: 'foreach', subject, key, value, body: this.block(), line: t.line, col: t.col }
  }

  private ifStmt(): Stmt {
    const t = this.next()
    const branches: { cond: Expr; body: Stmt[] }[] = []
    this.expectOp('(')
    let cond = this.expression()
    this.expectOp(')')
    branches.push({ cond, body: this.block() })
    let otherwise: Stmt[] | null = null
    for (;;) {
      if (this.isId('elseif') || (this.isId('else') && this.isId('if', 1))) {
        if (this.isId('else')) this.next()
        this.next()
        this.expectOp('(')
        cond = this.expression()
        this.expectOp(')')
        branches.push({ cond, body: this.block() })
        continue
      }
      if (this.isId('else')) {
        this.next()
        otherwise = this.block()
      }
      break
    }
    return { k: 'if', branches, otherwise, line: t.line, col: t.col }
  }

  expression(): Expr {
    return this.assignment()
  }

  private assignment(): Expr {
    const left = this.ternary()
    const t = this.peek()
    if (t.t === 'op' && ['=', '.=', '+=', '-=', '*=', '/=', '??='].includes(t.v)) {
      if (left.k !== 'var' && left.k !== 'idx') throw err('invalid assignment target', t)
      this.next()
      if (this.isOp('&')) throw err('references (=&) are not supported', this.peek())
      const value = this.assignment()
      return { k: 'assign', target: left, op: t.v, value, line: t.line, col: t.col }
    }
    return left
  }

  private ternary(): Expr {
    const c = this.coalesce()
    if (this.isOp('?')) {
      const t = this.next()
      let a: Expr | null = null
      if (!this.isOp(':')) a = this.assignment()
      this.expectOp(':')
      const b = this.assignment()
      return { k: 'tern', c, a, b, line: t.line, col: t.col }
    }
    return c
  }

  private coalesce(): Expr {
    const l = this.binary(0)
    if (this.isOp('??')) {
      const t = this.next()
      const r = this.coalesce()
      return { k: 'bin', op: '??', l, r, line: t.line, col: t.col }
    }
    return l
  }

  private static readonly LEVELS: readonly (readonly string[])[] = [
    ['or'],
    ['and'],
    ['||'],
    ['&&'],
    ['==', '!=', '===', '!==', '<>'],
    ['<', '<=', '>', '>='],
    ['.'],
    ['+', '-'],
    ['*', '/', '%'],
  ]

  private binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary()
    let l = this.binary(level + 1)
    const ops = Parser.LEVELS[level] as readonly string[]
    for (;;) {
      const t = this.peek()
      const v = t.t === 'op' ? t.v : t.t === 'id' ? t.v.toLowerCase() : null
      if (v === null || !ops.includes(v) || (t.t === 'id' && v !== 'and' && v !== 'or')) break
      this.next()
      const r = this.binary(level + 1)
      l = { k: 'bin', op: v === 'and' ? '&&' : v === 'or' ? '||' : v, l, r, line: t.line, col: t.col }
    }
    return l
  }

  private unary(): Expr {
    const t = this.peek()
    if (t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '+')) {
      this.next()
      return { k: 'un', op: t.v, e: this.unary(), line: t.line, col: t.col }
    }
    if (t.t === 'op' && t.v === '@') {
      this.next()
      return this.unary()
    }
    if (t.t === 'op' && (t.v === '++' || t.v === '--')) {
      this.next()
      const target = this.postfix()
      return { k: 'incdec', target, op: t.v, prefix: true, line: t.line, col: t.col }
    }
    if (t.t === 'cast') {
      this.next()
      return { k: 'cast', type: t.v, e: this.unary(), line: t.line, col: t.col }
    }
    return this.postfix()
  }

  private postfix(): Expr {
    let e = this.primary()
    for (;;) {
      const t = this.peek()
      if (t.t === 'op' && t.v === '[') {
        this.next()
        if (this.isOp(']')) {
          this.next()
          e = { k: 'idx', base: e, key: null, line: t.line, col: t.col }
          continue
        }
        const key = this.expression()
        this.expectOp(']')
        e = { k: 'idx', base: e, key, line: t.line, col: t.col }
        continue
      }
      if (t.t === 'op' && (t.v === '++' || t.v === '--')) {
        this.next()
        e = { k: 'incdec', target: e, op: t.v, prefix: false, line: t.line, col: t.col }
        continue
      }
      if (t.t === 'op' && (t.v === '->' || t.v === '::'))
        throw err('objects and classes are not supported', t)
      break
    }
    return e
  }

  private arrayItems(close: string): { key: Expr | null; value: Expr }[] {
    const items: { key: Expr | null; value: Expr }[] = []
    while (!this.isOp(close)) {
      if (this.atEnd()) throw err(`unexpected end of file, expected "${close}"`, this.peek())
      if (this.isOp('...')) throw err('array unpacking (...) is not supported', this.peek())
      const first = this.expression()
      if (this.isOp('=>')) {
        this.next()
        items.push({ key: first, value: this.expression() })
      } else items.push({ key: null, value: first })
      if (this.isOp(',')) this.next()
      else if (!this.isOp(close))
        throw err(`expected "," or "${close}" in array, found ${describe(this.peek())}`, this.peek())
    }
    this.next()
    return items
  }

  private primary(): Expr {
    const t = this.next()
    switch (t.t) {
      case 'num':
      case 'str':
        return { k: 'lit', v: t.v, line: t.line, col: t.col }
      case 'tpl':
        return {
          k: 'tpl',
          parts: t.parts.map((p) => (typeof p === 'string' ? p : parseInner(p.code, p.pos))),
          line: t.line,
          col: t.col,
        }
      case 'var':
        return { k: 'var', name: t.v, line: t.line, col: t.col }
      case 'op':
        if (t.v === '(') {
          const e = this.expression()
          this.expectOp(')')
          return e
        }
        if (t.v === '[') return { k: 'arr', items: this.arrayItems(']'), line: t.line, col: t.col }
        throw err(`unexpected ${describe(t)}`, t)
      case 'id': {
        const name = t.v.replace(/^\\/, '')
        const lower = name.toLowerCase()
        if (lower === 'array' && this.isOp('(')) {
          this.next()
          return { k: 'arr', items: this.arrayItems(')'), line: t.line, col: t.col }
        }
        if (lower === 'true' || lower === 'false')
          return { k: 'lit', v: lower === 'true', line: t.line, col: t.col }
        if (lower === 'null') return { k: 'lit', v: null, line: t.line, col: t.col }
        if (this.isOp('(')) {
          this.next()
          const args: Expr[] = []
          while (!this.isOp(')')) {
            args.push(this.expression())
            if (this.isOp(',')) this.next()
            else if (!this.isOp(')'))
              throw err(`expected "," or ")" in call, found ${describe(this.peek())}`, this.peek())
          }
          this.next()
          return { k: 'call', name: lower, args, line: t.line, col: t.col }
        }
        if (lower === 'new') throw err('objects are not supported', t)
        return { k: 'const', name, line: t.line, col: t.col }
      }
      case 'cast':
        throw err(`unexpected cast (${t.v})`, t)
      case 'eof':
        throw err('unexpected end of file', t)
    }
  }
}

function describe(t: Tok): string {
  switch (t.t) {
    case 'eof':
      return 'end of file'
    case 'var':
      return `$${t.v}`
    case 'str':
      return JSON.stringify(t.v)
    case 'tpl':
      return 'string'
    case 'cast':
      return `(${t.v})`
    default:
      return `"${String(t.v)}"`
  }
}

function parseInner(code: string, pos: Pos): Expr {
  const p = new Parser(lex(code, pos, true))
  const e = p.expression()
  if (!p.atEnd()) throw err(`cannot parse interpolation ${JSON.stringify(code)}`, pos)
  return e
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

class Return {}

class Interp {
  readonly vars = new Map<string, PVal>()
  readonly warnings: string[] = []

  private readonly opts: PmaImportOptions

  constructor(opts: PmaImportOptions) {
    this.opts = opts
    this.vars.set('cfg', new PhpArray())
  }

  run(stmts: Stmt[]): void {
    try {
      this.exec(stmts)
    } catch (e) {
      if (!(e instanceof Return)) throw e
    }
  }

  private exec(stmts: Stmt[]): void {
    for (const s of stmts) this.stmt(s)
  }

  private stmt(s: Stmt): void {
    switch (s.k) {
      case 'expr':
        this.eval(s.e)
        return
      case 'block':
        this.exec(s.body)
        return
      case 'return':
        throw new Return()
      case 'unset':
        for (const t of s.targets) this.unset(t)
        return
      case 'if': {
        for (const b of s.branches) {
          if (truthy(this.eval(b.cond))) {
            this.exec(b.body)
            return
          }
        }
        if (s.otherwise) this.exec(s.otherwise)
        return
      }
      case 'foreach': {
        const subject = this.eval(s.subject)
        if (!(subject instanceof PhpArray)) {
          this.warnings.push(`line ${s.line}: foreach over a non-array value; skipped`)
          return
        }
        for (const [k, v] of [...subject.map]) {
          if (s.key) this.assignTo(s.key, k)
          this.assignTo(s.value, copy(v))
          this.exec(s.body)
        }
        return
      }
    }
  }

  private unset(t: Expr): void {
    if (t.k === 'var') {
      this.vars.delete(t.name)
      return
    }
    if (t.k === 'idx' && t.key) {
      this.container(t.base, false)?.map.delete(PhpArray.normalizeKey(this.eval(t.key), t))
      return
    }
    throw err('invalid unset() target', t)
  }

  /** Live array at an lvalue path, creating intermediate arrays when `create`. */
  private container(e: Expr, create: boolean): PhpArray | undefined {
    if (e.k === 'var') {
      let v = this.vars.get(e.name)
      if (!(v instanceof PhpArray)) {
        if (!create) return undefined
        if (v !== undefined && v !== null && v !== '')
          throw err(`cannot use $${e.name} (a scalar) as an array`, e)
        v = new PhpArray()
        this.vars.set(e.name, v)
      }
      return v
    }
    if (e.k === 'idx') {
      const parent = this.container(e.base, create)
      if (!parent) return undefined
      if (e.key === null) {
        if (!create) throw err('cannot read from [] ', e)
        const a = new PhpArray()
        parent.push(a)
        return a
      }
      const key = PhpArray.normalizeKey(this.eval(e.key), e)
      let v = parent.map.get(key)
      if (!(v instanceof PhpArray)) {
        if (!create) return undefined
        if (v !== undefined && v !== null && v !== '') throw err('cannot use a scalar value as an array', e)
        v = new PhpArray()
        parent.set(key, v)
      }
      return v
    }
    throw err('invalid assignment target', e)
  }

  private assignTo(target: Expr, value: PVal): void {
    if (target.k === 'var') {
      this.vars.set(target.name, value)
      return
    }
    if (target.k === 'idx') {
      const parent = this.container(target.base, true) as PhpArray
      if (target.key === null) parent.push(value)
      else parent.set(PhpArray.normalizeKey(this.eval(target.key), target), value)
      return
    }
    throw err('invalid assignment target', target)
  }

  private read(e: Expr): PVal {
    if (e.k === 'var') {
      if (e.name === 'this') throw err('$this is not available', e)
      return this.vars.get(e.name) ?? null
    }
    if (e.k === 'idx') {
      if (e.key === null) throw err('cannot use [] for reading', e)
      const base = this.read(e.base)
      if (!(base instanceof PhpArray)) {
        if (typeof base === 'string') {
          const idx = toNum(this.eval(e.key))
          return base[idx] ?? ''
        }
        return null
      }
      return base.map.get(PhpArray.normalizeKey(this.eval(e.key), e)) ?? null
    }
    return this.eval(e)
  }

  private isset(e: Expr): boolean {
    if (e.k !== 'var' && e.k !== 'idx') throw err('isset() expects variables or array elements', e)
    if (e.k === 'var') return (this.vars.get(e.name) ?? null) !== null
    const base =
      e.base.k === 'var' || e.base.k === 'idx' ? (this.isset(e.base) ? this.read(e.base) : null) : null
    if (!(base instanceof PhpArray) || e.key === null) return false
    return (base.map.get(PhpArray.normalizeKey(this.eval(e.key), e)) ?? null) !== null
  }

  eval(e: Expr): PVal {
    switch (e.k) {
      case 'lit':
        return e.v
      case 'var':
      case 'idx':
        return copy(this.read(e))
      case 'tpl':
        return e.parts
          .map((p) => (typeof p === 'string' ? p : toStr(this.eval(p), e, this.warnings)))
          .join('')
      case 'arr': {
        const a = new PhpArray()
        for (const it of e.items) {
          const v = this.eval(it.value)
          if (it.key === null) a.push(v)
          else a.set(PhpArray.normalizeKey(this.eval(it.key), it.key), v)
        }
        return a
      }
      case 'assign': {
        let value: PVal
        if (e.op === '=') value = this.eval(e.value)
        else if (e.op === '??=') {
          if (this.isset(e.target)) return this.read(e.target)
          value = this.eval(e.value)
        } else {
          const cur = this.read(e.target)
          const r = this.eval(e.value)
          value = this.arith(e.op.slice(0, -1), cur, r, e)
        }
        this.assignTo(e.target, copy(value))
        return value
      }
      case 'incdec': {
        const cur = this.read(e.target)
        const n = cur === null && e.op === '++' ? 0 : toNum(cur)
        const next = e.op === '++' ? n + 1 : cur === null ? null : n - 1
        this.assignTo(e.target, next)
        return e.prefix ? next : cur
      }
      case 'un': {
        const v = this.eval(e.e)
        if (e.op === '!') return !truthy(v)
        if (e.op === '-') return -toNum(v)
        return toNum(v)
      }
      case 'cast':
        return this.cast(e.type, this.eval(e.e), e)
      case 'tern': {
        const c = this.eval(e.c)
        if (truthy(c)) return e.a ? this.eval(e.a) : c
        return this.eval(e.b)
      }
      case 'bin':
        return this.binary(e.op, e.l, e.r, e)
      case 'const':
        return this.constant(e.name, e)
      case 'call':
        return this.call(e.name, e.args, e)
    }
  }

  private arith(op: string, l: PVal, r: PVal, at: Pos): PVal {
    switch (op) {
      case '.':
        return toStr(l, at, this.warnings) + toStr(r, at, this.warnings)
      case '+':
        if (l instanceof PhpArray && r instanceof PhpArray) {
          const out = l.clone()
          for (const [k, v] of r.map) if (!out.map.has(k)) out.set(k, copy(v))
          return out
        }
        return toNum(l) + toNum(r)
      case '-':
        return toNum(l) - toNum(r)
      case '*':
        return toNum(l) * toNum(r)
      case '/': {
        const d = toNum(r)
        if (d === 0) throw err('division by zero', at)
        return toNum(l) / d
      }
      case '%': {
        const d = Math.trunc(toNum(r))
        if (d === 0) throw err('modulo by zero', at)
        return Math.trunc(toNum(l)) % d
      }
      default:
        throw err(`unsupported operator ${op}`, at)
    }
  }

  private binary(op: string, le: Expr, re: Expr, at: Pos): PVal {
    if (op === '&&') return truthy(this.eval(le)) && truthy(this.eval(re))
    if (op === '||') return truthy(this.eval(le)) || truthy(this.eval(re))
    if (op === '??') {
      if ((le.k === 'var' || le.k === 'idx') && !this.isset(le)) return this.eval(re)
      const l = this.eval(le)
      return l === null ? this.eval(re) : l
    }
    const l = this.eval(le)
    const r = this.eval(re)
    switch (op) {
      case '===':
        return strictEq(l, r)
      case '!==':
        return !strictEq(l, r)
      case '==':
        return looseEq(l, r)
      case '!=':
      case '<>':
        return !looseEq(l, r)
      case '<':
        return toNum(l) < toNum(r)
      case '<=':
        return toNum(l) <= toNum(r)
      case '>':
        return toNum(l) > toNum(r)
      case '>=':
        return toNum(l) >= toNum(r)
      default:
        return this.arith(op, l, r, at)
    }
  }

  private cast(type: string, v: PVal, at: Pos): PVal {
    switch (type) {
      case 'int':
      case 'integer':
        return Math.trunc(toNum(v))
      case 'float':
      case 'double':
        return toNum(v)
      case 'bool':
      case 'boolean':
        return truthy(v)
      case 'string':
        return toStr(v, at, this.warnings)
      case 'array': {
        if (v instanceof PhpArray) return v
        const a = new PhpArray()
        if (v !== null) a.push(v)
        return a
      }
      default:
        throw err(`unsupported cast (${type})`, at)
    }
  }

  private constant(name: string, at: Pos): PVal {
    const dir = this.opts.dir ?? '.'
    switch (name) {
      case '__DIR__':
        return dir
      case '__FILE__':
        return this.opts.file ?? `${dir}/config.inc.php`
      case '__LINE__':
        return at.line
      case 'PHP_EOL':
        return '\n'
      case 'DIRECTORY_SEPARATOR':
        return '/'
      case 'PHP_INT_MAX':
        return Number.MAX_SAFE_INTEGER
      default:
        throw err(`undefined constant ${name}`, at)
    }
  }

  private call(name: string, args: Expr[], at: Pos): PVal {
    const arg = (i: number): PVal => {
      const a = args[i]
      return a ? this.eval(a) : null
    }
    const s = (i: number): string => toStr(arg(i), at, this.warnings)
    switch (name.replace(/^.*\\/, '')) {
      case 'isset':
        return args.every((a) => this.isset(a))
      case 'empty': {
        const a = args[0]
        if (!a) throw err('empty() expects one argument', at)
        if ((a.k === 'var' || a.k === 'idx') && !this.isset(a)) return true
        return !truthy(this.eval(a))
      }
      case 'sodium_hex2bin':
      case 'hex2bin': {
        const hex = s(0)
        if (!/^([\da-fA-F]{2})*$/.test(hex)) throw err(`${name}(): invalid hexadecimal string`, at)
        this.warnings.push(
          `line ${at.line}: ${name}('${hex.length > 8 ? `${hex.slice(0, 4)}…` : '…'}') kept as its hex string (BetterMyAdmin secrets are text)`,
        )
        return hex
      }
      case 'getenv': {
        const v = this.opts.env?.[s(0)]
        return v === undefined ? false : v
      }
      case 'strval':
        return s(0)
      case 'intval':
        return Math.trunc(toNum(arg(0)))
      case 'boolval':
        return truthy(arg(0))
      case 'trim':
        return s(0).trim()
      case 'strtolower':
        return s(0).toLowerCase()
      case 'strtoupper':
        return s(0).toUpperCase()
      case 'dirname': {
        const p = s(0)
        const levels = args[1] ? Math.trunc(toNum(arg(1))) : 1
        let out = p
        for (let k = 0; k < levels; k++) {
          const idx = out.replace(/\/+$/, '').lastIndexOf('/')
          out = idx <= 0 ? (idx === 0 ? '/' : '.') : out.slice(0, idx)
        }
        return out
      }
      case 'explode': {
        const parts = s(1).split(s(0))
        const a = new PhpArray()
        for (const p of parts) a.push(p)
        return a
      }
      case 'implode': {
        const [first, second] = [arg(0), args.length > 1 ? arg(1) : null]
        const sep = second === null ? '' : toStr(first, at, this.warnings)
        const arr = second === null ? first : second
        if (!(arr instanceof PhpArray)) throw err('implode(): argument must be an array', at)
        return [...arr.map.values()].map((v) => toStr(v, at, this.warnings)).join(sep)
      }
      case 'sprintf': {
        let n = 1
        return s(0).replace(/%(%|s|d)/g, (_, f: string) => {
          if (f === '%') return '%'
          const v = arg(n++)
          return f === 'd' ? String(Math.trunc(toNum(v))) : toStr(v, at, this.warnings)
        })
      }
      default:
        throw err(`function ${name}() is not supported by the importer`, at)
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Evaluates a phpMyAdmin `config.inc.php` and returns `$cfg` as a plain object.
 * Throws {@link PmaImportError} (with line/column) on unsupported or invalid syntax.
 */
export function importPmaConfig(phpSource: string, options: PmaImportOptions = {}): PmaImportResult {
  const codeMode = !phpSource.includes('<?php')
  const program = new Parser(lex(phpSource, { line: 1, col: 1 }, codeMode)).program()
  const interp = new Interp(options)
  interp.run(program)
  const cfg = interp.vars.get('cfg') ?? null
  if (!(cfg instanceof PhpArray)) {
    throw new PmaImportError('$cfg is not an array after evaluating the file', 1, 1)
  }
  const config = toJs(cfg)
  return {
    config: Array.isArray(config)
      ? Object.fromEntries(config.map((v, i) => [String(i), v]))
      : (config as Record<string, unknown>),
    warnings: interp.warnings,
  }
}
