/**
 * Our API endpoints, read statically from the Hono route registrations under apps/server/src.
 *
 * Per file we collect, for every Hono instance variable (`const x = new Hono…`):
 *   x.get('/p', …) / .post / .put / .patch / .delete / .all / .on('METHOD', '/p', …)  → endpoints
 *   x.route('/prefix', y)                                                              → mounts
 * `y` is resolved through relative imports. Instances that nobody mounts are roots; endpoints are
 * the root registrations plus every mounted child's, with the prefixes joined.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { REPO, rel, walk } from '../util.ts'

export interface Endpoint {
  method: string
  /** Normalised path: params as `:name`. */
  path: string
  /** Source file of the registration. */
  file: string
  line: number
}

interface Instance {
  file: string
  name: string
  endpoints: Endpoint[]
  mounts: { prefix: string; target: { file: string; name: string } | null; line: number }[]
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head'])

export function normalizePath(p: string): string {
  let out = p.replace(/:([A-Za-z_][A-Za-z0-9_]*)(\{[^}]*\})?\??/g, ':$1').replace(/\/+/g, '/')
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out === '' ? '/' : out
}

export function joinPath(prefix: string, path: string): string {
  if (path === '/' || path === '') return normalizePath(prefix)
  return normalizePath(`${prefix}/${path}`)
}

function str(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
}

function resolveImport(fromFile: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (files.has(cand)) return cand
  }
  return null
}

function scanFile(file: string, files: Set<string>): Instance[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const instances = new Map<string, Instance>()
  const imports = new Map<string, { file: string; name: string }>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const target = resolveImport(file, st.moduleSpecifier.text, files)
    const named = st.importClause?.namedBindings
    if (target === null || named === undefined || !ts.isNamedImports(named)) continue
    for (const el of named.elements) {
      imports.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text })
    }
  }
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  const baseIdent = (e: ts.Expression): string | null => {
    // x.get(...).post(...) chains: walk down to the identifier
    if (ts.isIdentifier(e)) return e.text
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression))
      return baseIdent(e.expression.expression)
    return null
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'Hono'
    ) {
      instances.set(node.name.text, { file, name: node.name.text, endpoints: [], mounts: [] })
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const owner = baseIdent(node.expression.expression)
      const inst = owner === null ? undefined : instances.get(owner)
      if (inst !== undefined) {
        const [a0, a1] = node.arguments
        if (METHODS.has(method)) {
          const p = str(a0)
          if (p !== null)
            inst.endpoints.push({ method: method.toUpperCase(), path: p, file, line: lineOf(node) })
        } else if (method === 'on') {
          const p = str(a1)
          const ms =
            a0 !== undefined && ts.isArrayLiteralExpression(a0)
              ? a0.elements.map((e) => str(e as ts.Expression))
              : [str(a0)]
          if (p !== null)
            for (const m of ms)
              if (m !== null)
                inst.endpoints.push({ method: m.toUpperCase(), path: p, file, line: lineOf(node) })
        } else if (method === 'route') {
          const p = str(a0)
          if (p !== null && a1 !== undefined && ts.isIdentifier(a1)) {
            const local = instances.get(a1.text)
            const target = local !== undefined ? { file, name: a1.text } : (imports.get(a1.text) ?? null)
            inst.mounts.push({ prefix: p, target, line: lineOf(node) })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...instances.values()]
}

export function scanHono(root = join(REPO, 'apps/server/src'), repo = REPO): Endpoint[] {
  const files = new Set(
    walk(root, (r) => r.endsWith('.ts') && !r.endsWith('.d.ts')).map((r) => join(root, r)),
  )
  const all = [...files].flatMap((f) => scanFile(f, files))
  const byId = new Map(all.map((i) => [`${i.file}#${i.name}`, i]))
  const mounted = new Set(
    all.flatMap((i) => i.mounts.map((m) => (m.target === null ? '' : `${m.target.file}#${m.target.name}`))),
  )
  const out: Endpoint[] = []
  const expand = (inst: Instance, prefix: string, seen: Set<string>) => {
    for (const e of inst.endpoints) {
      out.push({ method: e.method, path: joinPath(prefix, e.path), file: rel(repo, e.file), line: e.line })
    }
    for (const m of inst.mounts) {
      if (m.target === null) continue
      const id = `${m.target.file}#${m.target.name}`
      const child = byId.get(id)
      if (child === undefined || seen.has(id)) continue
      expand(child, joinPath(prefix, m.prefix), new Set([...seen, id]))
    }
  }
  for (const inst of all) {
    const id = `${inst.file}#${inst.name}`
    if (!mounted.has(id)) expand(inst, '', new Set([id]))
  }
  // catch-alls (`/api/*`) are not endpoints
  return out
    .filter((e) => !e.path.includes('*'))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}
