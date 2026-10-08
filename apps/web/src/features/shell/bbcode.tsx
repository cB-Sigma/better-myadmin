import { PmaIcon, pmaDocUrl } from '@bettermyadmin/ui'
import { Fragment, type ReactNode } from 'react'

/**
 * Sanitize::convertBBCode as React nodes (never HTML): [em] [strong] [code] [kbd] [sup] [br]
 * [a@url@target]…[/a] [doc@anchor] / [doc@page@anchor]…[/doc] [dochelpicon]. Links pass
 * Sanitize::checkLink's spirit: only https:// and app-relative URLs; targets are [a-z_].
 * pma: src/Sanitize.php::convertBBCode, replaceBBLink, replaceDocLink
 */
type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'open' | 'close'; tag: string; href?: string; target?: string }
  | { kind: 'br' | 'icon' }

const TOKEN = /\[(\/?)(em|strong|code|kbd|sup|a|doc)(?:@([^\]"@]*)(?:@([^\]"]*))?)?\]|\[br\]|\[dochelpicon\]/g

function docHref(a: string, b: string | undefined): string {
  if (b !== undefined) return pmaDocUrl(a, b)
  if (a.startsWith('faq')) return pmaDocUrl('faq', a)
  if (a.startsWith('cfg')) return pmaDocUrl('config', a)
  return pmaDocUrl('setup', a)
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let last = 0
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) })
    last = m.index + m[0].length
    if (m[0] === '[br]') {
      out.push({ kind: 'br' })
      continue
    }
    if (m[0] === '[dochelpicon]') {
      out.push({ kind: 'icon' })
      continue
    }
    const [, slash, tag = '', p1, p2] = m
    if (slash === '/') {
      out.push({ kind: 'close', tag: tag === 'doc' ? 'a' : tag })
      continue
    }
    if (tag === 'a') {
      const url = p1 ?? ''
      const ok = url.startsWith('https://') || url.startsWith('./') || url.startsWith('/')
      const targetOk = p2 === undefined || p2 === '' || /^[a-z_]+$/i.test(p2)
      if (!ok || !targetOk) {
        out.push({ kind: 'text', text: m[0] })
        continue
      }
      out.push({ kind: 'open', tag: 'a', href: url, ...(p2 ? { target: p2 } : {}) })
      continue
    }
    if (tag === 'doc') {
      if (p1 === undefined || !/^[a-zA-Z0-9_-]+$/.test(p1)) {
        out.push({ kind: 'text', text: m[0] })
        continue
      }
      out.push({
        kind: 'open',
        tag: 'a',
        href: docHref(p1, p2 !== undefined && p2 !== '' ? p2 : undefined),
        target: 'documentation',
      })
      continue
    }
    if (p1 !== undefined) {
      out.push({ kind: 'text', text: m[0] })
      continue
    }
    out.push({ kind: 'open', tag })
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}

interface Node {
  tag: string
  href?: string
  target?: string
  children: Array<Node | string | 'br' | 'icon'>
}

export function BBCode({ text }: { text: string }) {
  const root: Node = { tag: 'root', children: [] }
  const stack: Node[] = [root]
  for (const t of tokenize(text)) {
    const top = stack[stack.length - 1]!
    if (t.kind === 'text') top.children.push(t.text)
    else if (t.kind === 'br' || t.kind === 'icon') top.children.push(t.kind)
    else if (t.kind === 'open') {
      const n: Node = {
        tag: t.tag,
        children: [],
        ...(t.href ? { href: t.href } : {}),
        ...(t.target ? { target: t.target } : {}),
      }
      top.children.push(n)
      stack.push(n)
    } else if (t.kind === 'close') {
      // close the nearest matching element; an unmatched close tag is dropped like strtr would leave HTML unbalanced
      const i = stack.map((s) => s.tag).lastIndexOf(t.tag)
      if (i > 0) stack.length = i
    }
  }
  return <>{render(root.children)}</>
}

function render(nodes: Node['children']): ReactNode[] {
  return nodes.map((n, i) => {
    const key = i
    if (typeof n === 'string') {
      if (n === 'br') return <br key={key} />
      if (n === 'icon') return <PmaIcon key={key} name="b_help" alt="Documentation" />
      return <Fragment key={key}>{n}</Fragment>
    }
    const kids = render(n.children)
    switch (n.tag) {
      case 'em':
        return <em key={key}>{kids}</em>
      case 'strong':
        return <strong key={key}>{kids}</strong>
      case 'code':
        return <code key={key}>{kids}</code>
      case 'kbd':
        return <kbd key={key}>{kids}</kbd>
      case 'sup':
        return <sup key={key}>{kids}</sup>
      default:
        return (
          <a
            key={key}
            href={n.href}
            {...(n.target ? { target: n.target } : {})}
            {...(n.target === '_blank' ? { rel: 'noopener noreferrer' } : {})}
          >
            {kids}
          </a>
        )
    }
  })
}
