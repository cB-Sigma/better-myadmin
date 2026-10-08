/**
 * phpMyAdmin's locale-aware formatting helpers, ported one-to-one (same unit strings, rounding and
 * translated separators). Every function takes the request/page Translator because phpMyAdmin reads its
 * separators and unit names from the catalogue (`__('.')`, `__(',')`, `__('KiB')`…).
 *
 * pma: src/Util.php (formatNumber, formatByteDown, timespanFormat, localisedDate,
 *      getFormattedMaximumUploadSize). Verified against PHP output in test/fixtures/format.json.
 */
import { numberFormat, phpFloatval, phpRound, sprintf } from './php.ts'
import type { Gettext } from './translator.ts'

const SI_UNITS: Record<number, string> = {
  [-10]: 'q',
  [-9]: 'r',
  [-8]: 'y',
  [-7]: 'z',
  [-6]: 'a',
  [-5]: 'f',
  [-4]: 'p',
  [-3]: 'n',
  [-2]: 'µ',
  [-1]: 'm',
  0: '',
  1: 'k',
  2: 'M',
  3: 'G',
  4: 'T',
  5: 'P',
  6: 'E',
  7: 'Z',
  8: 'Y',
  9: 'R',
  10: 'Q',
}

const escapeRe = (s: string) => s.replace(/[.\\+*?[^\]$(){}=!<>|:\-#/]/g, '\\$&')

/** Util::formatNumber */
export function formatNumber(
  tr: Gettext,
  input: number | string,
  digitsLeft = 3,
  digitsRight = 0,
  onlyDown = false,
  noTrailingZero = true,
): string {
  let value = typeof input === 'string' ? phpFloatval(input) : input
  if (value === 0) return '0'

  /* l10n: Decimal separator */
  const decimalSep = tr.gettext('.')
  /* l10n: Thousands separator */
  const thousandsSep = tr.gettext(',')

  if (digitsLeft === 0) {
    const formatted = numberFormat(value, digitsRight, decimalSep, thousandsSep)
    if (phpFloatval(formatted) === 0) {
      return `<${numberFormat(1 / 10 ** digitsRight, digitsRight, decimalSep, thousandsSep)}`
    }
    return formatted
  }

  let sign = ''
  if (value < 0) {
    sign = '-'
    value = Math.abs(value)
  }

  const dh = 10 ** digitsRight
  let d = Math.floor(Math.log10(value) / 3)
  const curDigits = Math.floor(Math.log10(value / 1000 ** d) + 1)
  if (digitsLeft > curDigits) d -= Math.floor((digitsLeft - curDigits) / 3)
  if (d < 0 && onlyDown) d = 0

  d = Math.min(Math.max(Math.trunc(d), -10), 10)
  value = phpRound(value / (1000 ** d / dh)) / dh
  const unit = SI_UNITS[d]!

  let formattedValue = numberFormat(value, digitsRight, decimalSep, thousandsSep)
  if (noTrailingZero && formattedValue.includes(decimalSep)) {
    formattedValue = formattedValue.replace(new RegExp(`${escapeRe(decimalSep)}?0+$`), '')
  }

  if (value === 0) {
    return `<${numberFormat(1 / 10 ** digitsRight, digitsRight, decimalSep, thousandsSep)}${unit === '' ? '' : ` ${unit}`}`
  }
  return sign + formattedValue + (unit === '' ? '' : ` ${unit}`)
}

/** Util::formatByteDown — returns [value, unit], or null for a null value. */
export function formatByteDown(
  tr: Gettext,
  input: number | string | null,
  limes = 6,
  comma = 0,
): [string, string] | null {
  if (input === null) return null
  let value = typeof input === 'string' ? phpFloatval(input) : input
  const byteUnits = [
    /* l10n: shortcuts for Byte */
    tr.gettext('B'),
    /* l10n: shortcuts for Kilobyte */
    tr.gettext('KiB'),
    /* l10n: shortcuts for Megabyte */
    tr.gettext('MiB'),
    /* l10n: shortcuts for Gigabyte */
    tr.gettext('GiB'),
    /* l10n: shortcuts for Terabyte */
    tr.gettext('TiB'),
    /* l10n: shortcuts for Petabyte */
    tr.gettext('PiB'),
    /* l10n: shortcuts for Exabyte */
    tr.gettext('EiB'),
  ]
  const dh = 10 ** comma
  const li = 10 ** limes
  let unit = byteUnits[0]!
  for (let d = 6, ex = 15; d >= 1; d--, ex -= 3) {
    const unitSize = li * 10 ** ex
    if (value >= unitSize) {
      value = phpRound(value / (1024 ** d / dh)) / dh
      unit = byteUnits[d]!
      break
    }
  }
  const returnValue =
    unit !== byteUnits[0] ? formatNumber(tr, value, 5, comma, true, false) : formatNumber(tr, value, 0)
  return [returnValue.trim(), unit]
}

/** `implode(' ', Util::formatByteDown(...))`, the way templates usually print it. */
export function formatBytes(tr: Gettext, value: number | string, limes = 6, comma = 0): string {
  return formatByteDown(tr, value, limes, comma)!.join(' ')
}

/** Util::getFormattedMaximumUploadSize */
export function getFormattedMaximumUploadSize(tr: Gettext, maxUploadSize: number | string): string {
  const [maxSize, maxUnit] = formatByteDown(tr, maxUploadSize, 4)!
  return `(${sprintf(tr.gettext('Max: %s%s'), maxSize, maxUnit)})`
}

/** Util::timespanFormat */
export function timespanFormat(tr: Gettext, input: number): string {
  let seconds = Math.trunc(input)
  const days = Math.floor(seconds / 86400)
  if (days > 0) seconds -= days * 86400
  const hours = Math.floor(seconds / 3600)
  if (days > 0 || hours > 0) seconds -= hours * 3600
  const minutes = Math.floor(seconds / 60)
  if (days > 0 || hours > 0 || minutes > 0) seconds -= minutes * 60
  return sprintf(
    tr.gettext('%s days, %s hours, %s minutes and %s seconds'),
    String(days),
    String(hours),
    String(minutes),
    String(seconds),
  )
}

interface WallClock {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
  weekday: number // 0 = Sunday
  /** minutes east of UTC */
  offset: number
  zoneName: string
  epoch: number
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>()

function wallClock(epochSeconds: number, timeZone: string): WallClock {
  let fmt = wallClockFormatters.get(timeZone)
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      timeZoneName: 'short',
    })
    wallClockFormatters.set(timeZone, fmt)
  }
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(new Date(epochSeconds * 1000))) parts[p.type] = p.value
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second) / 1000
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? 'Sun'),
    offset: Math.round((asUtc - Math.floor(epochSeconds)) / 60),
    zoneName: parts.timeZoneName ?? '',
    epoch: Math.floor(epochSeconds),
  }
}

const C_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const C_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const p2 = (n: number, pad = '0') => String(n).padStart(2, pad)

function dayOfYear(w: WallClock): number {
  return (Date.UTC(w.year, w.month - 1, w.day) - Date.UTC(w.year, 0, 1)) / 86400000
}

function isoWeek(w: WallClock): [number, number] {
  const date = new Date(Date.UTC(w.year, w.month - 1, w.day))
  const dow = (w.weekday + 6) % 7 // Monday = 0
  date.setUTCDate(date.getUTCDate() - dow + 3)
  const isoYear = date.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    )
  return [isoYear, week]
}

/** strftime() in the C locale (phpMyAdmin's setlocale(0, 'de') etc. fail on glibc, so C applies). */
export function strftimeC(format: string, epochSeconds: number, timeZone = 'UTC'): string {
  const w = wallClock(epochSeconds, timeZone)
  const yday = dayOfYear(w)
  const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12
  const conv = (c: string): string | null => {
    switch (c) {
      case 'a':
        return C_DAYS[w.weekday]!.slice(0, 3)
      case 'A':
        return C_DAYS[w.weekday]!
      case 'b':
      case 'h':
        return C_MONTHS[w.month - 1]!.slice(0, 3)
      case 'B':
        return C_MONTHS[w.month - 1]!
      case 'c':
        return `${conv('a')} ${conv('b')} ${conv('e')} ${conv('T')} ${w.year}`
      case 'C':
        return p2(Math.floor(w.year / 100))
      case 'd':
        return p2(w.day)
      case 'D':
        return `${conv('m')}/${conv('d')}/${conv('y')}`
      case 'e':
        return p2(w.day, ' ')
      case 'F':
        return `${w.year}-${conv('m')}-${conv('d')}`
      case 'G':
        return String(isoWeek(w)[0])
      case 'g':
        return p2(isoWeek(w)[0] % 100)
      case 'H':
        return p2(w.hour)
      case 'I':
        return p2(h12)
      case 'j':
        return String(yday + 1).padStart(3, '0')
      case 'k':
        return p2(w.hour, ' ')
      case 'l':
        return p2(h12, ' ')
      case 'm':
        return p2(w.month)
      case 'M':
        return p2(w.minute)
      case 'n':
        return '\n'
      case 'p':
        return w.hour >= 12 ? 'PM' : 'AM'
      case 'P':
        return w.hour >= 12 ? 'pm' : 'am'
      case 'r':
        return `${conv('I')}:${conv('M')}:${conv('S')} ${conv('p')}`
      case 'R':
        return `${conv('H')}:${conv('M')}`
      case 's':
        return String(w.epoch)
      case 'S':
        return p2(w.second)
      case 't':
        return '\t'
      case 'T':
      case 'X':
        return `${conv('H')}:${conv('M')}:${conv('S')}`
      case 'u':
        return String(w.weekday === 0 ? 7 : w.weekday)
      case 'U':
        return p2(Math.floor((yday + 7 - w.weekday) / 7))
      case 'V':
        return p2(isoWeek(w)[1])
      case 'w':
        return String(w.weekday)
      case 'W':
        return p2(Math.floor((yday + 7 - ((w.weekday + 6) % 7)) / 7))
      case 'x':
        return `${conv('m')}/${conv('d')}/${conv('y')}`
      case 'y':
        return p2(w.year % 100)
      case 'Y':
        return String(w.year)
      case 'z': {
        const o = Math.abs(w.offset)
        return `${w.offset < 0 ? '-' : '+'}${p2(Math.floor(o / 60))}${p2(o % 60)}`
      }
      case 'Z':
        return w.zoneName
      case '%':
        return '%'
      default:
        return null
    }
  }
  return format.replace(/%(.?)/g, (m, c: string) => conv(c) ?? m)
}

/**
 * Util::localisedDate — translated day/month names (note: `%B`/`%A` are replaced with the *short*
 * names, like phpMyAdmin), translated AM/PM, the rest through strftime in the C locale.
 * `timeZone` is PHP's default time zone (date.timezone), which strftime uses.
 */
export function localisedDate(tr: Gettext, epochSeconds: number, format = '', timeZone = 'UTC'): string {
  const month = [
    tr.pgettext('Short month name for January', 'Jan'),
    tr.pgettext('Short month name for February', 'Feb'),
    tr.pgettext('Short month name for March', 'Mar'),
    tr.pgettext('Short month name for April', 'Apr'),
    tr.pgettext('Short month name for May', 'May'),
    tr.pgettext('Short month name for June', 'Jun'),
    tr.pgettext('Short month name for July', 'Jul'),
    tr.pgettext('Short month name for August', 'Aug'),
    tr.pgettext('Short month name for September', 'Sep'),
    tr.pgettext('Short month name for October', 'Oct'),
    tr.pgettext('Short month name for November', 'Nov'),
    tr.pgettext('Short month name for December', 'Dec'),
  ]
  const dayOfWeek = [
    tr.pgettext('Short week day name for Sunday', 'Sun'),
    tr.pgettext('Short week day name for Monday', 'Mon'),
    tr.pgettext('Short week day name for Tuesday', 'Tue'),
    tr.pgettext('Short week day name for Wednesday', 'Wed'),
    tr.pgettext('Short week day name for Thursday', 'Thu'),
    tr.pgettext('Short week day name for Friday', 'Fri'),
    tr.pgettext('Short week day name for Saturday', 'Sat'),
  ]
  let fmt = format
  if (fmt === '') {
    /* l10n: See https://www.php.net/manual/en/function.strftime.php */
    fmt = tr.gettext('%B %d, %Y at %I:%M %p')
  }
  const w = wallClock(epochSeconds, timeZone)
  let date = fmt.replace(/%[aA]/g, () => dayOfWeek[w.weekday]!)
  date = date.replace(/%[bB]/g, () => month[w.month - 1]!)
  const amPm =
    w.hour >= 12
      ? tr.pgettext('AM/PM indication in time', 'PM')
      : tr.pgettext('AM/PM indication in time', 'AM')
  date = date.replace(/%[pP]/g, () => amPm)
  return strftimeC(date, epochSeconds, timeZone)
}
