import { type PoEntry, isCompiled, moKey, parsePo } from './po.ts'

/**
 * Lingui compiled message. Every message is an array so Lingui never runs its ICU compiler over
 * phpMyAdmin's printf-style strings (`{`, `'` and `#` are literal in gettext).
 */
export type CompiledMessage = Array<string | [string, 'select', Record<string, string[]>]>

/** A per-locale catalogue as loaded into Lingui. */
export interface Catalog {
  /** The .mo header's Plural-Forms value (motranslator reads it from the "" entry). */
  pluralForms: string
  /** Keyed like a .mo file: msgid, `msgid\0msgid_plural`, `msgctxt\x04msgid`. */
  messages: Record<string, CompiledMessage>
}

/** Plural entries become a `select` on the form index; `other` is form 0 (Translator::ngettext's fallback). */
export function compileEntry(e: PoEntry): CompiledMessage {
  if (e.msgidPlural === null) return [e.msgstr[0]!]
  const cases: Record<string, string[]> = {}
  e.msgstr.forEach((s, i) => {
    cases[String(i)] = [s]
  })
  cases.other = [e.msgstr[0]!]
  return [['i', 'select', cases]]
}

/**
 * PO text → catalogue with exactly what msgfmt would compile into the .mo phpMyAdmin loads
 * (non-fuzzy entries whose every msgstr is non-empty).
 */
export function compileCatalog(poText: string): Catalog {
  const po = parsePo(poText)
  const messages: Record<string, CompiledMessage> = {}
  for (const e of po.entries) if (isCompiled(e)) messages[moKey(e)] = compileEntry(e)
  let pluralForms = ''
  for (const line of po.headerRaw.split('\n')) {
    if (line.toLowerCase().startsWith('plural-forms:')) pluralForms = line.slice(13)
  }
  return { pluralForms, messages }
}

function quote(s: string): string {
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`
}

/** Writes a PO file (one line per string; msgfmt and parsePo both accept it). */
export function formatPo(headerRaw: string, entries: PoEntry[], comment = ''): string {
  const out: string[] = []
  if (comment !== '') out.push(...comment.split('\n').map((l) => `# ${l}`.trimEnd()))
  out.push('msgid ""', `msgstr ${quote(headerRaw)}`, '')
  for (const e of entries) {
    if (e.msgctxt !== null) out.push(`msgctxt ${quote(e.msgctxt)}`)
    out.push(`msgid ${quote(e.msgid)}`)
    if (e.msgidPlural !== null) {
      out.push(`msgid_plural ${quote(e.msgidPlural)}`)
      e.msgstr.forEach((s, i) => {
        out.push(`msgstr[${i}] ${quote(s)}`)
      })
    } else {
      out.push(`msgstr ${quote(e.msgstr[0] ?? '')}`)
    }
    out.push('')
  }
  return out.join('\n')
}
