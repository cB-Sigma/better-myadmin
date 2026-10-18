/**
 * pnpm i18n:parity — lists the msgids our code translates that phpMyAdmin's catalogue does not have.
 *
 * Scans apps/ and packages/ TypeScript for gettext calls with literal arguments:
 *   t('…') __('…') gettext('…')                   → msgid
 *   ngettext('…', '…', n) _ngettext(…)            → msgid + msgid_plural
 *   pgettext('ctx', '…') npgettext('ctx', '…', '…', n)
 *   <Trans id="…" …/>
 *   N_('…') NC_('ctx', '…')                       → msgid markers (packages/i18n/src/noop.ts)
 * (also as methods: `tr.gettext('…')`; a conditional `t(c ? '…' : '…')` counts both branches). A
 * singular call on a msgid phpMyAdmin only has as a plural or with a context never finds its
 * translation, so the report names the call it needs (ngettext / pgettext). A string phpMyAdmin never had usually means a feature phpMyAdmin
 * never had; deliberate ones carry `// i18n-new: <reason>` on the same or the previous line.
 * Exit code 1 when unannotated unknown msgids exist.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { moKey, parsePo } from '../src/po.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const pot = parsePo(readFileSync(join(here, '../po/phpmyadmin.pot'), 'utf8'))
const known = new Set(pot.entries.map(moKey))
/** msgid → how phpMyAdmin translates it when it has no plain singular entry */
const elsewhere = new Map<string, string>()
for (const e of pot.entries) {
  if (e.msgidPlural === null && e.msgctxt === null) continue
  const how =
    e.msgidPlural !== null
      ? `ngettext('${e.msgid}', '${e.msgidPlural}', n)`
      : `pgettext('${e.msgctxt}', '${e.msgid}')`
  for (const id of [e.msgid, e.msgidPlural ?? e.msgid]) if (!elsewhere.has(id)) elsewhere.set(id, how)
}

const SINGULAR = new Set(['t', 'tProduct', '__', 'gettext', '_gettext', 'N_'])
const PLURAL = new Set(['ngettext', '_ngettext'])
const CONTEXT = new Set(['pgettext', '_pgettext', 'NC_'])
const CONTEXT_PLURAL = new Set(['npgettext', '_npgettext'])

interface Use {
  file: string
  line: number
  key: string
  annotated: boolean
}

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'test' || name === 'generated') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* sourceFiles(p)
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.gen.ts')) yield p
  }
}

const literal = (n: ts.Node | undefined): string | null =>
  n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null

/** the literals a msgid argument can be: a literal, or both branches of `c ? '…' : '…'` */
function literals(arg: ts.Node | undefined): string[] {
  if (arg === undefined) return []
  let n = arg
  while (ts.isParenthesizedExpression(n)) n = n.expression
  if (ts.isConditionalExpression(n)) return [...literals(n.whenTrue), ...literals(n.whenFalse)]
  const v = literal(n)
  return v === null ? [] : [v]
}

function scan(file: string): Use[] {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const lines = text.split('\n')
  const uses: Use[] = []
  const add = (node: ts.Node, key: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line
    const annotated = /i18n-new/.test(lines[line] ?? '') || /i18n-new/.test(lines[line - 1] ?? '')
    uses.push({ file: relative(repo, file), line: line + 1, key, annotated })
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ''
      const [a, b, c] = node.arguments
      if (SINGULAR.has(name) && literals(a).length > 0) for (const v of literals(a)) add(node, v)
      else if (PLURAL.has(name) && literal(a) !== null && literal(b) !== null)
        add(node, moKey({ msgctxt: null, msgid: literal(a)!, msgidPlural: literal(b) }))
      else if (CONTEXT.has(name) && literal(a) !== null && literal(b) !== null)
        add(node, moKey({ msgctxt: literal(a), msgid: literal(b)!, msgidPlural: null }))
      else if (CONTEXT_PLURAL.has(name) && literal(a) !== null && literal(b) !== null && literal(c) !== null)
        add(node, moKey({ msgctxt: literal(a), msgid: literal(b)!, msgidPlural: literal(c) }))
    }
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText() === 'Trans'
    ) {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.name.getText() === 'id' && attr.initializer !== undefined) {
          const init = attr.initializer
          const v = ts.isStringLiteral(init)
            ? init.text
            : ts.isJsxExpression(init)
              ? literal(init.expression)
              : null
          if (v !== null) add(node, v)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return uses
}

const uses: Use[] = []
for (const root of ['apps', 'packages']) {
  for (const file of sourceFiles(join(repo, root))) uses.push(...scan(file))
}
const unknown = uses.filter((u) => !known.has(u.key))
const show = (k: string) => {
  const hint = elsewhere.get(k)
  return `${JSON.stringify(k.replace('\u0004', ' | ').replace('\u0000', ' / '))}${hint !== undefined ? `  (phpMyAdmin: ${hint})` : ''}`
}
const distinct = new Set(uses.map((u) => u.key))
console.log(
  `${uses.length} translated strings (${distinct.size} distinct msgids) in our code, ${known.size} msgids in phpMyAdmin's catalogue.`,
)
const annotated = unknown.filter((u) => u.annotated)
const missing = unknown.filter((u) => !u.annotated)
if (annotated.length > 0) {
  console.log(`\n${annotated.length} new msgid(s) annotated with // i18n-new:`)
  for (const u of annotated) console.log(`  ${u.file}:${u.line}  ${show(u.key)}`)
}
if (missing.length > 0) {
  console.log(`\n${missing.length} msgid(s) not in phpMyAdmin's catalogue:`)
  for (const u of missing) console.log(`  ${u.file}:${u.line}  ${show(u.key)}`)
  process.exitCode = 1
} else {
  console.log('\nEvery msgid exists in phpMyAdmin (or is annotated).')
}
