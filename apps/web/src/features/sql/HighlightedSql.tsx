import { mysqlDocUrl } from '@bettermyadmin/ui'
import { useEffect, useState } from 'react'
import type { SqlSpan } from './editor/highlight'

let highlighter: Promise<(text: string) => SqlSpan[]> | null = null
const loadHighlighter = () => {
  highlighter ??= import('./editor/highlight').then((m) => m.highlightSql)
  return highlighter
}

/**
 * `<pre><code class="sql">`, highlighted with the MySQL mode once the CodeMirror chunk is loaded and
 * with keywords/builtins linked to the MySQL manual (`a.cm-sql-doc`, target `mysql_doc`).
 * pma: resources/js/modules/sql-highlight.ts::highlightSql
 */
export function HighlightedSql({
  sql,
  versionInt = 0,
  highlight = true,
  docLinks = true,
  className = '',
}: {
  sql: string
  versionInt?: number
  /** false for the PHP code (code.php is not highlighted) */
  highlight?: boolean
  /**
   * false: the classes only, without the manual links — the console's messages, bookmarks and debug
   * log (pma: CodeMirror.runMode(text, 'text/x-sql', elem) in modules/console.ts)
   */
  docLinks?: boolean
  className?: string
}) {
  const [spans, setSpans] = useState<SqlSpan[] | null>(null)
  useEffect(() => {
    if (!highlight) return
    let alive = true
    void loadHighlighter().then((h) => {
      if (alive) setSpans(h(sql))
    })
    return () => {
      alive = false
    }
  }, [sql, highlight])
  return (
    <pre className={`overflow-x-auto whitespace-pre-wrap font-mono text-xs ${className}`} dir="ltr">
      <code className={highlight ? 'sql' : 'php'}>
        {spans === null || !highlight
          ? sql
          : spans.map((s, i) =>
              s.cls === '' ? (
                s.text
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
                <span key={i} className={s.cls}>
                  {s.doc !== undefined && docLinks ? (
                    <a
                      target="mysql_doc"
                      rel="noopener noreferrer"
                      className="cm-sql-doc"
                      href={mysqlDocUrl(s.doc[0] ?? '', s.doc[1] ?? '', versionInt)}
                    >
                      {s.text}
                    </a>
                  ) : (
                    s.text
                  )}
                </span>
              ),
            )}
      </code>
    </pre>
  )
}
