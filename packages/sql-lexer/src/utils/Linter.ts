import { Lexer, type LexerOptions } from '../Lexer.ts'
import { Parser } from '../Parser.ts'
import { getErrors, htmlspecialchars } from './Error.ts'

export interface LintMessage {
  message: string
  fromLine: number
  fromColumn: number
  toLine: number
  toColumn: number
  severity: 'warning' | 'error'
}

// pma: src/Linter.php::getLines
export function getLines(str: string): number[] {
  const chars = Array.from(str)
  const lines = [0]
  for (let i = 0; i < chars.length; ++i) {
    if (chars[i] !== '\n') continue
    lines.push(i + 1)
  }
  return lines
}

// pma: src/Linter.php::findLineNumberAndColumn
export function findLineNumberAndColumn(lines: readonly number[], pos: number): [number, number] {
  let line = 0
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    if ((lines[lineNo] as number) > pos) break
    line = lineNo
  }
  return [line, pos - (lines[line] as number)]
}

/**
 * The two phpMyAdmin msgids the linter prints, translated by the caller (`__()`); English by default.
 */
export interface LintMessages {
  /** `%1$s (near <code>%2$s</code>)` */
  near: string
  /** `Linting is disabled for this query because it exceeds the maximum length.` */
  tooLong: string
}

export const LINT_MSGIDS: LintMessages = {
  near: '%1$s (near <code>%2$s</code>)',
  tooLong: 'Linting is disabled for this query because it exceeds the maximum length.',
}

/** sprintf for the `%1$s`/`%2$s` (or plain `%s`) placeholders of LintMessages.near. */
function fillNear(format: string, message: string, near: string): string {
  const args = [message, near]
  let next = 0
  return format.replace(/%(?:(\d)\$)?s|%%/g, (m, n: string | undefined) =>
    m === '%%' ? '%' : (args[n !== undefined ? Number(n) - 1 : next++] ?? ''),
  )
}

/**
 * phpMyAdmin's SQL linter (the `/lint` endpoint): lexer + parser errors with line/column positions.
 * `message` is HTML (`%1$s (near <code>%2$s</code>)`), like phpMyAdmin's English output.
 */
// pma: src/Linter.php::lint
export function lint(
  query: string,
  options: Pick<LexerOptions, 'context'> & { messages?: LintMessages } = {},
): LintMessage[] {
  const messages = options.messages ?? LINT_MSGIDS
  // Disabling linting for big queries.
  if (Array.from(query).length > 10000) {
    return [
      {
        message: messages.tooLong,
        fromLine: 0,
        fromColumn: 0,
        toLine: 0,
        toColumn: 0,
        severity: 'warning',
      },
    ]
  }

  const lexerOptions: LexerOptions = {}
  if (options.context !== undefined) lexerOptions.context = options.context
  const lexer = new Lexer(query, lexerOptions)
  const parserOptions: { context?: NonNullable<LexerOptions['context']> } = {}
  if (options.context !== undefined) parserOptions.context = options.context
  const parser = new Parser(lexer.list, parserOptions)
  const errors = getErrors([lexer, parser])
  const response: LintMessage[] = []
  const lines = getLines(query)

  for (const error of errors) {
    const pos = error[3] ?? 0
    const [fromLine, fromColumn] = findLineNumberAndColumn(lines, pos)
    const [toLine, toColumn] = findLineNumberAndColumn(lines, pos + Array.from(error[2]).length)
    response.push({
      message: fillNear(messages.near, htmlspecialchars(error[0]), htmlspecialchars(error[2])),
      fromLine,
      fromColumn,
      toLine,
      toColumn,
      severity: 'error',
    })
  }

  return response
}

/** Editors whose content is a routine/trigger/event body (`lintOptions.editorType`). */
export type LintEditorType = 'event' | 'routine' | 'trigger'

// pma: src/Controllers/LintController.php::EDITOR_SQL_PREFIX
export const EDITOR_SQL_PREFIX: Readonly<Record<LintEditorType, string>> = {
  event: 'DELIMITER $$ CREATE EVENT `a` ON SCHEDULE EVERY MINUTE DO\n',
  routine: 'DELIMITER $$ CREATE PROCEDURE `a`()\n',
  trigger: 'DELIMITER $$ CREATE TRIGGER `a` AFTER INSERT ON `b` FOR EACH ROW\n',
}

/**
 * The `/lint` endpoint: lints routine/trigger/event bodies in context by prepending a synthetic
 * header, then moves the positions back one line (except those on line 0).
 */
// pma: src/Controllers/LintController.php::__invoke
export function lintQuery(
  sqlQuery: string,
  editorType?: string | null,
  options: Pick<LexerOptions, 'context'> & { messages?: LintMessages } = {},
): LintMessage[] {
  const prefix =
    typeof editorType === 'string' && Object.hasOwn(EDITOR_SQL_PREFIX, editorType)
      ? EDITOR_SQL_PREFIX[editorType as LintEditorType]
      : ''
  const lints = lint(prefix + sqlQuery, options)
  if (prefix !== '') {
    for (const l of lints) {
      if (l.fromLine === 0) continue
      l.fromLine -= 1
      l.toLine -= 1
    }
  }
  return lints
}
