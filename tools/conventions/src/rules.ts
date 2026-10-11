import ts from 'typescript'

/**
 * The convention rules of docs/architecture/16-golden-path.md. Each rule reads source text only
 * (TypeScript AST, no type checking, no build, no database), so the whole run takes ~1 s.
 */

export interface Source {
  /** repository-relative, forward slashes */
  path: string
  text: string
}

export interface Violation {
  rule: string
  file: string
  line: number
  /** What the allow-list matches on besides rule and file (component name, export name, …). */
  symbol?: string
  message: string
}

export interface Rule {
  id: string
  /** docs/architecture/16-golden-path.md anchor */
  doc: string
  summary: string
  check(files: Source[]): Violation[]
}

const DOC = 'docs/architecture/16-golden-path.md'
export const docLink = (anchor: string) => `${DOC}#${anchor}`

const isCode = (p: string) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p)
const isTest = (p: string) => /\.(test|spec|e2e)\.tsx?$/.test(p) || /(^|\/)test\//.test(p)
const isGenerated = (p: string) => /(^|\/)generated\/|routeTree\.gen\.ts$/.test(p)
const WEB = 'apps/web/src/'

const astCache = new Map<string, ts.SourceFile>()
export function parse(f: Source): ts.SourceFile {
  const key = `${f.path}\0${f.text.length}`
  let sf = astCache.get(key)
  if (sf === undefined) {
    sf = ts.createSourceFile(
      f.path,
      f.text,
      ts.ScriptTarget.Latest,
      true,
      f.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    astCache.set(key, sf)
  }
  return sf
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node)
  node.forEachChild((c) => walk(c, fn))
}

const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

/** Text of string-ish literals (template parts included). */
function literalText(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) return n.text
  return null
}

const calleeName = (e: ts.Expression): string | null =>
  ts.isIdentifier(e)
    ? e.text
    : ts.isPropertyAccessExpression(e) &&
        ts.isIdentifier(e.expression) &&
        ['window', 'globalThis', 'self'].includes(e.expression.text)
      ? e.name.text
      : null

// ------------------------------------------------------------------------------------------------
// apps/web
// ------------------------------------------------------------------------------------------------

const webFetch: Rule = {
  id: 'web/no-fetch',
  doc: 'data',
  summary: '`fetch(` only in apps/web/src/lib/api.ts',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(WEB) || !isCode(f.path) || f.path === `${WEB}lib/api.ts`) continue
      const sf = parse(f)
      walk(sf, (n) => {
        if (ts.isCallExpression(n) && calleeName(n.expression) === 'fetch')
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            message: 'call the API through `api.*` from lib/api.ts, not fetch()',
          })
      })
    }
    return out
  },
}

const webApiCall: Rule = {
  id: 'web/api-module',
  doc: 'data',
  summary: 'endpoints are declared once, in `api` of lib/api.ts (no feature-local api clients)',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(WEB) || !isCode(f.path) || f.path === `${WEB}lib/api.ts`) continue
      const sf = parse(f)
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
        if (!/lib\/api(\.ts)?$/.test(st.moduleSpecifier.text)) continue
        const named = st.importClause?.namedBindings
        if (named === undefined || !ts.isNamedImports(named)) continue
        for (const el of named.elements)
          if ((el.propertyName ?? el.name).text === 'call')
            out.push({
              rule: this.id,
              file: f.path,
              line: lineOf(sf, el),
              message: 'add the endpoint to `api` in lib/api.ts instead of calling `call()` here',
            })
      }
    }
    return out
  },
}

const webQueryKeys: Rule = {
  id: 'web/query-keys',
  doc: 'data',
  summary: 'query keys come from `qk` in lib/queryKeys.ts',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(WEB) || !isCode(f.path) || f.path === `${WEB}lib/queryKeys.ts`) continue
      const sf = parse(f)
      walk(sf, (n) => {
        // a key factory: `const fooKeys = { … }` / `export const qk = …`
        if (
          ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          /^(qk|\w*Keys|\w*QueryKeys?)$/.test(n.name.text) &&
          n.initializer !== undefined &&
          ts.isObjectLiteralExpression(n.initializer)
        ) {
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            symbol: n.name.text,
            message: `query-key factory \`${n.name.text}\` belongs in lib/queryKeys.ts (\`qk\`)`,
          })
        }
        // an inline key: `queryKey: ['srv', …]`
        if (
          ts.isPropertyAssignment(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === 'queryKey' &&
          ts.isArrayLiteralExpression(n.initializer)
        ) {
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            message: 'use a `qk.*` factory from lib/queryKeys.ts instead of an inline query key',
          })
        }
      })
    }
    return out
  },
}

const SAFE_HTML = 'packages/ui/src/components/safe-html.tsx'
const noDangerousHtml: Rule = {
  id: 'no-dangerous-html',
  doc: 'html',
  summary: '`dangerouslySetInnerHTML` / `innerHTML =` only inside packages/ui SafeHtml',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!/^(apps|packages)\//.test(f.path) || !isCode(f.path) || f.path === SAFE_HTML) continue
      if (!f.text.includes('dangerouslySetInnerHTML') && !f.text.includes('innerHTML')) continue
      const sf = parse(f)
      walk(sf, (n) => {
        const jsx = ts.isJsxAttribute(n) && n.name.getText(sf) === 'dangerouslySetInnerHTML'
        const prop =
          ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'dangerouslySetInnerHTML'
        const assign =
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(n.left) &&
          ['innerHTML', 'outerHTML'].includes(n.left.name.text)
        if (jsx || prop || assign)
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            message: 'render markup with <SafeHtml html={…} /> from @bettermyadmin/ui (DOMPurify allow-list)',
          })
      })
    }
    return out
  },
}

/** Generic primitives that exist once, in packages/ui. */
export const PRIMITIVES = [
  'Alert',
  'Badge',
  'Button',
  'Card',
  'Checkbox',
  'Combobox',
  'DataTable',
  'Dialog',
  'Disclosure',
  'DocLink',
  'Dropdown',
  'DropdownMenu',
  'ErrorBox',
  'FormRow',
  'Hint',
  'IconButton',
  'Input',
  'Label',
  'Loading',
  'Menu',
  'MessageBox',
  'Modal',
  'MySqlDocLink',
  'Notice',
  'PageHeader',
  'PageTitle',
  'Panel',
  'Popover',
  'Radio',
  'SafeHtml',
  'Select',
  'Spinner',
  'TabBar',
  'Table',
  'Tabs',
  'Textarea',
  'Toast',
  'Toaster',
  'Tooltip',
]
const PRIMITIVE_SET = new Set(PRIMITIVES)

const webPrimitives: Rule = {
  id: 'web/no-local-primitives',
  doc: 'ui',
  summary: `generic primitives (${PRIMITIVES.slice(0, 6).join(', ')}, …) are defined only in packages/ui`,
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith('apps/') || !f.path.endsWith('.tsx')) continue
      const sf = parse(f)
      const report = (name: string, n: ts.Node) =>
        out.push({
          rule: this.id,
          file: f.path,
          line: lineOf(sf, n),
          symbol: name,
          message: `\`${name}\` is a generic primitive: import it from @bettermyadmin/ui (add it there if missing)`,
        })
      for (const st of sf.statements) {
        if (
          (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
          st.name &&
          PRIMITIVE_SET.has(st.name.text)
        )
          report(st.name.text, st)
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations)
            if (ts.isIdentifier(d.name) && PRIMITIVE_SET.has(d.name.text)) report(d.name.text, d)
      }
    }
    return out
  },
}

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const COLOR_IN_TEXT = /\[#[0-9a-fA-F]{3,8}\]|(?<![\w-])(?:rgba?|hsla?)\(/
const CSS_COLOR = /#[0-9a-fA-F]{3,8}\b|(?<![\w-])(?:rgba?|hsla?)\(/

const webColors: Rule = {
  id: 'web/no-raw-colors',
  doc: 'ui',
  summary: 'no raw hex/rgb/hsl colours in apps/web outside styles/ (use theme tokens)',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(WEB) || f.path.startsWith(`${WEB}styles/`)) continue
      if (f.path.endsWith('.css')) {
        f.text.split('\n').forEach((l, i) => {
          const code = l.replace(/\/\*.*?\*\//g, '')
          if (CSS_COLOR.test(code) && /:/.test(code))
            out.push({
              rule: this.id,
              file: f.path,
              line: i + 1,
              message: 'use a colour token (var(--…)) instead of a raw colour',
            })
        })
        continue
      }
      if (!isCode(f.path)) continue
      const sf = parse(f)
      walk(sf, (n) => {
        const s = literalText(n)
        if (s === null) return
        if (HEX.test(s.trim()) || COLOR_IN_TEXT.test(s))
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            symbol: s.trim().slice(0, 40),
            message: 'use a colour token (Tailwind token class or var(--…)) instead of a raw colour',
          })
      })
    }
    return out
  },
}

const ROUTE_MAX = 60
const webRouteSize: Rule = {
  id: 'web/route-size',
  doc: 'adding-a-page',
  summary: `route files under apps/web/src/routes are ≤ ${ROUTE_MAX} lines`,
  check(files) {
    return files
      .filter((f) => f.path.startsWith(`${WEB}routes/`) && isCode(f.path) && !isGenerated(f.path))
      .filter((f) => f.text.replace(/\n$/, '').split('\n').length > ROUTE_MAX)
      .map((f) => ({
        rule: this.id,
        file: f.path,
        line: ROUTE_MAX + 1,
        message: `route file has more than ${ROUTE_MAX} lines: move the page into features/<area>/`,
      }))
  },
}

const webNoServer: Rule = {
  id: 'web/no-server-import',
  doc: 'adding-a-page',
  summary: 'apps/web never imports apps/server (share through packages/contracts)',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith('apps/web/') || !isCode(f.path)) continue
      const sf = parse(f)
      walk(sf, (n) => {
        if (
          (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
          n.moduleSpecifier !== undefined &&
          ts.isStringLiteral(n.moduleSpecifier) &&
          /(^|\/)apps\/server|^@bettermyadmin\/server|\.\.\/server\/src/.test(n.moduleSpecifier.text)
        )
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            message: 'import shared types from @bettermyadmin/contracts, never from apps/server',
          })
      })
    }
    return out
  },
}

// ------------------------------------------------------------------------------------------------
// apps/server
// ------------------------------------------------------------------------------------------------

const ROUTES = 'apps/server/src/routes/'
const SQL_START =
  /^\s*(SELECT|SHOW|INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|SET|USE|KILL|FLUSH|EXPLAIN|TRUNCATE|GRANT|REVOKE|RENAME|OPTIMIZE|ANALYZE|CHECK|REPAIR|CALL|LOCK|UNLOCK|START|COMMIT|ROLLBACK|WITH)\s+(?:[`@\w(*]|$)/

const serverNoSql: Rule = {
  id: 'server/no-sql-in-routes',
  doc: 'adding-an-endpoint',
  summary: 'route handlers contain no SQL text (it lives in services and packages/sql-gen builders)',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(ROUTES) || !isCode(f.path)) continue
      const sf = parse(f)
      walk(sf, (n) => {
        const s = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null
        const head = ts.isTemplateExpression(n) ? n.head.text : null
        const text = s ?? head
        if (text !== null && SQL_START.test(text))
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            symbol: text.trim().split(/\s+/).slice(0, 2).join(' '),
            message: 'move this SQL into a service (apps/server/src/<area>/) or a packages/sql-gen builder',
          })
      })
    }
    return out
  },
}

const serverTr: Rule = {
  id: 'server/strings-through-tr',
  doc: 'strings',
  summary: 'user-facing strings in route handlers go through `tr` (errors and `message`/`text` fields)',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(ROUTES) || !isCode(f.path)) continue
      const sf = parse(f)
      const report = (n: ts.Node, s: string) =>
        out.push({
          rule: this.id,
          file: f.path,
          line: lineOf(sf, n),
          symbol: s.slice(0, 60),
          message: `wrap "${s.slice(0, 60)}" in tr.gettext(…) (phpMyAdmin msgid, docs/architecture/10)`,
        })
      walk(sf, (n) => {
        if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /Error$/.test(n.expression.text)) {
          const a = n.arguments?.[0]
          if (a !== undefined) {
            const s = literalText(a) ?? (ts.isTemplateExpression(a) ? a.head.text : null)
            if (s !== null && s.trim() !== '') report(a, s)
          }
        }
        if (
          ts.isPropertyAssignment(n) &&
          ts.isIdentifier(n.name) &&
          ['message', 'text'].includes(n.name.text) &&
          (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)) &&
          n.initializer.text.trim() !== ''
        )
          report(n.initializer, n.initializer.text)
      })
    }
    return out
  },
}

const serverValidate: Rule = {
  id: 'server/validate',
  doc: 'adding-an-endpoint',
  summary: 'route handlers validate with `parse(schema, …)` from apps/server/src/http/validate.ts',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith(ROUTES) || !isCode(f.path)) continue
      const sf = parse(f)
      walk(sf, (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ['safeParse', 'safeParseAsync'].includes(n.expression.name.text)
        )
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            message: 'use parse(Schema, value) from http/validate.ts (one VALIDATION envelope everywhere)',
          })
      })
    }
    return out
  },
}

const serverCsrf: Rule = {
  id: 'server/csrf-global',
  doc: 'adding-an-endpoint',
  summary: 'the CSRF middleware is registered on /api/* before every route module is mounted',
  check(files) {
    const app = files.find((f) => f.path === 'apps/server/src/app.ts')
    const v = (line: number, message: string): Violation => ({
      rule: this.id,
      file: 'apps/server/src/app.ts',
      line,
      message,
    })
    if (app === undefined)
      return files.some((f) => f.path.startsWith(ROUTES)) ? [v(1, 'apps/server/src/app.ts not found')] : []
    const sf = parse(app)
    let csrfAt = -1
    const out: Violation[] = []
    walk(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return
      const obj = n.expression.expression
      if (!ts.isIdentifier(obj) || obj.text !== 'app') return
      const method = n.expression.name.text
      const first = n.arguments[0]
      const path = first !== undefined && ts.isStringLiteral(first) ? first.text : ''
      if (method === 'use' && path === '/api/*' && n.getText(sf).includes('CsrfError'))
        csrfAt = n.getStart(sf)
      if (['route', 'get', 'post', 'put', 'patch', 'delete', 'on'].includes(method)) {
        if (csrfAt === -1 || n.getStart(sf) < csrfAt)
          out.push(v(lineOf(sf, n), `app.${method}('${path}') is registered before the CSRF middleware`))
        if (!path.startsWith('/api/'))
          out.push(v(lineOf(sf, n), `app.${method}('${path}') is outside /api/* (not CSRF-protected)`))
      }
    })
    if (csrfAt === -1) out.push(v(1, "no app.use('/api/*', …CsrfError…) middleware found"))
    // route modules must not mount sub-apps elsewhere or skip the global chain
    for (const f of files) {
      if (!f.path.startsWith(ROUTES) || !isCode(f.path)) continue
      if (/\bcreateApp\(|serveStatic|\.basePath\(/.test(f.text))
        out.push({
          rule: this.id,
          file: f.path,
          line: 1,
          message: 'route modules are mounted by app.ts only (behind the CSRF middleware)',
        })
    }
    return out
  },
}

// ------------------------------------------------------------------------------------------------
// repository-wide
// ------------------------------------------------------------------------------------------------

/** packages/<name> or apps/<name> */
const packageOf = (p: string) => p.split('/').slice(0, 2).join('/')

const duplicateExports: Rule = {
  id: 'no-duplicate-exports',
  doc: 'duplicates',
  summary: 'a function/class name is exported by one package only (shared helpers live in their owner)',
  check(files) {
    const where = new Map<string, Array<{ file: string; line: number }>>()
    for (const f of files) {
      if (!/^(packages\/[^/]+|apps\/[^/]+)\/src\//.test(f.path) || !isCode(f.path)) continue
      if (isTest(f.path) || isGenerated(f.path)) continue
      if (!/^export /m.test(f.text)) continue
      const sf = parse(f)
      const add = (name: string, n: ts.Node) => {
        if (name === 'Route') return // TanStack file routes
        const list = where.get(name) ?? []
        list.push({ file: f.path, line: lineOf(sf, n) })
        where.set(name, list)
      }
      for (const st of sf.statements) {
        const exported = ts.canHaveModifiers(st)
          ? (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          : false
        if (!exported) continue
        if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) add(st.name.text, st)
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations)
            if (
              ts.isIdentifier(d.name) &&
              d.initializer !== undefined &&
              (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
            )
              add(d.name.text, d)
      }
    }
    const out: Violation[] = []
    for (const [name, list] of where) {
      const pkgs = new Set(list.map((x) => packageOf(x.file)))
      if (pkgs.size < 2) continue
      for (const x of list)
        out.push({
          rule: this.id,
          file: x.file,
          line: x.line,
          symbol: name,
          message: `\`${name}\` is also exported by ${[...pkgs].filter((p) => p !== packageOf(x.file)).join(', ')}: keep one owner and import it`,
        })
    }
    return out
  },
}

const PARITY_CLIENT = 'tests/parity/lib/pma.ts'
/** The one family of request helpers of PmaClient (docs/architecture/16-golden-path.md#parity-client). */
export const PMA_CLIENT_API = ['login', 'getPage', 'getJson', 'postPage', 'postJson']

const parityClient: Rule = {
  id: 'parity/one-client',
  doc: 'parity-client',
  summary: `tests/parity talks to phpMyAdmin only through PmaClient (${PMA_CLIENT_API.join(', ')})`,
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      if (!f.path.startsWith('tests/parity/') || !isCode(f.path)) continue
      const sf = parse(f)
      walk(sf, (n) => {
        if (f.path !== PARITY_CLIENT && ts.isCallExpression(n) && calleeName(n.expression) === 'fetch')
          out.push({
            rule: this.id,
            file: f.path,
            line: lineOf(sf, n),
            message: 'use PmaClient / pmaReachable() from tests/parity/lib/pma.ts instead of fetch()',
          })
        if (ts.isClassDeclaration(n) && n.name !== undefined) {
          const isClient = n.name.text === 'PmaClient'
          if (!isClient && /Client$|^Pma/.test(n.name.text))
            out.push({
              rule: this.id,
              file: f.path,
              line: lineOf(sf, n),
              symbol: n.name.text,
              message: `second phpMyAdmin client \`${n.name.text}\`: extend PmaClient's helpers instead`,
            })
          if (isClient)
            for (const m of n.members) {
              if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name)) continue
              const priv = (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)
              if (priv) continue
              if (!PMA_CLIENT_API.includes(m.name.text))
                out.push({
                  rule: this.id,
                  file: f.path,
                  line: lineOf(sf, m),
                  symbol: m.name.text,
                  message: `PmaClient.${m.name.text} is outside the request-helper set (${PMA_CLIENT_API.join(', ')})`,
                })
            }
        }
      })
    }
    return out
  },
}

const testNaming: Rule = {
  id: 'tests/naming',
  doc: 'where-tests-go',
  summary: 'e2e specs are tests/e2e/**/*.e2e.ts, parity suites tests/parity/*.parity.test.ts',
  check(files) {
    const out: Violation[] = []
    for (const f of files) {
      const bad =
        (f.path.startsWith('tests/e2e/') && /\.(spec|test)\.tsx?$/.test(f.path)
          ? 'name end-to-end specs *.e2e.ts (tools/parity links checklist items from them)'
          : null) ??
        (f.path.startsWith('tests/parity/') &&
        /\.(test|spec)\.ts$/.test(f.path) &&
        !/\.parity\.test\.ts$/.test(f.path)
          ? 'name parity suites *.parity.test.ts (the vitest `parity` project)'
          : null)
      if (bad !== null) out.push({ rule: this.id, file: f.path, line: 1, message: bad })
    }
    return out
  },
}

export const RULES: Rule[] = [
  webFetch,
  webApiCall,
  webQueryKeys,
  noDangerousHtml,
  webPrimitives,
  webColors,
  webRouteSize,
  webNoServer,
  serverNoSql,
  serverTr,
  serverValidate,
  serverCsrf,
  duplicateExports,
  parityClient,
  testNaming,
]
