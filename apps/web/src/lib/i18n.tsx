import type { I18nState } from '@bettermyadmin/contracts'
import type { Catalog } from '@bettermyadmin/i18n/compile'
import { type SprintfArg, sprintf } from '@bettermyadmin/i18n/php'
import { Translator } from '@bettermyadmin/i18n/translator'
import { i18n as lingui } from '@lingui/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, type ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'
import { qk } from './queryKeys'

/**
 * Translations with phpMyAdmin's catalogues (docs/architecture/10-i18n-and-accessibility.md#i18n).
 * Msgids are phpMyAdmin's verbatim; placeholders are printf-style and filled like PHP's sprintf.
 */

// one lazily loaded chunk per locale, compiled from packages/i18n/po/*.po by the Vite plugin
const catalogs = import.meta.glob<Catalog>('../../../../packages/i18n/po/*.po', { import: 'default' })

async function loadCatalog(code: string): Promise<Catalog | null> {
  const load = catalogs[`../../../../packages/i18n/po/${code}.po`]
  return load === undefined ? null : load()
}

let current = new Translator('en', null, lingui)

/** `__()` — with arguments, `sprintf(__(msgid), ...args)`. */
export function t(msgid: string, ...args: SprintfArg[]): string {
  const s = current.gettext(msgid)
  return args.length > 0 ? sprintf(s, ...args) : s
}

/** `_ngettext()`; the count is not substituted (phpMyAdmin passes it to sprintf separately). */
export function ngettext(msgid: string, msgidPlural: string, n: number): string {
  return current.ngettext(msgid, msgidPlural, n)
}

/** `_pgettext()` */
export function pgettext(msgctxt: string, msgid: string): string {
  return current.pgettext(msgctxt, msgid)
}

/** The active Translator, for the formatting helpers (formatNumber, formatByteDown…). */
export function translator(): Translator {
  return current
}

const PLACEHOLDER = /%(?:(\d+)\$)?[-+ 0]*(?:'.)?\d*(?:\.\d+)?[bcdeEfFgGosuxX]|%%/g

/**
 * A translated message whose placeholders may be React nodes:
 * `<Trans id="Welcome to %s" args={[<bdo dir="ltr" lang="en">BetterMyAdmin</bdo>]} />`.
 */
export function Trans({ id, args = [] }: { id: string; args?: Array<SprintfArg | ReactNode> }) {
  useContext(LocaleContext)
  const s = current.gettext(id)
  if (args.every((a) => a === null || ['string', 'number', 'boolean'].includes(typeof a))) {
    return <>{args.length > 0 ? sprintf(s, ...(args as SprintfArg[])) : s}</>
  }
  const out: ReactNode[] = []
  let last = 0
  let next = 0
  for (const m of s.matchAll(PLACEHOLDER)) {
    out.push(s.slice(last, m.index))
    if (m[0] === '%%') out.push('%')
    else {
      const idx = m[1] !== undefined ? Number(m[1]) - 1 : next++
      const arg = args[idx]
      out.push(
        arg === null || ['string', 'number', 'boolean'].includes(typeof arg)
          ? sprintf(m[0].replace(/^%\d+\$/, '%'), arg as SprintfArg)
          : arg,
      )
    }
    last = m.index + m[0].length
  }
  out.push(s.slice(last))
  return (
    <>
      {out.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static message parts
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  )
}

const LocaleContext = createContext<I18nState | null>(null)

/** The current language and the selector's options. */
export function useLanguage() {
  const state = useContext(LocaleContext)
  const qc = useQueryClient()
  return {
    state,
    /** The selector's autosubmit: ask the server for `lang` (it sets the language cookie). */
    setLanguage: async (key: string) => {
      const next = await api.i18n(key)
      qc.setQueryData(qk.i18n, next)
    },
  }
}

function applyDocument(state: I18nState) {
  // pma: base.twig `<html lang="{lang}" dir="{text_dir}">`
  document.documentElement.lang = state.code
  document.documentElement.dir = state.dir
}

/**
 * Loads the request language (server-side LanguageManager) and its catalogue before rendering, and
 * re-mounts the tree when the language changes (phpMyAdmin reloads the page).
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const state = useQuery({
    queryKey: qk.i18n,
    queryFn: () => api.i18n(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [ready, setReady] = useState<string | null>(null)
  useEffect(() => {
    if (state.data === undefined) return
    const s = state.data
    let cancelled = false
    void loadCatalog(s.code).then((catalog) => {
      if (cancelled) return
      current = new Translator(s.code, catalog, lingui)
      applyDocument(s)
      setReady(s.code)
    })
    return () => {
      cancelled = true
    }
  }, [state.data])
  if (state.isError) return <>{children}</>
  if (state.data === undefined || ready !== state.data.code) return null
  return (
    <LocaleContext.Provider value={state.data}>
      <Fragment key={state.data.code}>{children}</Fragment>
    </LocaleContext.Provider>
  )
}
