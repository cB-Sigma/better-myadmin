/**
 * gettext_noop markers: a msgid kept untranslated in a table or returned by a pure function, and
 * translated where it is shown (`t(row.title)`, `tr.gettext(message)`). They return their argument
 * unchanged; `pnpm i18n:parity` and the parity scanner (tools/parity) read them as msgid uses, so only
 * mark a literal that really is translated before it reaches the user.
 */
export const N_ = (msgid: string): string => msgid

/** pgettext_noop: `NC_('Collation', 'Swedish')` marks the msgid `Swedish` of context `Collation`. */
export const NC_ = (_msgctxt: string, msgid: string): string => msgid
