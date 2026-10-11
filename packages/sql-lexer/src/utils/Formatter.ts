import type { Context } from '../Context.ts'
import { Lexer } from '../Lexer.ts'
import { type Token, TokenFlag, TokenType } from '../Token.ts'
import type { TokensList } from '../TokensList.ts'
import { JOINS } from '../components.ts'
import { phpString, strtolower, strtoupper } from '../php.ts'
import { isKeywordParser, isStatementKeyword } from '../tables.ts'

/** One entry of the `formats` option: how tokens of `type` carrying all `flags` are printed. */
export interface FormatRule {
  type: number
  flags: number
  html: string
  cli: string
  /** PHP callable name applied to the token text: 'strtoupper', 'strtolower' or ''. */
  function: string
}

export interface FormatterOptions {
  /** 'text', 'cli' or 'html'. PHP defaults to 'cli' under the CLI SAPI, 'text' otherwise. */
  type?: 'text' | 'cli' | 'html'
  /** null → "\n" for text/cli, "<br/>" for html. */
  line_ending?: string | null
  /** null → four spaces for text/cli, four &nbsp; for html. */
  indentation?: string | null
  remove_comments?: boolean
  clause_newline?: boolean
  parts_newline?: boolean
  indent_parts?: boolean
  formats?: Array<Partial<FormatRule>>
}

interface ResolvedOptions {
  type: 'text' | 'cli' | 'html'
  line_ending: string
  indentation: string
  remove_comments: boolean
  clause_newline: boolean
  parts_newline: boolean
  indent_parts: boolean
  formats: FormatRule[]
}

const htmlspecialcharsNoQuotes = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** `isset(JoinKeyword::JOINS[$value])` */
const isJoin = (v: unknown): boolean => typeof v === 'string' && Object.hasOwn(JOINS, v)

/**
 * Utilities that are used for formatting queries (the Format buttons of the SQL box).
 */
// pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::Formatter
export class Formatter {
  readonly options: ResolvedOptions

  /** Clauses that are usually short. These clauses share the line with the next clause. */
  static readonly shortClauses: Readonly<Record<string, true>> = { CREATE: true, INSERT: true }

  /** Clauses that must be inlined. */
  static readonly inlineClauses: Readonly<Record<string, true>> = {
    CREATE: true,
    INTO: true,
    LIMIT: true,
    'PARTITION BY': true,
    PARTITION: true,
    PROCEDURE: true,
    'SUBPARTITION BY': true,
    VALUES: true,
  }

  static readonly FORMATTERS: readonly string[] = ['PARTITION BY', 'SUBPARTITION BY']

  /** `static $prev` of Formatter::toString (shared by every instance, like PHP). */
  static #cliPrev: string | undefined

  constructor(options: FormatterOptions = {}) {
    this.options = Formatter.getMergedOptions(options)
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::getMergedOptions
  static getMergedOptions(options: FormatterOptions): ResolvedOptions {
    const merged = { ...Formatter.getDefaultOptions(), ...options }
    const formats =
      options.formats !== undefined
        ? Formatter.mergeFormats(Formatter.getDefaultFormats(), options.formats)
        : Formatter.getDefaultFormats()
    const type = merged.type ?? 'text'
    const lineEnding = merged.line_ending ?? (type === 'html' ? '<br/>' : '\n')
    const indentation = merged.indentation ?? (type === 'html' ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '    ')
    return {
      type,
      line_ending: lineEnding,
      indentation,
      remove_comments: merged.remove_comments ?? false,
      clause_newline: merged.clause_newline ?? true,
      // `parts_newline` requires `clause_newline`
      parts_newline: (merged.parts_newline ?? true) && (merged.clause_newline ?? true),
      indent_parts: merged.indent_parts ?? true,
      formats,
    }
  }

  /** PHP_SAPI is never 'cli' in phpMyAdmin's web requests, so the default type is 'text'. */
  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::getDefaultOptions
  static getDefaultOptions(): FormatterOptions {
    return {
      type: 'text',
      line_ending: null,
      indentation: null,
      remove_comments: false,
      clause_newline: true,
      parts_newline: true,
      indent_parts: true,
    }
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::getDefaultFormats
  static getDefaultFormats(): FormatRule[] {
    return [
      {
        type: TokenType.Keyword,
        flags: TokenFlag.KEYWORD_RESERVED,
        html: 'class="sql-reserved"',
        cli: '\x1b[35m',
        function: 'strtoupper',
      },
      {
        type: TokenType.Keyword,
        flags: 0,
        html: 'class="sql-keyword"',
        cli: '\x1b[95m',
        function: 'strtoupper',
      },
      { type: TokenType.Comment, flags: 0, html: 'class="sql-comment"', cli: '\x1b[37m', function: '' },
      { type: TokenType.Bool, flags: 0, html: 'class="sql-atom"', cli: '\x1b[36m', function: 'strtoupper' },
      {
        type: TokenType.Number,
        flags: 0,
        html: 'class="sql-number"',
        cli: '\x1b[92m',
        function: 'strtolower',
      },
      { type: TokenType.String, flags: 0, html: 'class="sql-string"', cli: '\x1b[91m', function: '' },
      {
        type: TokenType.Symbol,
        flags: TokenFlag.SYMBOL_PARAMETER,
        html: 'class="sql-parameter"',
        cli: '\x1b[31m',
        function: '',
      },
      { type: TokenType.Symbol, flags: 0, html: 'class="sql-variable"', cli: '\x1b[36m', function: '' },
    ]
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::mergeFormats
  static mergeFormats(formats: FormatRule[], newFormats: Array<Partial<FormatRule>>): FormatRule[] {
    const added: number[] = []
    const sanitized: FormatRule[] = newFormats.map((n) => ({
      type: n.type ?? 0,
      flags: n.flags ?? 0,
      html: n.html ?? '',
      cli: n.cli ?? '',
      function: n.function ?? '',
    }))
    const out = [...formats]
    out.forEach((original, i) => {
      sanitized.forEach((n, j) => {
        if (n.type !== original.type || original.flags !== n.flags) return
        out[i] = n
        added.push(j)
      })
    })
    sanitized.forEach((n, j) => {
      if (!added.includes(j)) out.push(n)
    })
    return out
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::formatList
  formatList(list: TokensList): string {
    let ret = ''
    // PHP `--null` stays null and `++null` is 1: the stacks below may pop null on unbalanced input
    let indent: number | null = 0
    let lineEnded = false
    let shortGroup = false
    let lastClause: unknown = ''
    const blocksIndentation: Array<number | null> = []
    const blocksLineEndings: boolean[] = []
    let formattedOptions = false
    let prev: Token | null = null
    const opts = this.options

    for (list.idx = 0; list.idx < list.count; ++list.idx) {
      const curr = list.tokens[list.idx] as Token
      const next = list.idx + 1 < list.count ? (list.tokens[list.idx + 1] as Token) : null

      if (curr.type === TokenType.Whitespace) {
        // Keep linebreaks before and after comments
        if (
          curr.token.includes('\n') &&
          ((prev !== null && prev.type === TokenType.Comment) ||
            (next !== null && next.type === TokenType.Comment))
        ) {
          lineEnded = true
        }
        // Whitespaces are skipped because the formatter adds its own.
        continue
      }

      // Skip Comments if option `remove_comments` is enabled
      if (curr.type === TokenType.Comment && opts.remove_comments) continue

      if (prev !== null) {
        // Checking if a new clause started.
        if (Formatter.isClause(prev) !== false) {
          lastClause = prev.value
          formattedOptions = false
        }

        // The options of a clause should stay on the same line and everything that follows.
        if (
          opts.parts_newline &&
          !formattedOptions &&
          !inlineClause(lastClause) &&
          (curr.type !== TokenType.Keyword || curr.flags & TokenFlag.KEYWORD_FUNCTION)
        ) {
          formattedOptions = true
          lineEnded = true
          indent = indent === null ? 1 : indent + 1
        }

        // Checking if this clause ended.
        const isClause = Formatter.isClause(curr)
        if (isClause !== false) {
          if ((isClause === 2 || opts.clause_newline) && !shortClause(lastClause)) {
            lineEnded = true
            if (opts.parts_newline && indent !== null && indent > 0) --indent
          }
        }

        // Inline JOINs
        if (
          (prev.type === TokenType.Keyword && isJoin(prev.value)) ||
          ((curr.value === 'ON' || curr.value === 'USING') && isJoin(list.tokens[list.idx - 2]?.value)) ||
          isJoin(list.tokens[list.idx - 4]?.value) ||
          isJoin(list.tokens[list.idx - 6]?.value)
        ) {
          lineEnded = false
        }

        // Indenting BEGIN ... END blocks.
        if (prev.type === TokenType.Keyword && prev.keyword === 'BEGIN') {
          lineEnded = true
          blocksIndentation.push(indent)
          indent = indent === null ? 1 : indent + 1
        } else if (curr.type === TokenType.Keyword && curr.keyword === 'END') {
          lineEnded = true
          indent = blocksIndentation.pop() ?? null
        }

        // Formatting fragments delimited by comma.
        if (prev.type === TokenType.Operator && prev.value === ',') {
          // Fragments delimited by a comma are broken into multiple pieces only if the clause is not
          // inlined or this fragment is between brackets that are on new line.
          if (
            blocksLineEndings.at(-1) === true ||
            (!inlineClause(lastClause) && !shortGroup && opts.parts_newline)
          ) {
            lineEnded = true
          }
        }

        // Handling brackets. Brackets are indented only if the length of the fragment between them
        // is longer than 30 characters.
        if (prev.type === TokenType.Operator && prev.value === '(') {
          blocksIndentation.push(indent)
          shortGroup = true
          if (Formatter.getGroupLength(list) > 30) {
            indent = indent === null ? 1 : indent + 1
            lineEnded = true
            shortGroup = false
          }
          blocksLineEndings.push(lineEnded)
        } else if (curr.type === TokenType.Operator && curr.value === ')') {
          indent = blocksIndentation.pop() ?? null
          lineEnded = lineEnded || (blocksLineEndings.pop() ?? false)
          shortGroup = false
        }

        // Adding the token.
        ret += this.toString(prev)

        // Finishing the line.
        if (lineEnded) {
          ret += opts.line_ending + opts.indentation.repeat(Math.max(0, indent ?? 0))
          lineEnded = false
        } else if (
          prev.keyword === 'DELIMITER' ||
          !(
            (prev.type === TokenType.Operator &&
              (prev.value === '.' || prev.value === '(' || prev.value === '->' || prev.value === '->>')) ||
            // No space after punctuation and JSON operators (sql-parser 6.0.1).
            (curr.type === TokenType.Operator &&
              (curr.value === '.' ||
                curr.value === ',' ||
                curr.value === '(' ||
                curr.value === ')' ||
                curr.value === '->' ||
                curr.value === '->>')) ||
            // No space before punctuation and JSON operators.
            (curr.type === TokenType.Delimiter && Array.from(phpString(curr.value)).length < 2)
          )
        ) {
          // If the line ended, there is no point in adding whitespaces. Also, some tokens do not have
          // spaces before or after them. A space after delimiters that are longer than 2 characters.
          ret += ' '
        }
      }

      // Iteration finished, consider current token as previous.
      prev = curr
    }

    if (opts.type === 'cli') return `${ret}\x1b[0m`
    return ret
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::escapeConsole
  escapeConsole(str: string): string {
    let out = ''
    for (const c of str) {
      const code = c.charCodeAt(0)
      out += code < 0x20 ? `\\x${code.toString(16).toUpperCase().padStart(2, '0')}` : c
    }
    return out
  }

  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::toString
  toString(token: Token): string {
    let text = token.token
    for (const format of this.options.formats) {
      if (token.type !== format.type || !((token.flags & format.flags) === format.flags)) continue

      // Running transformation function.
      if (format.function === 'strtoupper') text = strtoupper(text)
      else if (format.function === 'strtolower') text = strtolower(text)

      // Formatting HTML.
      if (this.options.type === 'html') {
        return `<span ${format.html}>${htmlspecialcharsNoQuotes(text)}</span>`
      }
      if (this.options.type === 'cli') {
        if (Formatter.#cliPrev !== format.cli) {
          Formatter.#cliPrev = format.cli
          return format.cli + this.escapeConsole(text)
        }
        return this.escapeConsole(text)
      }
      break
    }

    if (this.options.type === 'cli') {
      if (Formatter.#cliPrev !== '\x1b[39m') {
        Formatter.#cliPrev = '\x1b[39m'
        return `\x1b[39m${this.escapeConsole(text)}`
      }
      return this.escapeConsole(text)
    }
    if (this.options.type === 'html') return htmlspecialcharsNoQuotes(text)
    return text
  }

  /** Formats a query. */
  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::format
  static format(query: string, options: FormatterOptions = {}, context?: Context): string {
    const lexer = new Lexer(query, context !== undefined ? { context } : {})
    const formatter = new Formatter(options)
    return formatter.formatList(lexer.list)
  }

  /** Computes the length of a group (delimited by a pair of brackets). */
  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::getGroupLength
  static getGroupLength(list: TokensList): number {
    // starts at one: the opening bracket was already parsed
    let count = 1
    let length = 0
    for (let idx = list.idx; idx < list.count; ++idx) {
      const t = list.tokens[idx] as Token
      // Counting the brackets.
      if (t.type === TokenType.Operator) {
        if (t.value === '(') {
          ++count
        } else if (t.value === ')') {
          --count
          if (count === 0) break
        }
      }
      // Keeping track of this group's length.
      length += Array.from(phpString(t.value)).length
    }
    return length
  }

  /** Checks if a token is a statement (2) or a clause inside a statement (1). */
  // pma: vendor/phpmyadmin/sql-parser/src/Utils/Formatter.php::isClause
  static isClause(token: Token): 1 | 2 | false {
    if (
      (token.type === TokenType.Keyword && isStatementKeyword(token.keyword)) ||
      (token.type === TokenType.None && strtoupper(token.token) === 'DELIMITER')
    ) {
      return 2
    }
    if (
      token.type === TokenType.Keyword &&
      ((token.keyword !== null && Formatter.FORMATTERS.includes(token.keyword)) ||
        isKeywordParser(token.keyword))
    ) {
      return 1
    }
    return false
  }
}

/** `empty(self::$inlineClauses[$lastClause])` is false */
function inlineClause(c: unknown): boolean {
  return typeof c === 'string' && Object.hasOwn(Formatter.inlineClauses, c)
}

/** `empty(self::$shortClauses[$lastClause])` is false */
function shortClause(c: unknown): boolean {
  return typeof c === 'string' && Object.hasOwn(Formatter.shortClauses, c)
}

/** Formatter::format($sql, ['type' => 'text']) — what /database/sql/format returns. */
export function formatSql(sql: string, opts: { singleLine?: boolean; context?: Context } = {}): string {
  // pma: src/Controllers/Database/SqlFormatController.php
  const options: FormatterOptions = { type: 'text' }
  if (opts.singleLine === true) {
    options.line_ending = ' '
    options.indentation = ''
  }
  return Formatter.format(sql, options, opts.context)
}
