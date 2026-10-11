/**
 * Reader for phpMyAdmin's resources/po/phpmyadmin.pot that keeps the `#:` source references
 * (packages/i18n's PO reader drops them).
 */

export interface PotEntry {
  msgid: string
  context: string | null
  plural: string | null
  /** `file:line` references from `#:` comments. */
  refs: string[]
}

/** Identity of a message: context + msgid (the plural form does not change the lookup key). */
export function msgKey(msgid: string, context: string | null | undefined): string {
  return context === null || context === undefined ? msgid : `${context}\u0004${msgid}`
}

function unescapePot(s: string): string {
  return s.replace(/\\(.)/g, (_m, c: string) => {
    switch (c) {
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'r':
        return '\r'
      default:
        return c
    }
  })
}

export function parsePot(text: string): PotEntry[] {
  const entries: PotEntry[] = []
  let refs: string[] = []
  let fields: Record<string, string> = {}
  let last: string | null = null
  const flush = () => {
    if (fields.msgid !== undefined && fields.msgid !== '') {
      entries.push({
        msgid: fields.msgid,
        context: fields.msgctxt ?? null,
        plural: fields.msgid_plural ?? null,
        refs,
      })
    }
    refs = []
    fields = {}
    last = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith('#~')) continue
    if (line.startsWith('#:')) {
      if (fields.msgid !== undefined) flush()
      refs.push(...line.slice(2).trim().split(/\s+/))
      continue
    }
    if (line.startsWith('#')) {
      if (fields.msgid !== undefined) flush()
      continue
    }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+"(.*)"$/.exec(line)
    if (m !== null) {
      if (m[1] === 'msgctxt' && fields.msgid !== undefined) flush()
      last = m[1]!
      fields[last] = unescapePot(m[2]!)
      continue
    }
    const cont = /^"(.*)"$/.exec(line)
    if (cont !== null && last !== null) fields[last] = (fields[last] ?? '') + unescapePot(cont[1]!)
  }
  flush()
  return entries
}
