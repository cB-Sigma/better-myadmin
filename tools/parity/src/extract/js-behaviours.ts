/**
 * JavaScript behaviour inventory: what phpMyAdmin's resources/js/**\/*.ts does in the browser,
 * extracted with the TypeScript parser.
 *
 *   event     jQuery `.on('evt', [selector], fn)` / `.one` / `.bind` / `.delegate`, the shorthands
 *             (`.click(fn)`, `.change(fn)`, `.keyup(fn)` …, only with a handler: without one they
 *             trigger), `addEventListener('evt', fn)`; keyboard handlers list the key codes / keys and
 *             modifiers their body compares
 *   dialog    `confirm()` / `window.confirm()` / `alert()` / jQuery `.confirm(question, …)`, with the
 *             `window.Messages` keys or literal texts they show
 *   ajax      `$.post` / `$.get` / `$.getJSON` / `$.ajax({url, type})` / `.load(url)` / `fetch(url)`,
 *             with the phpMyAdmin route their URL names
 *   shortcut  CodeMirror `extraKeys` bindings and `CodeMirror.commands.<name> =` assignments
 *
 * Keys: `js:<file>#<event>:<selector>`, `js:<file>#confirm:<message>`, `js:<file>#alert:<message>`,
 * `js:<file>#ajax:<METHOD> <route>`, `js:<file>#key:<combo>`, `js:<file>#cm-command:<name>`, with
 * <file> relative to resources/js. Repeated identical bindings in a file are one item (`count`).
 */
import ts from 'typescript'

export type JsKind = 'event' | 'dialog' | 'ajax' | 'shortcut'

export interface JsBehaviour {
  key: string
  kind: JsKind
  /** script path relative to resources/js */
  script: string
  line: number
  count: number
  /** event name (`click`, `keydown`, …), `confirm`/`alert`, the key combo or command */
  event?: string
  /** selector (delegated selector, or the receiver's), `document`, `window`, `<expr>` */
  selector?: string
  delegated?: boolean
  /** keyboard handlers: compared key codes / keys and modifiers (`Enter`, `ctrl`, `code 76` …) */
  keys?: string[]
  /** dialogs: window.Messages keys shown */
  messages?: string[]
  /** dialogs: literal text shown */
  text?: string
  method?: string
  /** ajax: the URL expression as written (literals kept, the rest `…`) */
  url?: string
  /** ajax: `/table/structure` when the URL names a route */
  route?: string
}

const JQ_BIND = new Set(['on', 'one', 'bind', 'delegate', 'live'])
const SHORTHAND = new Set([
  'click',
  'dblclick',
  'change',
  'submit',
  'keyup',
  'keydown',
  'keypress',
  'input',
  'focus',
  'blur',
  'focusin',
  'focusout',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'hover',
  'scroll',
  'resize',
  'select',
  'contextmenu',
])
const TRAVERSE = new Set([
  'find',
  'children',
  'filter',
  'closest',
  'parents',
  'parent',
  'next',
  'prev',
  'siblings',
])
const KEY_NAMES: Record<number, string> = {
  8: 'Backspace',
  9: 'Tab',
  10: 'Enter(LF)',
  13: 'Enter',
  16: 'Shift',
  17: 'Control',
  18: 'Alt',
  27: 'Escape',
  32: 'Space',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  46: 'Delete',
  116: 'F5',
}
const keyName = (n: number) =>
  KEY_NAMES[n] ??
  (n >= 65 && n <= 90 ? String.fromCharCode(n) : n >= 48 && n <= 57 ? String(n - 48) : `code ${n}`)

const short = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** A string expression as written: literals kept, everything else `…`. */
function strOf(n: ts.Expression | undefined): string | null {
  if (n === undefined) return null
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isParenthesizedExpression(n)) return strOf(n.expression)
  if (ts.isTemplateExpression(n))
    return n.head.text + n.templateSpans.map((s) => `…${s.literal.text}`).join('')
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = strOf(n.left)
    const b = strOf(n.right)
    if (a === null && b === null) return null
    return `${a ?? '…'}${b ?? '…'}`
  }
  return null
}

const isJq = (e: ts.Expression) => ts.isIdentifier(e) && (e.text === '$' || e.text === 'jQuery')

/** What a jQuery chain / DOM expression selects. */
function selectorOf(e: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isParenthesizedExpression(e)) return selectorOf(e.expression, sf)
  if (ts.isCallExpression(e)) {
    const callee = e.expression
    if (isJq(callee)) {
      const a = e.arguments[0]
      if (a === undefined) return '<$()>'
      const s = strOf(a)
      if (s !== null) return s
      if (a.kind === ts.SyntaxKind.ThisKeyword) return 'this'
      if (ts.isIdentifier(a) && (a.text === 'document' || a.text === 'window')) return a.text
      if (ts.isPropertyAccessExpression(a) && a.getText(sf) === 'document.body') return 'body'
      return `<${short(a.getText(sf), 40)}>`
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const m = callee.name.text
      const arg = strOf(e.arguments[0])
      if (callee.expression.getText(sf) === 'document') {
        if (m === 'getElementById' && arg !== null) return `#${arg}`
        if ((m === 'querySelector' || m === 'querySelectorAll') && arg !== null) return arg
      }
      if (TRAVERSE.has(m)) {
        const base = selectorOf(callee.expression, sf)
        return arg !== null ? `${base} ${arg}` : base
      }
      return selectorOf(callee.expression, sf)
    }
  }
  if (e.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (ts.isIdentifier(e) && (e.text === 'document' || e.text === 'window')) return e.text
  return `<${short(e.getText(sf), 40)}>`
}

const isFn = (n: ts.Node | undefined): n is ts.FunctionExpression | ts.ArrowFunction =>
  n !== undefined && (ts.isFunctionExpression(n) || ts.isArrowFunction(n))

/** Key codes / keys / modifiers a keyboard handler looks at. */
function keysIn(fn: ts.Node): string[] {
  const out = new Set<string>()
  const keyProp = (n: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(n)) return keyProp(n.expression)
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      return keyProp(n.left) || keyProp(n.right)
    if (ts.isAsExpression(n)) return keyProp(n.expression)
    return (
      ts.isPropertyAccessExpression(n) &&
      ['which', 'keyCode', 'key', 'code', 'charCode'].includes(n.name.text)
    )
  }
  const lit = (n: ts.Expression): string | null => {
    if (ts.isNumericLiteral(n)) return keyName(Number(n.text))
    if (ts.isStringLiteral(n)) return n.text
    return null
  }
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken
      ) {
        const v = keyProp(n.left) ? lit(n.right) : keyProp(n.right) ? lit(n.left) : null
        if (v !== null) out.add(v)
      }
    }
    if (ts.isSwitchStatement(n) && keyProp(n.expression)) {
      for (const c of n.caseBlock.clauses)
        if (ts.isCaseClause(c)) {
          const v = lit(c.expression)
          if (v !== null) out.add(v)
        }
    }
    if (ts.isPropertyAccessExpression(n) && /^(ctrl|alt|shift|meta)Key$/.test(n.name.text))
      out.add(n.name.text.replace('Key', ''))
    ts.forEachChild(n, visit)
  }
  visit(fn)
  return [...out].sort()
}

/** window.Messages / Messages keys used in an expression. */
function messageKeys(n: ts.Node, sf: ts.SourceFile): string[] {
  const out = new Set<string>()
  const visit = (x: ts.Node) => {
    if (ts.isPropertyAccessExpression(x)) {
      const obj = x.expression.getText(sf)
      if (obj === 'window.Messages' || obj === 'Messages') out.add(x.name.text)
    }
    if (ts.isElementAccessExpression(x)) {
      const obj = x.expression.getText(sf)
      const s = strOf(x.argumentExpression)
      if ((obj === 'window.Messages' || obj === 'Messages') && s !== null) out.add(s)
    }
    ts.forEachChild(x, visit)
  }
  visit(n)
  return [...out].sort()
}

const routeOf = (url: string | null): string | undefined => {
  if (url === null) return undefined
  const m = /[?&]route=(\/[A-Za-z0-9_/-]*)/.exec(url)
  return m?.[1]
}

export function extractJsBehaviours(script: string, source: string): JsBehaviour[] {
  const file = script
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map<string, JsBehaviour>()
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const add = (b: Omit<JsBehaviour, 'script' | 'count' | 'key'>, local: string, node: ts.Node) => {
    const key = `js:${file}#${local}`
    const prev = out.get(key)
    if (prev !== undefined) {
      prev.count++
      if (b.keys !== undefined) prev.keys = [...new Set([...(prev.keys ?? []), ...b.keys])].sort()
      return
    }
    out.set(key, { key, script, count: 1, ...b, line: line(node) })
  }
  // named functions of the file, so `on('keydown', handler)` finds the handler's key codes
  const fns = new Map<string, ts.Node>()
  const collect = (n: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
      n.name !== undefined &&
      ts.isIdentifier(n.name)
    )
      fns.set(n.name.text, n)
    if (
      (ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      isFn(n.initializer)
    )
      fns.set(n.name.text, n.initializer)
    ts.forEachChild(n, collect)
  }
  collect(sf)
  const resolve = (h: ts.Node | undefined): ts.Node | undefined => {
    if (h === undefined || isFn(h)) return h
    if (ts.isIdentifier(h)) return fns.get(h.text)
    if (ts.isPropertyAccessExpression(h)) return fns.get(h.name.text)
    return h
  }
  const event = (
    evt: string,
    selector: string,
    delegated: boolean,
    h: ts.Node | undefined,
    node: ts.Node,
  ) => {
    const keyboard = /^key(up|down|press)$/.test(evt) || evt === 'input'
    const handler = resolve(h)
    const keys = keyboard && handler !== undefined ? keysIn(handler) : []
    add(
      {
        kind: 'event',
        event: evt,
        selector,
        ...(delegated ? { delegated } : {}),
        ...(keys.length > 0 ? { keys } : {}),
        line: 0,
      },
      `${evt}:${selector}`,
      node,
    )
  }
  const eventsOf = (s: string) =>
    s
      .split(/\s+/)
      .map((e) => e.replace(/\..*$/, ''))
      .filter((e) => e !== '')

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      const args = n.arguments
      if (ts.isPropertyAccessExpression(callee)) {
        const m = callee.name.text
        const recvText = callee.expression.getText(sf)
        // --- jQuery bindings
        if (JQ_BIND.has(m) && args.length > 0) {
          const recv = selectorOf(callee.expression, sf)
          const first = args[0]!
          const evts = strOf(first)
          const delegateSel = m === 'delegate' ? strOf(args[0]) : strOf(args[1])
          if (m === 'delegate') {
            const ev = strOf(args[1])
            if (ev !== null && delegateSel !== null)
              for (const e of eventsOf(ev)) event(e, delegateSel, true, args.at(-1), n)
          } else if (evts !== null) {
            const sel =
              delegateSel !== null
                ? recv === 'document' || recv === 'body' || recv === 'window'
                  ? delegateSel
                  : `${recv} ${delegateSel}`
                : recv
            for (const e of eventsOf(evts)) event(e, sel, delegateSel !== null, args.at(-1), n)
          } else if (ts.isObjectLiteralExpression(first)) {
            for (const p of first.properties) {
              const name =
                p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
                  ? p.name.text
                  : null
              if (name === null) continue
              const h = ts.isPropertyAssignment(p) ? p.initializer : ts.isMethodDeclaration(p) ? p : undefined
              for (const e of eventsOf(name)) event(e, recv, false, h, n)
            }
          }
        }
        // --- jQuery shorthands with a handler (without one they trigger the event)
        else if (SHORTHAND.has(m) && args.length > 0 && (isFn(args[0]) || ts.isIdentifier(args[0]!))) {
          const recv = selectorOf(callee.expression, sf)
          if (!['Math', 'window.Math'].includes(recvText) && !recvText.startsWith('CodeMirror')) {
            const h = args[0]
            if (m === 'hover') {
              event('mouseenter', recv, false, h, n)
              event('mouseleave', recv, false, h, n)
            } else event(m, recv, false, h, n)
          }
        }
        // --- DOM addEventListener
        else if (m === 'addEventListener') {
          const ev = strOf(args[0])
          if (ev !== null) event(ev, selectorOf(callee.expression, sf), false, args[1], n)
        }
        // --- dialogs: window.confirm/alert, jQuery .confirm(question, …)
        else if ((m === 'confirm' || m === 'alert') && args.length > 0) {
          const dialog = recvText === 'window' ? m : m === 'confirm' ? 'confirm' : null
          if (dialog !== null) dialogItem(dialog, args[0]!, n)
        }
        // --- AJAX
        else if (isJq(callee.expression) && ['post', 'get', 'getJSON', 'ajax', 'getScript'].includes(m)) {
          if (m === 'ajax') {
            const o = args[0]
            let url: string | null = null
            let method = 'GET'
            if (o !== undefined && ts.isObjectLiteralExpression(o)) {
              for (const p of o.properties) {
                if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)))
                  continue
                if (p.name.text === 'url')
                  url = strOf(p.initializer) ?? `<${short(p.initializer.getText(sf), 40)}>`
                if (p.name.text === 'type' || p.name.text === 'method')
                  method = (strOf(p.initializer) ?? method).toUpperCase()
              }
            }
            ajaxItem(method, url, n)
          } else {
            const a = args[0]
            const url = strOf(a) ?? (a !== undefined ? `<${short(a.getText(sf), 40)}>` : null)
            ajaxItem(m === 'post' ? 'POST' : 'GET', url, n)
          }
        } else if (m === 'load' && args.length > 0 && strOf(args[0]) !== null && !isFn(args[0])) {
          ajaxItem('GET', strOf(args[0]), n)
        }
      } else if (ts.isIdentifier(callee)) {
        if ((callee.text === 'confirm' || callee.text === 'alert') && args.length > 0)
          dialogItem(callee.text, args[0]!, n)
        if (callee.text === 'fetch' && args.length > 0) {
          const a = args[0]!
          let method = 'GET'
          const o = args[1]
          if (o !== undefined && ts.isObjectLiteralExpression(o))
            for (const p of o.properties)
              if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method')
                method = (strOf(p.initializer) ?? method).toUpperCase()
          ajaxItem(method, strOf(a) ?? `<${short(a.getText(sf), 40)}>`, n)
        }
      }
    }
    // --- CodeMirror extraKeys: { 'Ctrl-Space': 'autocomplete' }
    if (
      ts.isPropertyAssignment(n) &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
      n.name.text === 'extraKeys' &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      for (const p of n.initializer.properties) {
        const k =
          p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
        if (k !== null) add({ kind: 'shortcut', event: k, line: 0 }, `key:${k}`, p)
      }
    }
    // --- CodeMirror.commands.name = …
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      /(^|\.)CodeMirror\.commands$/.test(n.left.expression.getText(sf))
    ) {
      add({ kind: 'shortcut', event: n.left.name.text, line: 0 }, `cm-command:${n.left.name.text}`, n)
    }
    ts.forEachChild(n, visit)
  }

  /** What a variable passed to a dialog holds: its declarations/assignments in the enclosing functions. */
  function valuesOf(id: ts.Identifier): ts.Node[] {
    const found: ts.Node[] = []
    for (let scope: ts.Node | undefined = id.parent; scope !== undefined; scope = scope.parent) {
      if (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) continue
      const visitScope = (x: ts.Node) => {
        if (
          ts.isVariableDeclaration(x) &&
          ts.isIdentifier(x.name) &&
          x.name.text === id.text &&
          x.initializer
        )
          found.push(x.initializer)
        if (
          ts.isBinaryExpression(x) &&
          x.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(x.left) &&
          x.left.text === id.text
        )
          found.push(x.right)
        ts.forEachChild(x, visitScope)
      }
      visitScope(scope)
      if (found.length > 0) break
    }
    return found
  }

  function dialogItem(dialog: 'confirm' | 'alert', arg0: ts.Expression, node: ts.Node) {
    const values = ts.isIdentifier(arg0) ? valuesOf(arg0) : []
    const arg = values.length === 1 && ts.isExpression(values[0]!) ? (values[0] as ts.Expression) : arg0
    const messages = [...new Set([arg0, ...values].flatMap((v) => messageKeys(v, sf)))].sort()
    const lit = strOf(arg)
    const what =
      messages.length > 0
        ? messages.join('+')
        : lit !== null
          ? short(lit, 80)
          : `<${short(arg.getText(sf), 40)}>`
    add(
      {
        kind: 'dialog',
        event: dialog,
        ...(messages.length > 0 ? { messages } : {}),
        ...(lit !== null ? { text: lit } : {}),
        line: 0,
      },
      `${dialog}:${what}`,
      node,
    )
  }

  function ajaxItem(method: string, url: string | null, node: ts.Node) {
    const route = routeOf(url)
    const target = route ?? (url !== null ? short(url, 60) : '<unknown>')
    add(
      {
        kind: 'ajax',
        method,
        ...(url !== null ? { url } : {}),
        ...(route !== undefined ? { route } : {}),
        line: 0,
      },
      `ajax:${method} ${target}`,
      node,
    )
  }

  visit(sf)
  return [...out.values()].sort((a, b) => a.line - b.line || a.key.localeCompare(b.key))
}
