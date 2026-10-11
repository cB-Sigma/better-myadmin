/**
 * Which phpMyAdmin template controls our web app implements, read statically.
 *
 * Two conventions (docs/architecture/12-project-structure-and-conventions.md, "Parity markers"):
 *
 * 1. A `pma-controls.ts` registry in a feature folder:
 *
 *      export const pmaControls = {
 *        'login/form.twig#pma_username': 'LoginPage.tsx',
 *        'sql/query.twig#SQL': { file: 'SqlPage.tsx', match: 'button_submit_query' },
 *      }
 *
 *    Keys are inventory keys (`<template>#<control>`, see tools/parity/inventory/controls.json);
 *    the value names the component file (relative to the registry) and optionally a string that
 *    must occur in it. Without `match`, the file must contain the control's name, id or label msgid
 *    as a quoted string. An entry whose file or evidence is gone is reported as broken.
 *
 * 2. A `data-pma="<template>#<control> …"` attribute on the JSX element itself (space-separated
 *    keys allowed). Always valid evidence: the attribute is the element.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { REPO, rel, walk } from '../util.ts'

export interface ControlClaim {
  key: string
  /** repo-relative component file */
  file: string
  /** where the claim is made (registry file or the component) */
  at: string
  line: number
  via: 'registry' | 'data-pma'
  /** Explicit evidence string from the registry entry. */
  match?: string
}

export function scanControlClaims(root = join(REPO, 'apps/web/src'), repo = REPO): ControlClaim[] {
  const out: ControlClaim[] = []
  for (const f of walk(root, (r) => /\.(tsx?|jsx?)$/.test(r) && !/\.(test|spec)\./.test(r))) {
    const abs = join(root, f)
    const source = readFileSync(abs, 'utf8')
    const sf = ts.createSourceFile(
      abs,
      source,
      ts.ScriptTarget.Latest,
      true,
      f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
    const isRegistry = /(^|\/)pma-controls\.ts$/.test(f)
    const visit = (node: ts.Node) => {
      if (
        isRegistry &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'pmaControls' &&
        node.initializer !== undefined
      ) {
        let init: ts.Expression = node.initializer
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
        if (ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (!ts.isPropertyAssignment(p)) continue
            const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) ? p.name.text : null
            if (key === null) continue
            let file: string | null = null
            let match: string | undefined
            if (ts.isStringLiteral(p.initializer)) file = p.initializer.text
            else if (ts.isObjectLiteralExpression(p.initializer)) {
              for (const q of p.initializer.properties) {
                if (
                  !ts.isPropertyAssignment(q) ||
                  !ts.isIdentifier(q.name) ||
                  !ts.isStringLiteral(q.initializer)
                )
                  continue
                if (q.name.text === 'file') file = q.initializer.text
                if (q.name.text === 'match') match = q.initializer.text
              }
            }
            if (file === null) continue
            out.push({
              key,
              file: rel(repo, join(dirname(abs), file)),
              at: rel(repo, abs),
              line: lineOf(p),
              via: 'registry',
              ...(match !== undefined ? { match } : {}),
            })
          }
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText() === 'data-pma' && node.initializer !== undefined) {
        const init = node.initializer
        const v = ts.isStringLiteral(init)
          ? init.text
          : ts.isJsxExpression(init) && init.expression !== undefined && ts.isStringLiteral(init.expression)
            ? init.expression.text
            : null
        if (v !== null) {
          for (const key of v.split(/\s+/).filter((s) => s !== '')) {
            out.push({ key, file: rel(repo, abs), at: rel(repo, abs), line: lineOf(node), via: 'data-pma' })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

export interface EvidenceTarget {
  local: string
  name?: string
  id?: string
  label?: string
}

/** Whether the claimed component file still shows the control. */
export function verifyClaim(
  claim: ControlClaim,
  control: EvidenceTarget | undefined,
  repo = REPO,
): string | null {
  const abs = join(repo, claim.file)
  if (!existsSync(abs)) return `file ${claim.file} does not exist`
  if (claim.via === 'data-pma') return null
  const text = readFileSync(abs, 'utf8')
  const quoted = (s: string) =>
    text.includes(`'${s}'`) || text.includes(`"${s}"`) || text.includes(`\`${s}\``)
  if (claim.match !== undefined)
    return text.includes(claim.match) ? null : `"${claim.match}" not found in ${claim.file}`
  const local = claim.key.slice(claim.key.indexOf('#') + 1)
  const candidates = [local.replace(/^[a-z-]+:/, ''), control?.name, control?.id, control?.label].filter(
    (s): s is string => s !== undefined && s !== '' && !s.includes('*'),
  )
  return candidates.some(quoted)
    ? null
    : `none of ${candidates.map((c) => `"${c}"`).join(', ')} found in ${claim.file}`
}

/**
 * Whether a claim of a JS behaviour (`js:…` key) still holds: the component exists and, when the
 * entry gives `match`, contains it (recommended: the handler, e.g. `onKeyDown`, or the API path).
 */
export function verifyJsClaim(claim: ControlClaim, repo = REPO): string | null {
  const abs = join(repo, claim.file)
  if (!existsSync(abs)) return `file ${claim.file} does not exist`
  if (claim.match === undefined) return null
  return readFileSync(abs, 'utf8').includes(claim.match)
    ? null
    : `"${claim.match}" not found in ${claim.file}`
}
