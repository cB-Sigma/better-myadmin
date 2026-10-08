import type { StatementResult } from '@bettermyadmin/contracts'

/** Whitespace-collapsed text, the way visibleText() renders phpMyAdmin's HTML. */
export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The visible text phpMyAdmin's Generator::getMessage card has for a statement result. */
export function cardText(st: StatementResult): string {
  const parts = [st.message.text]
  const card = st.card
  if (card === null || card === undefined) return collapse(parts.join(' '))
  parts.push(card.display)
  if (card.links.profiling !== null) parts.push('Profiling')
  if (card.links.editInline) parts.push('Edit inline')
  if (card.links.edit) parts.push('Edit')
  if (card.links.explain !== null) parts.push(card.links.explain.text)
  if (card.links.php === 'create') parts.push('Create PHP code')
  if (card.links.php === 'without') parts.push('Without PHP code', 'Submit query')
  if (card.links.refresh) parts.push('Refresh')
  return collapse(parts.join(' '))
}

/** The visible text of Generator::mysqlDie for an error result. */
export function errorText(st: StatementResult): string {
  const e = st.error
  if (e === undefined) return collapse(st.message.text)
  const parts = ['Error']
  if (e.sql !== null) {
    if (e.staticAnalysis.length > 0) {
      parts.push('Static analysis:', `${e.staticAnalysis.length} errors were found during analysis.`)
      for (const a of e.staticAnalysis)
        parts.push(`${a.message} (near "${a.token}" at position ${a.position})`)
    }
    parts.push('SQL query:', 'Copy', e.sql)
  }
  parts.push('MySQL said:', e.serverMessage)
  return collapse(parts.join(' '))
}
