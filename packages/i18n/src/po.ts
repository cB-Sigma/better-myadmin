/**
 * Minimal gettext PO reader, enough for phpMyAdmin's Weblate-generated catalogues
 * (resources/po/*.po): msgctxt, msgid, msgid_plural, msgstr[n], flags, obsolete entries.
 */

export interface PoEntry {
  msgctxt: string | null
  msgid: string
  msgidPlural: string | null
  /** One element for singular entries, nplurals elements for plural ones. */
  msgstr: string[]
  flags: string[]
  /** `#~` entries; msgfmt ignores them. */
  obsolete: boolean
}

export interface PoFile {
  /** The header entry's msgstr, parsed into `Name: value` pairs (case kept). */
  headers: Record<string, string>
  /** Raw header msgstr (what msgfmt stores as the translation of ""). */
  headerRaw: string
  entries: PoEntry[]
}

/** C-style escapes used in PO string literals. */
export function unescapePo(s: string): string {
  return s.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|(.))/g, (_m, oct, hex, ch: string | undefined) => {
    if (oct !== undefined) return String.fromCharCode(Number.parseInt(oct, 8))
    if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16))
    switch (ch) {
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'r':
        return '\r'
      case 'a':
        return '\x07'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case 'v':
        return '\v'
      default:
        return ch ?? ''
    }
  })
}

type Field = 'msgctxt' | 'msgid' | 'msgid_plural' | `msgstr[${number}]` | 'msgstr'

export function parsePo(text: string): PoFile {
  const entries: PoEntry[] = []
  let cur: {
    fields: Map<Field, string>
    flags: string[]
    obsolete: boolean
  } | null = null
  let last: Field | null = null

  const flush = () => {
    if (cur === null || !cur.fields.has('msgid')) {
      cur = null
      last = null
      return
    }
    const f = cur.fields
    const plural = f.get('msgid_plural') ?? null
    const msgstr: string[] = []
    if (plural !== null) {
      for (let i = 0; f.has(`msgstr[${i}]`); i++) msgstr.push(f.get(`msgstr[${i}]`)!)
    } else {
      msgstr.push(f.get('msgstr') ?? f.get('msgstr[0]') ?? '')
    }
    entries.push({
      msgctxt: f.get('msgctxt') ?? null,
      msgid: f.get('msgid')!,
      msgidPlural: plural,
      msgstr,
      flags: cur.flags,
      obsolete: cur.obsolete,
    })
    cur = null
    last = null
  }

  const start = () => {
    cur ??= { fields: new Map(), flags: [], obsolete: false }
    return cur
  }

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine
    if (line.trim() === '') {
      flush()
      continue
    }
    let obsolete = false
    if (line.startsWith('#~')) {
      obsolete = true
      line = line.replace(/^#~\s?/, '')
      if (line.startsWith('|')) continue
    } else if (line.startsWith('#')) {
      // a comment after a complete entry starts a new one
      if (cur !== null && last !== null && last.startsWith('msgstr')) flush()
      if (line.startsWith('#,')) {
        const c = start()
        c.flags.push(
          ...line
            .slice(2)
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x !== ''),
        )
      }
      continue
    }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+"(.*)"\s*$/.exec(line)
    if (m !== null) {
      const key = m[1] as Field
      // a keyword that starts a new entry after msgstr
      if ((key === 'msgid' || key === 'msgctxt') && last !== null && last.startsWith('msgstr')) flush()
      const c = start()
      if (obsolete) c.obsolete = true
      c.fields.set(key, unescapePo(m[3]!))
      last = key
      continue
    }
    const cont = /^\s*"(.*)"\s*$/.exec(line)
    if (cont !== null && cur !== null && last !== null) {
      const c = cur as { fields: Map<Field, string> }
      c.fields.set(last, (c.fields.get(last) ?? '') + unescapePo(cont[1]!))
      continue
    }
    throw new Error(`Unparseable PO line: ${rawLine}`)
  }
  flush()

  let headerRaw = ''
  const headers: Record<string, string> = {}
  const body: PoEntry[] = []
  for (const e of entries) {
    if (e.msgid === '' && e.msgctxt === null && !e.obsolete) {
      headerRaw = e.msgstr[0] ?? ''
      for (const h of headerRaw.split('\n')) {
        const i = h.indexOf(':')
        if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim()
      }
    } else {
      body.push(e)
    }
  }
  return { headers, headerRaw, entries: body }
}

/** gettext's key for an entry as stored in a .mo file (and in motranslator's cache). */
export function moKey(e: Pick<PoEntry, 'msgctxt' | 'msgid' | 'msgidPlural'>): string {
  const id = e.msgidPlural !== null ? `${e.msgid}\u0000${e.msgidPlural}` : e.msgid
  return e.msgctxt !== null ? `${e.msgctxt}\u0004${id}` : id
}

/** Whether msgfmt would write the entry into the .mo (non-fuzzy, every msgstr filled). */
export function isCompiled(e: PoEntry): boolean {
  return !e.obsolete && !e.flags.includes('fuzzy') && e.msgstr.length > 0 && e.msgstr.every((s) => s !== '')
}

/**
 * `msgfmt --statistics` counts as used by bin/remove-incomplete-mo:
 * translated = compiled entries, fuzzy = fuzzy entries with a translation, the rest untranslated.
 */
export function poStatistics(po: PoFile): { translated: number; fuzzy: number; untranslated: number } {
  let translated = 0
  let fuzzy = 0
  let untranslated = 0
  for (const e of po.entries) {
    if (e.obsolete) continue
    if (isCompiled(e)) translated++
    else if (e.flags.includes('fuzzy') && e.msgstr.some((s) => s !== '')) fuzzy++
    else untranslated++
  }
  return { translated, fuzzy, untranslated }
}
