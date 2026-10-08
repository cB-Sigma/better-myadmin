import { formatBytes } from '@bettermyadmin/i18n/format'
import type { Gettext } from '@bettermyadmin/i18n/translator'

/**
 * `implode(' ', Util::formatByteDown($size, 3, 1))` as Results::handleNonPrintableContents prints a
 * BLOB size (the ported helper from packages/i18n: translated units and separators).
 */
export function formatByteDown(tr: Gettext, bytes: number, limes = 3, comma = 1): string {
  return formatBytes(tr, bytes, limes, comma)
}
