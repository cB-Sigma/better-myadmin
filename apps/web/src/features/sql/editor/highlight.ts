import { MySQL } from '@codemirror/lang-sql'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { mysqlDocBuiltin, mysqlDocKeyword } from './docLinks'

export interface SqlSpan {
  text: string
  /** cm-keyword, cm-builtin, cm-string, cm-number, cm-comment, cm-variable-2, cm-operator… */
  cls: string
  /** MySQL manual page (and anchor) for keywords and builtins. */
  doc?: readonly string[]
}

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'cm-keyword' },
  { tag: tags.typeName, class: 'cm-builtin' },
  { tag: [tags.string, tags.special(tags.string)], class: 'cm-string' },
  { tag: tags.number, class: 'cm-number' },
  { tag: [tags.lineComment, tags.blockComment], class: 'cm-comment' },
  { tag: [tags.special(tags.name), tags.variableName], class: 'cm-variable-2' },
  { tag: tags.operator, class: 'cm-operator' },
  { tag: tags.bool, class: 'cm-atom' },
  { tag: tags.null, class: 'cm-atom' },
])

/**
 * CodeMirror.runMode($sql.text(), 'text/x-mysql') + the documentation links of keywords (longest of
 * three, two, one consecutive keywords first) and builtins.
 * pma: resources/js/modules/sql-highlight.ts::highlightSql, ::documentationKeyword, ::documentationBuiltin
 */
export function highlightSql(text: string): SqlSpan[] {
  const tree = MySQL.language.parser.parse(text)
  const spans: SqlSpan[] = []
  let pos = 0
  highlightTree(tree, highlighter, (from, to, cls) => {
    if (from > pos) spans.push({ text: text.slice(pos, from), cls: '' })
    spans.push({ text: text.slice(from, to), cls })
    pos = to
  })
  if (pos < text.length) spans.push({ text: text.slice(pos), cls: '' })

  // elements only: plain text between tokens is skipped like jQuery's .next('.cm-keyword')
  const elements = spans.filter((s) => s.cls !== '')
  elements.forEach((el, i) => {
    if (el.doc !== undefined) return
    if (el.cls === 'cm-builtin') {
      const d = mysqlDocBuiltin[el.text.toUpperCase()]
      if (d !== undefined) el.doc = d
      return
    }
    if (el.cls !== 'cm-keyword') return
    const keyword = el.text.toUpperCase()
    const next = elements[i + 1]
    if (next?.cls === 'cm-keyword') {
      const full = `${keyword} ${next.text.toUpperCase()}`
      const next2 = elements[i + 2]
      if (next2?.cls === 'cm-keyword') {
        const full2 = `${full} ${next2.text.toUpperCase()}`
        const d = mysqlDocKeyword[full2]
        if (d !== undefined) {
          el.doc = next.doc = next2.doc = d
          return
        }
      }
      const d = mysqlDocKeyword[full]
      if (d !== undefined) {
        el.doc = next.doc = d
        return
      }
    }
    const d = mysqlDocKeyword[keyword]
    if (d !== undefined) el.doc = d
  })
  return spans
}
