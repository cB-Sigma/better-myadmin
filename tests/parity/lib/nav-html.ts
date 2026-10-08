import type { NavList, NavNode, NavPageSelector } from '../../../packages/contracts/src/navigation.ts'

/**
 * Normalised navigation tree, built either from phpMyAdmin's /navigation HTML (navigation/tree/*.twig)
 * or from BetterMyAdmin's JSON, so both can be compared with toEqual.
 */
export type Entry =
  | { t: 'filter'; kind: 'db' | 'item'; aPath: string[] }
  | {
      t: 'pager'
      param: string
      aPath: string[]
      pos2: number | null
      links: Record<string, number>
      pages: Array<[number, number, boolean]>
    }
  | {
      t: 'node'
      classes: string[]
      label: string
      expander: { loaded: boolean; container: boolean } | null
      aPath: string[] | null
      vPath: string[] | null
      pagination: string | null
      icons: string[]
      link: string | null
      children: { hidden: boolean; list: Entry[] } | null
    }

// ---------------------------------------------------------------- tiny HTML parser

interface El {
  tag: string
  attrs: Record<string, string>
  children: Array<El | string>
}

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link'])

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] }
  const stack: El[] = [root]
  const re =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g
  let last = 0
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const top = stack[stack.length - 1] as El
    if (m.index > last) top.children.push(decodeEntities(html.slice(last, m.index)))
    last = re.lastIndex
    if (m[0].startsWith('<!--')) continue
    const [, close, tagRaw = '', attrText = ''] = m
    const tag = tagRaw.toLowerCase()
    if (close === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if ((stack[i] as El).tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    const attrs: Record<string, string> = {}
    const ar = /([^\s=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
    for (let a = ar.exec(attrText); a !== null; a = ar.exec(attrText)) {
      attrs[(a[1] as string).toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    }
    const el: El = { tag, attrs, children: [] }
    top.children.push(el)
    if (!VOID.has(tag)) stack.push(el)
  }
  return root
}

const elements = (el: El) => el.children.filter((c): c is El => typeof c !== 'string')
const cls = (el: El) => (el.attrs.class ?? '').split(/\s+/).filter((c) => c !== '')
const hasClass = (el: El, c: string) => cls(el).includes(c)
const text = (el: El | string): string => (typeof el === 'string' ? el : el.children.map(text).join(''))

/** Depth-first search that does not descend into nested list containers. */
function find(el: El, pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const c of elements(el)) {
    if (pred(c)) out.push(c)
    if (!(c.tag === 'div' && hasClass(c, 'list_container'))) find(c, pred, out)
  }
  return out
}

const b64 = (s: string) => Buffer.from(s, 'base64').toString('utf8')
const decodePath = (p: string) => p.split('.').map(b64).slice(1)

function hiddenInputs(el: El): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of find(el, (e) => e.tag === 'input' && e.attrs.type === 'hidden')) {
    out[i.attrs.name ?? ''] = i.attrs.value ?? ''
  }
  return out
}

/** `index.php?route=/x&a=1` → `/x?a=1` with the parameters in order. */
function normHref(href: string, post?: string): string {
  const u = new URL(href, 'http://x/')
  const route = u.searchParams.get('route') ?? ''
  const params = [...u.searchParams].filter(([k]) => k !== 'route')
  if (post !== undefined) {
    for (const [k, v] of new URLSearchParams(post.replace(/^\?/, ''))) {
      if (k !== 'is_from_nav') params.push([k, v])
    }
  }
  return `${post !== undefined ? 'POST ' : ''}${route}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`
}

function pagerFromHtml(div: El): Entry {
  const links: Record<string, number> = {}
  let param = ''
  for (const a of find(div, (e) => e.tag === 'a')) {
    const post = new URLSearchParams((a.attrs['data-post'] ?? '').replace(/^\?/, ''))
    for (const p of ['pos3_value', 'pos2_value', 'pos']) {
      const v = post.get(p)
      if (v !== null) {
        param = p
        links[(a.attrs.title ?? '').toLowerCase()] = Number(v)
        break
      }
    }
  }
  const select = find(div, (e) => e.tag === 'select')[0]
  if (select !== undefined) param = select.attrs.name ?? param
  const pages = find(div, (e) => e.tag === 'option').map(
    (o) =>
      [Number(o.attrs.value), Number(text(o).trim()), 'selected' in o.attrs] as [number, number, boolean],
  )
  const hidden = hiddenInputs(div)
  return {
    t: 'pager',
    param,
    aPath: hidden.aPath === undefined ? [] : decodePath(hidden.aPath),
    pos2: param === 'pos3_value' && hidden.pos2_value !== undefined ? Number(hidden.pos2_value) : null,
    links,
    pages,
  }
}

function nodeFromHtml(li: El): Entry {
  const blocks = elements(li).filter((e) => e.tag === 'div')
  const first = blocks[0]
  const expanderEl =
    first === undefined ? undefined : find(first, (e) => e.tag === 'a' && hasClass(e, 'expander'))[0]
  // with NavigationTreeEnableExpansion off the anchor has no class and does nothing: no expander
  const pathsNav =
    expanderEl === undefined ? undefined : find(li, (e) => e.tag === 'span' && hasClass(e, 'paths_nav'))[0]
  const pag = find(li, (e) => e.tag === 'span' && (hasClass(e, 'pos2_nav') || hasClass(e, 'pos3_nav')))[0]
  const second = find(li, (e) => e.tag === 'div' && hasClass(e, 'second'))[0]
  const icons: string[] = []
  if (second !== undefined) {
    for (const a of find(second, (e) => e.tag === 'a')) {
      const img = find(a, (e) => e.tag === 'img')[0]
      const image = img === undefined ? '' : (cls(img).find((c) => c.startsWith('ic_')) ?? '').slice(3)
      icons.push(`${image}|${img?.attrs.title ?? ''}|${normHref(a.attrs.href ?? '')}`)
    }
    for (const u of find(second, (e) => e.tag === 'u')) {
      const img = find(u, (e) => e.tag === 'img')[0]
      const image = img === undefined ? '' : (cls(img).find((c) => c.startsWith('ic_')) ?? '').slice(3)
      icons.push(`${image}|${img?.attrs.title ?? ''}|group`)
    }
  }
  const textLink = find(li, (e) => e.tag === 'a' && hasClass(e, 'hover_show_full'))[0]
  let label: string
  let link: string | null = null
  if (textLink !== undefined) {
    label = text(textLink).trim()
    link = `${textLink.attrs.title ?? ''}|${normHref(textLink.attrs.href ?? '', textLink.attrs['data-post'])}`
  } else {
    // group: `<div class="block second"><u>…</u></div> &nbsp;name`
    const container = find(li, (e) => e.tag === 'div' && hasClass(e, 'fst-italic'))[0] ?? li
    label = container.children
      .filter((c): c is string => typeof c === 'string')
      .join('')
      .replace(/ /g, ' ')
      .trim()
  }
  const listContainer = elements(li).find((e) => e.tag === 'div' && hasClass(e, 'list_container'))
  const ul = listContainer === undefined ? undefined : elements(listContainer).find((e) => e.tag === 'ul')
  return {
    t: 'node',
    classes: [...new Set(cls(li).filter((c) => c !== 'first' && c !== 'last'))].sort(),
    label,
    expander:
      expanderEl === undefined
        ? null
        : { loaded: hasClass(expanderEl, 'loaded'), container: hasClass(expanderEl, 'container') },
    aPath: pathsNav === undefined ? null : (pathsNav.attrs['data-apath'] ?? '').split('.').map(b64).slice(1),
    vPath: pathsNav === undefined ? null : (pathsNav.attrs['data-vpath'] ?? '').split('.').map(b64).slice(1),
    pagination:
      pag === undefined
        ? null
        : `${hasClass(pag, 'pos2_nav') ? 'pos2_nav' : 'pos3_nav'}|${pag.attrs['data-name']}|${pag.attrs['data-value']}`,
    icons,
    link,
    children:
      listContainer === undefined
        ? null
        : {
            hidden: /display:\s*none/.test(listContainer.attrs.style ?? ''),
            list: ul === undefined ? [] : listFromUl(ul),
          },
  }
}

function listFromUl(ul: El): Entry[] {
  const out: Entry[] = []
  for (const c of elements(ul)) {
    if (c.tag === 'li' && hasClass(c, 'fast_filter')) {
      const aPath = hiddenInputs(c).aPath
      out.push({
        t: 'filter',
        kind: hasClass(c, 'db_fast_filter') ? 'db' : 'item',
        aPath: aPath === undefined ? [] : decodePath(aPath),
      })
    } else if (c.tag === 'li' && c.attrs.id === 'navigation_controls_outer') continue
    else if (c.tag === 'li') out.push(nodeFromHtml(c))
    else if (c.tag === 'div' && hasClass(c, 'pageselector')) out.push(pagerFromHtml(c))
    else if (c.tag === 'div' && hasClass(c, 'list_container')) {
      // a node rendered without its <li> (show_node = false) still wraps nothing; keep its items
      const inner = elements(c).find((e) => e.tag === 'ul')
      if (inner !== undefined) out.push(...listFromUl(inner))
    }
  }
  return out
}

/** renderState markup (full=1 / reload=1): fast filter, controls, page selector, tree content. */
export function stateFromHtml(html: string): Entry[] {
  const root = parseHtml(html)
  const out: Entry[] = []
  for (const c of elements(root)) {
    if (c.tag === 'ul') out.push(...listFromUl(c))
    else if (c.tag === 'div' && hasClass(c, 'pageselector')) out.push(pagerFromHtml(c))
    else if (c.tag === 'div' && c.attrs.id === 'pma_navigation_tree_content') {
      const ul = elements(c).find((e) => e.tag === 'ul')
      if (ul !== undefined) out.push(...listFromUl(ul))
    }
  }
  return out
}

/** renderPath markup: `<div class='list_container hide'><ul>…</ul></div>`. */
export function pathFromHtml(html: string): Entry[] {
  const root = parseHtml(html)
  const div = elements(root).find((e) => e.tag === 'div' && hasClass(e, 'list_container'))
  const ul = div === undefined ? undefined : elements(div).find((e) => e.tag === 'ul')
  return ul === undefined ? [] : listFromUl(ul)
}

// ---------------------------------------------------------------- BetterMyAdmin JSON

const paramList = (route: string, params: Record<string, string | number | null>, post = false) =>
  `${post ? 'POST ' : ''}${route}?${Object.entries(params)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')}`

function pagerFromJson(p: NavPageSelector): Entry {
  const links: Record<string, number> = {}
  if (p.begin !== null) links.begin = p.begin
  if (p.prev !== null) links.previous = p.prev
  if (p.next !== null) links.next = p.next
  if (p.end !== null) links.end = p.end
  return {
    t: 'pager',
    param: p.paramName,
    aPath: p.aPath,
    pos2: p.pos2,
    links,
    pages: p.pages.map((x) => [x.value, x.page, x.selected]),
  }
}

export function listFromJson(list: NavList): Entry[] {
  const out: Entry[] = []
  if (list.fastFilter !== null)
    out.push({ t: 'filter', kind: list.fastFilter.kind, aPath: list.fastFilter.aPath })
  if (list.pageSelector !== null) out.push(pagerFromJson(list.pageSelector))
  for (const n of list.items) {
    if (n.flatten) {
      if (n.children !== null) out.push(...listFromJson(n.children))
      continue
    }
    out.push(nodeFromJson(n))
  }
  return out
}

function nodeFromJson(n: NavNode): Entry {
  const isGroup = n.kind === 'group'
  return {
    t: 'node',
    classes: [...new Set(n.classes.split(/\s+/).filter((c) => c !== ''))].sort(),
    label: n.label,
    expander: n.expandable ? { loaded: n.loaded, container: n.kind === 'container' || isGroup } : null,
    aPath: n.expandable ? n.aPath : null,
    vPath: n.expandable ? n.vPath : null,
    pagination:
      n.pagination === null ? null : `${n.pagination.position}|${n.pagination.name}|${n.pagination.value}`,
    icons: n.icons.map((i) => `${i.image}|${i.title}|${isGroup ? 'group' : paramList(i.route, i.params)}`),
    link:
      isGroup || n.link === null
        ? null
        : `${n.link.title}|${paramList(n.link.route, n.link.params, n.link.post)}`,
    children: n.children === null ? null : { hidden: !n.expanded, list: listFromJson(n.children) },
  }
}

/** The state response: phpMyAdmin puts the fast filter before and the page selector after the controls. */
export function stateFromJson(tree: NavList): Entry[] {
  return listFromJson(tree)
}
