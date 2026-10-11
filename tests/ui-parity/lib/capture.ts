import type { Page } from '@playwright/test'

/**
 * Normalised list of the visible, interactive controls of a page (or of a part of it), the same way
 * for phpMyAdmin and BetterMyAdmin so the two can be diffed (see diff.ts).
 */

/** Coarse kind used for matching (`role` keeps the exact role). */
export type ControlKind = 'textbox' | 'select' | 'checkbox' | 'radio' | 'button' | 'link' | 'file' | 'slider'

export interface ControlOption {
  label: string
  value: string
  selected: boolean
}

export interface Control {
  kind: ControlKind
  /** ARIA role or the element's implicit one (textbox, combobox, listbox, tab, menuitem, link, …). */
  role: string
  /** Accessible label: aria-labelledby/aria-label, <label>, text, value, alt, title, placeholder. */
  label: string
  name?: string
  id?: string
  /** input type (text, password, number, …), `textarea`, `editor` (CodeMirror), `select-multiple`. */
  type?: string
  value?: string
  options?: ControlOption[]
  checked?: boolean
  disabled?: boolean
  required?: boolean
  readonly?: boolean
  /** nearest fieldset legend / card header / dialog title / preceding heading ('' at the top). */
  section: string
  /** order within the section (0-based) */
  index: number
  /** link target (path + query), for reports only */
  href?: string
}

/**
 * Named regions; both apps use phpMyAdmin's element ids. The tab bar (`#topmenu`) is part of `menu`
 * and not of `content`: phpMyAdmin renders it in #floating_menubar, ours inside #page_content.
 */
export const SCOPES = {
  content: '#page_content',
  menu: '#floating_menubar, #topmenu',
  navigation: '#pma_navigation',
  console: '#pma_console',
  page: 'body',
} as const
export type ScopeName = keyof typeof SCOPES

/** Left out of a named scope in both apps. */
export const SCOPE_EXCLUDE: Partial<Record<ScopeName, string[]>> = { content: ['#topmenu'] }

export interface CaptureOptions {
  /** CSS selector of the region (default: the whole page). */
  scope?: string
  /** CSS selectors whose controls are left out (e.g. a live-updating chart). */
  exclude?: string[]
}

/** Runs in the page: the visible interactive controls below `scope`. Self-contained (serialised). */
function captureInPage(opts: { scope: string | null; exclude: string[] }): Control[] {
  // a selector list selects several regions (e.g. the tab bar, which ours renders inside the content)
  const all = opts.scope === null ? [document.body] : [...document.querySelectorAll(opts.scope)]
  const roots = all.filter((r) => !all.some((o) => o !== r && o.contains(r)))
  if (roots.length === 0) return []
  const inRoots = (el: Element) => roots.some((r) => r.contains(el))
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
  const shown = (el: Element): boolean => {
    if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  }
  const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'SELECT', 'TEXTAREA', 'OPTION', 'NOSCRIPT', 'TEMPLATE'])
  /**
   * visible text of a node, skipping `skip` and form fields; images count by alt only when there is
   * no text (phpMyAdmin's icon + text links would otherwise read "SQL SQL")
   */
  const INTERACTIVE = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem]'
  const text = (node: Node, skip?: Element, own = false): string => {
    let out = ''
    let alts = ''
    const visit = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent ?? ''
        return
      }
      if (!(n instanceof Element) || n === skip) return
      if (SKIP_TEXT.has(n.tagName)) return
      // a label/heading does not read the links and buttons inside it (they are controls of their own)
      if (!own && n !== node && n.matches(INTERACTIVE)) return
      if (n instanceof HTMLInputElement) {
        if (['submit', 'button', 'reset'].includes(n.type)) out += ` ${n.value} `
        return
      }
      if (n.tagName === 'IMG') {
        alts += ` ${n.getAttribute('alt') ?? ''} `
        return
      }
      if (n instanceof HTMLElement && !shown(n) && getComputedStyle(n).display !== 'contents') return
      if (n.getAttribute('aria-hidden') === 'true' && n.tagName !== 'svg') return
      for (const c of n.childNodes) visit(c)
      if (n instanceof HTMLElement && getComputedStyle(n).display === 'block') out += ' '
    }
    visit(node)
    return norm(out) !== '' ? norm(out) : norm(alts)
  }
  const byIds = (ids: string) =>
    norm(
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => e !== null)
        .map((e) => text(e))
        .join(' '),
    )

  const SELECTOR = [
    'input:not([type=hidden])',
    'select',
    'textarea',
    'button',
    'a[href]',
    '[role=button]',
    '[role=link]',
    '[role=tab]',
    '[role=menuitem]',
    '[role=menuitemcheckbox]',
    '[role=menuitemradio]',
    '[role=checkbox]',
    '[role=radio]',
    '[role=switch]',
    '[role=combobox]',
    '[role=textbox]',
    'summary',
    '.CodeMirror',
  ].join(',')

  const excluded = (el: Element) => opts.exclude.some((s) => el.closest(s) !== null)
  const isCm5Inner = (el: Element) =>
    el.closest('.CodeMirror') !== null && !el.classList.contains('CodeMirror')
  const isCm6Inner = (el: Element) =>
    el.closest('.cm-editor') !== null && !el.classList.contains('cm-content')

  const candidates = roots
    .flatMap((root) => [...root.querySelectorAll(SELECTOR)])
    .filter((el) => {
      if (excluded(el) || isCm5Inner(el) || isCm6Inner(el)) return false
      // a hidden form mirror of a custom control (Radix Checkbox's bubble input) is not a control
      if (el instanceof HTMLInputElement && el.getAttribute('aria-hidden') === 'true') return false
      // an element with a control role inside another control (e.g. <a role=tab><button>) counts once
      const outer = el.parentElement?.closest(SELECTOR)
      if (outer !== null && outer !== undefined && inRoots(outer) && !(el instanceof HTMLInputElement))
        return false
      if (shown(el)) return true
      // visually hidden checkbox/radio styled through its label (e.g. .btn-check)
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))
        return [...(el.labels ?? [])].some(shown)
      return false
    })

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(shown)
  const before = (a: Element, b: Element) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  const sectionOf = (el: Element): string => {
    for (let a = el.parentElement; a !== null && a !== document.body; a = a.parentElement) {
      if (a.tagName === 'FIELDSET') {
        const lg = a.querySelector(':scope > legend')
        if (lg !== null && !lg.contains(el)) return text(lg)
      }
      if (a.classList.contains('card')) {
        const h = a.querySelector(':scope > .card-header')
        if (h !== null && !h.contains(el)) return text(h)
      }
      if (
        a.tagName === 'SECTION' ||
        a.getAttribute('role') === 'region' ||
        a.getAttribute('role') === 'group'
      ) {
        const named =
          a.getAttribute('aria-label') ??
          (a.getAttribute('aria-labelledby') !== null ? byIds(a.getAttribute('aria-labelledby') ?? '') : null)
        if (named !== null && norm(named) !== '') return norm(named)
        const h = a.querySelector(':scope > header')
        if (h !== null && !h.contains(el) && text(h) !== '') return text(h)
      }
      if (a.getAttribute('role') === 'dialog' || a.classList.contains('modal')) {
        const t =
          a.getAttribute('aria-label') ??
          (a.getAttribute('aria-labelledby') !== null ? byIds(a.getAttribute('aria-labelledby') ?? '') : null)
        const title = a.querySelector('.modal-title,[role=heading],h1,h2,h3,h4,h5')
        const s = norm(t) !== '' ? norm(t) : title !== null ? text(title) : ''
        if (s !== '') return s
      }
    }
    let last: Element | null = null
    for (const h of headings) {
      if (before(h, el) && !h.contains(el)) last = h
      else break
    }
    return last === null ? '' : text(last)
  }

  const roleOf = (el: Element): string => {
    const r = el.getAttribute('role')
    if (r !== null && r !== '') return r.split(/\s+/)[0]!
    if (el.classList.contains('CodeMirror')) return 'textbox'
    if (el.tagName === 'SUMMARY') return 'button'
    if (el instanceof HTMLSelectElement) return el.multiple || el.size > 1 ? 'listbox' : 'combobox'
    if (el instanceof HTMLTextAreaElement) return 'textbox'
    if (el instanceof HTMLButtonElement) return 'button'
    if (el instanceof HTMLAnchorElement) return 'link'
    if (el instanceof HTMLInputElement) {
      const t = el.type
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button'
      if (t === 'checkbox' || t === 'radio' || t === 'file') return t
      if (t === 'range') return 'slider'
      if (t === 'number') return 'spinbutton'
      if (t === 'search') return 'searchbox'
      return 'textbox'
    }
    if ((el as HTMLElement).isContentEditable) return 'textbox'
    return 'generic'
  }
  const kindOf = (role: string): Control['kind'] => {
    switch (role) {
      case 'combobox':
      case 'listbox':
        return 'select'
      case 'checkbox':
      case 'switch':
      case 'menuitemcheckbox':
        return 'checkbox'
      case 'radio':
      case 'menuitemradio':
        return 'radio'
      case 'button':
        return 'button'
      case 'link':
      case 'tab':
      case 'menuitem':
        return 'link'
      case 'file':
        return 'file'
      case 'slider':
        return 'slider'
      default:
        return 'textbox'
    }
  }

  const labelOf = (el: Element, role: string): string => {
    const lb = el.getAttribute('aria-labelledby')
    if (lb !== null && byIds(lb) !== '') return byIds(lb)
    const al = norm(el.getAttribute('aria-label'))
    if (al !== '') return al
    if (el.classList.contains('CodeMirror')) {
      const ta = el.previousElementSibling
      if (ta instanceof HTMLTextAreaElement) {
        const l = [...(ta.labels ?? [])].map((x) => text(x, ta)).join(' ')
        if (norm(l) !== '') return norm(l)
      }
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLButtonElement
    ) {
      if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type))
        return norm(el.value)
      if (el instanceof HTMLInputElement && el.type === 'image') return norm(el.alt || el.title)
      const l = norm([...(el.labels ?? [])].map((x) => text(x, el)).join(' '))
      if (l !== '') return l
    }
    if (['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio'].includes(role)) {
      const t = text(el, undefined, true)
      if (t !== '') return t
      const svgTitle = el.querySelector('svg title')
      if (svgTitle !== null && norm(svgTitle.textContent) !== '') return norm(svgTitle.textContent)
    }
    const title = norm(el.getAttribute('title'))
    if (title !== '') return title
    const ph = norm(el.getAttribute('placeholder'))
    if (ph !== '') return ph
    if (role === 'checkbox' || role === 'radio') {
      // a bare checkbox in a table row: the row's header or the next cell's text
      const cell = el.closest('td,th')
      const next = cell?.nextElementSibling
      if (next !== null && next !== undefined && text(next) !== '') return text(next)
    }
    return ''
  }

  const out: Control[] = []
  const perSection = new Map<string, number>()
  for (const el of candidates) {
    const role = roleOf(el)
    const kind = kindOf(role)
    const section = sectionOf(el)
    const index = perSection.get(section) ?? 0
    perSection.set(section, index + 1)
    const c: Control = { kind, role, label: labelOf(el, role), section, index }
    const name = el.getAttribute('name')
    if (name !== null && name !== '') c.name = name
    if (el.id !== '') c.id = el.id
    if (el instanceof HTMLInputElement) {
      c.type = el.type
      if (el.type === 'checkbox' || el.type === 'radio') {
        c.checked = el.checked
        c.value = el.value
      } else if (!['submit', 'button', 'reset', 'image', 'file'].includes(el.type)) c.value = el.value
      if (el.required) c.required = true
      if (el.readOnly) c.readonly = true
    } else if (el instanceof HTMLTextAreaElement) {
      c.type = 'textarea'
      c.value = el.value
      if (el.required) c.required = true
      if (el.readOnly) c.readonly = true
    } else if (el instanceof HTMLSelectElement) {
      c.type = el.multiple ? 'select-multiple' : 'select-one'
      c.options = [...el.options].map((o) => ({
        label: norm(o.label || o.text),
        value: o.value,
        selected: o.selected,
      }))
      c.value = [...el.selectedOptions].map((o) => o.value).join(',')
      if (el.required) c.required = true
    } else if (el.classList.contains('CodeMirror')) {
      c.type = 'editor'
      const cm = (el as unknown as { CodeMirror?: { getValue(): string } }).CodeMirror
      c.value = cm?.getValue() ?? ''
      const ta = el.previousElementSibling
      if (ta instanceof HTMLTextAreaElement && ta.name !== '') c.name = ta.name
    } else if (el.classList.contains('cm-content')) {
      c.type = 'editor'
      c.value = [...el.querySelectorAll('.cm-line')].map((l) => l.textContent ?? '').join('\n')
    } else if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'tab') {
      const s = el.getAttribute(role === 'tab' ? 'aria-selected' : 'aria-checked')
      if (s !== null) c.checked = s === 'true'
    }
    if (el instanceof HTMLAnchorElement) {
      try {
        const u = new URL(el.href, location.href)
        c.href = u.origin === location.origin ? u.pathname + u.search + u.hash : u.href
      } catch {
        c.href = el.getAttribute('href') ?? ''
      }
    }
    const disabled =
      (el as HTMLInputElement).disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.closest('fieldset[disabled]') !== null ||
      el.classList.contains('disabled')
    if (disabled) c.disabled = true
    out.push(c)
  }
  return out
}

/** Captures the controls of `page` (after its scripts settled, see settle()). */
export async function captureControls(page: Page, opts: CaptureOptions = {}): Promise<Control[]> {
  return page.evaluate(captureInPage, { scope: opts.scope ?? null, exclude: opts.exclude ?? [] })
}

/**
 * Waits until the page is idle: network quiet, phpMyAdmin's jQuery AJAX and animations done, fonts
 * loaded, two animation frames.
 */
export async function settle(page: Page, extraMs = 150): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page
    .waitForFunction(
      () => {
        const jq = (window as unknown as { jQuery?: { active: number; (s: string): { length: number } } })
          .jQuery
        return jq === undefined || (jq.active === 0 && jq(':animated').length === 0)
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  if (extraMs > 0) await page.waitForTimeout(extraMs)
}
