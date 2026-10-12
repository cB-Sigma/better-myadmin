/**
 * Static scan of our TypeScript (apps/** and packages/**, tests excluded) for
 *
 * - config directive consumption: property chains (`cfg.MaxRows`, `cfg.Listen?.basePath`,
 *   `server.DisableIS`, `cfg.Servers[i].host`), destructuring (`const { MaxRows } = cfg`), and
 *   string literals equal to a directive path (`'Export/csv_columns'`);
 * - translated msgids: the same calls as `pnpm i18n:parity` (packages/i18n/scripts/parity.ts):
 *   t/__/gettext/_gettext, ngettext/_ngettext, pgettext/_pgettext, npgettext/_npgettext, `<Trans id>`,
 *   plus non-literal arguments resolved through msgid constants: `X.key` where
 *   `const X = { key: '…' }`, `X` where `const X = '…'`, and `t(obj.prop)` on a value of unknown
 *   origin → every literal `prop: '…'` in the file and the files it imports (e.g. tab tables).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { msgKey } from '../extract/pot.ts'
import { REPO, rel, walk } from '../util.ts'

export interface SourceFile {
  /** repo-relative */
  file: string
  sf: ts.SourceFile
}

const EXCLUDE = /(^|\/)(test|tests|e2e|scripts|fixtures)\/|\.(test|spec|e2e)\.tsx?$|\.gen\.ts$|\.d\.ts$/

export function sourceFiles(repo = REPO, roots = ['apps', 'packages']): SourceFile[] {
  const out: SourceFile[] = []
  for (const root of roots) {
    for (const f of walk(join(repo, root), (r) => /\.tsx?$/.test(r) && !EXCLUDE.test(r))) {
      const file = `${root}/${f}`
      if (EXCLUDE.test(file)) continue
      const abs = join(repo, file)
      const text = readFileSync(abs, 'utf8')
      out.push({
        file,
        sf: ts.createSourceFile(
          abs,
          text,
          ts.ScriptTarget.Latest,
          true,
          f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        ),
      })
    }
  }
  return out
}

const lit = (n: ts.Node | undefined): string | null =>
  n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

export interface Use {
  file: string
  line: number
}

/** Property-name chain of an access expression: `a.b?.c['d']` → ['a','b','c','d'] (dynamic index → '[]'). */
function chain(e: ts.Expression): string[] {
  if (ts.isIdentifier(e)) return [e.text]
  if (ts.isPropertyAccessExpression(e)) return [...chain(e.expression), e.name.text]
  if (ts.isElementAccessExpression(e)) return [...chain(e.expression), lit(e.argumentExpression) ?? '[]']
  if (ts.isCallExpression(e)) return [...chain(e.expression), '()']
  if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) return chain(e.expression)
  if (ts.isAsExpression(e)) return chain(e.expression)
  if (e.kind === ts.SyntaxKind.ThisKeyword) return ['this']
  return ['?']
}

const CFG_RECEIVER = /cfg|config|settings|prefs|conf|options|opts/i
const SERVER_RECEIVER = /server|srv|^\[\]$/i
const MULTI_HUMP = /^[A-Z][a-z0-9]+[A-Z_]/

/** Records every access chain and destructured name, for directive matching. */
export function collectChains(files: SourceFile[]): {
  chains: { names: string[]; use: Use }[]
  strings: Map<string, Use[]>
} {
  const chains: { names: string[]; use: Use }[] = []
  const strings = new Map<string, Use[]>()
  for (const { file, sf } of files) {
    const use = (n: ts.Node): Use => ({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 })
    const visit = (node: ts.Node) => {
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        !ts.isPropertyAccessExpression(node.parent) &&
        !(ts.isElementAccessExpression(node.parent) && node.parent.expression === node)
      ) {
        chains.push({ names: chain(node), use: use(node) })
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer !== undefined
      ) {
        const base = chain(node.initializer)
        for (const el of node.name.elements) {
          const prop = el.propertyName ?? el.name
          if (ts.isIdentifier(prop)) chains.push({ names: [...base, prop.text], use: use(el) })
        }
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const list = strings.get(node.text)
        if (list === undefined) strings.set(node.text, [use(node)])
        else list.push(use(node))
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { chains, strings }
}

function containsRun(names: string[], run: string[]): number {
  outer: for (let i = 0; i + run.length <= names.length; i++) {
    for (let j = 0; j < run.length; j++) if (names[i + j] !== run[j]) continue outer
    return i
  }
  return -1
}

/** Uses of one directive path (`MaxRows`, `Export/csv_columns`, `Servers/*\/host`). */
export function directiveUses(path: string, idx: ReturnType<typeof collectChains>): Use[] {
  const out: Use[] = []
  const segs = path.split('/')
  const literalForms = [path, path.replace('Servers/*/', 'Servers/1/')]
  for (const f of literalForms) out.push(...(idx.strings.get(f) ?? []))
  if (segs[0] === 'Servers' && segs[1] === '*') {
    const run = segs.slice(2)
    for (const c of idx.chains) {
      const i = containsRun(c.names, run)
      if (i > 0 && SERVER_RECEIVER.test(c.names[i - 1]!)) out.push(c.use)
    }
  } else if (segs.length === 1) {
    const name = segs[0]!
    for (const c of idx.chains) {
      const i = containsRun(c.names, [name])
      if (i > 0 && (CFG_RECEIVER.test(c.names[i - 1]!) || MULTI_HUMP.test(name))) out.push(c.use)
    }
  } else {
    for (const c of idx.chains) if (containsRun(c.names, segs) >= 0) out.push(c.use)
  }
  const seen = new Set<string>()
  return out.filter((u) => {
    const k = `${u.file}:${u.line}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------------------------------------------------------------------
// Msgids
// ---------------------------------------------------------------------------

// tProduct: t() with the product name substituted (apps/web/src/lib/i18n.tsx, X33)
const SINGULAR = new Set(['t', '__', 'gettext', '_gettext', 'tProduct'])
const PLURAL = new Set(['ngettext', '_ngettext'])
const CONTEXT = new Set(['pgettext', '_pgettext'])
const CONTEXT_PLURAL = new Set(['npgettext', '_npgettext'])

export interface MsgidUse extends Use {
  key: string
  /** how it was found: literal call, constant, property table */
  via: 'literal' | 'constant' | 'property'
}

function importsOf(sf: ts.SourceFile, file: string, known: Set<string>): string[] {
  const out: string[] = []
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const spec = st.moduleSpecifier.text
    if (!spec.startsWith('.')) continue
    const base = resolve(dirname(file), spec)
    for (const c of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      base.replace(/\.js$/, '.ts'),
      join(base, 'index.ts'),
    ]) {
      if (known.has(c)) {
        out.push(c)
        break
      }
    }
  }
  return out
}

export function scanMsgids(files: SourceFile[], repo = REPO): MsgidUse[] {
  // constant tables: X → literal, X.k → literal
  const constants = new Map<string, string>()
  // per file: prop name → literals assigned to it in object literals
  const propLits = new Map<string, Map<string, string[]>>()
  const absFiles = new Set(files.map((f) => join(repo, f.file)))
  for (const { file, sf } of files) {
    const props = new Map<string, string[]>()
    propLits.set(file, props)
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        let init: ts.Expression = node.initializer
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
        const v = lit(init)
        if (v !== null) constants.set(node.name.text, v)
        if (ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (!ts.isPropertyAssignment(p)) continue
            const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
            const pv = lit(p.initializer)
            if (k !== null && pv !== null) constants.set(`${node.name.text}.${k}`, pv)
          }
        }
      }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        const v = lit(node.initializer)
        if (v !== null) {
          const list = props.get(node.name.text)
          if (list === undefined) props.set(node.name.text, [v])
          else list.push(v)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  const out: MsgidUse[] = []
  for (const { file, sf } of files) {
    const abs = join(repo, file)
    const imported = importsOf(sf, abs, absFiles).map((a) => rel(repo, a))
    const add = (node: ts.Node, key: string, via: MsgidUse['via']) =>
      out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, key, via })
    const resolveArg = (n: ts.Expression | undefined): { values: string[]; via: MsgidUse['via'] } | null => {
      if (n === undefined) return null
      const l = lit(n)
      if (l !== null) return { values: [l], via: 'literal' }
      const c = chain(n)
      if (c.includes('?') || c.includes('()') || c.includes('[]')) return null
      const k = c.join('.')
      const constant = constants.get(k)
      if (constant !== undefined) return { values: [constant], via: 'constant' }
      if (c.length >= 2) {
        const prop = c.at(-1)!
        const values = [file, ...imported].flatMap((f) => propLits.get(f)?.get(prop) ?? [])
        if (values.length > 0) return { values, via: 'property' }
      }
      return null
    }
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? // `this.#t(…)`: a private translator method counts like `t(…)`
              callee.name.text.replace(/^#/, '')
            : ''
        const [a, b, c] = node.arguments
        if (SINGULAR.has(name)) {
          const r = resolveArg(a)
          if (r !== null) for (const v of r.values) add(node, v, r.via)
        } else if (PLURAL.has(name)) {
          const r = resolveArg(a)
          if (r !== null) for (const v of r.values) add(node, v, r.via)
        } else if (CONTEXT.has(name) || CONTEXT_PLURAL.has(name)) {
          const ctx = lit(a)
          const r = resolveArg(b)
          if (ctx !== null && r !== null) for (const v of r.values) add(node, msgKey(v, ctx), r.via)
          void c
        }
      }
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText() === 'Trans'
      ) {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'id' || attr.initializer === undefined)
            continue
          const init = attr.initializer
          const v = ts.isStringLiteral(init)
            ? init.text
            : ts.isJsxExpression(init)
              ? lit(init.expression)
              : null
          if (v !== null) add(node, v, 'literal')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

export function exists(repo: string, file: string): boolean {
  return existsSync(join(repo, file))
}
