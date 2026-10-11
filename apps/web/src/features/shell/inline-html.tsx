import { Fragment, type ReactNode } from 'react'

const TAG = /<(code|em|strong|b|i)>(.*?)<\/\1>/g

/**
 * A translated phpMyAdmin message that carries inline markup in its msgid (`<code>…</code>`,
 * `<em>…</em>`, `<strong>…</strong>`), rendered as React nodes; everything else stays text.
 */
export function InlineHtml({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TAG)) {
    out.push(text.slice(last, m.index))
    const inner = m[2] ?? ''
    const tag = m[1]
    out.push(
      tag === 'code' ? (
        <code>{inner}</code>
      ) : tag === 'em' || tag === 'i' ? (
        <em>{inner}</em>
      ) : (
        <strong>{inner}</strong>
      ),
    )
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return (
    <>
      {out.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static message parts
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  )
}

/** The message without its markup (for window.alert / plain-text uses). */
export const stripInlineHtml = (text: string) => text.replace(TAG, '$2')
