/**
 * The date and time logic of phpMyAdmin's picker (jQuery UI datepicker + jquery-ui-timepicker-addon
 * 1.6.3) as pure functions: the options addDatepicker / addDateTimePicker pass, the calendar grid
 * _generateHTML draws, and the `yy-mm-dd` / `HH:mm:ss[.l[c]]` formats it reads and writes.
 * pma: resources/js/modules/functions.ts (addDatepicker, addDateTimePicker),
 *      resources/js/makegrid.ts (the cell editor's options), resources/js/datetimepicker.ts
 */

/** `data-type` of the field: addDatepicker does nothing for any other type. */
export type PickerKind = 'date' | 'time' | 'datetime' | 'timestamp'

export interface PickerOptions {
  showMillisec: boolean
  showMicrosec: boolean
  /** `HH:mm:ss`, `HH:mm:ss.l` or `HH:mm:ss.lc` */
  timeFormat: string
  /** 23, or 99 for a TIME column (addDateTimePicker) */
  hourMax: number
  /** $cfg['FirstDayOfCalendar'] (0 Sunday … 6 Saturday; 7 is Sunday too) */
  firstDay: number
}

/** addDatepicker's defaultOptions (routines' parameters use them as they are). */
export const DEFAULT_PICKER_OPTIONS: PickerOptions = {
  showMillisec: true,
  showMicrosec: true,
  timeFormat: 'HH:mm:ss.lc',
  hourMax: 23,
  firstDay: 0,
}

/** addDateTimePicker / the grid's cell editor: the fractional seconds follow the column's decimals. */
export function pickerOptionsFor(kind: PickerKind, decimals: number, firstDay: number): PickerOptions {
  let showMillisec = false
  let showMicrosec = false
  let timeFormat = 'HH:mm:ss'
  if (decimals > 0 && kind.includes('time')) {
    if (decimals > 3) {
      showMillisec = true
      showMicrosec = true
      timeFormat = 'HH:mm:ss.lc'
    } else {
      showMillisec = true
      timeFormat = 'HH:mm:ss.l'
    }
  }
  return { showMillisec, showMicrosec, timeFormat, hourMax: kind === 'time' ? 99 : 23, firstDay }
}

/** addDatepicker's type check: only these `data-type` values get a picker. */
export function isPickerKind(v: string | null | undefined): v is PickerKind {
  return v === 'date' || v === 'time' || v === 'datetime' || v === 'timestamp'
}

export interface PickerTime {
  hour: number
  minute: number
  second: number
  millisec: number
  microsec: number
}

export interface PickerValue {
  /** the selected day, or null when the field had no date yet (the calendar shows today) */
  date: { year: number; month: number; day: number } | null
  time: PickerTime
}

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0')

/** $.datepicker.formatDate('yy-mm-dd', date) */
export function formatPickerDate(d: { year: number; month: number; day: number }): string {
  return `${pad(d.year, 4)}-${pad(d.month + 1)}-${pad(d.day)}`
}

/** $.datepicker.formatTime(timeFormat, time): HH, mm, ss, l (milliseconds), c (microseconds) */
export function formatPickerTime(format: string, t: PickerTime): string {
  return format.replace(/HH|mm|ss|l|c/g, (tok) =>
    tok === 'HH'
      ? pad(t.hour)
      : tok === 'mm'
        ? pad(t.minute)
        : tok === 'ss'
          ? pad(t.second)
          : tok === 'l'
            ? pad(t.millisec, 3)
            : pad(t.microsec, 3),
  )
}

/** The field value the picker writes: the date, the time, or both separated by a space. */
export function formatPickerValue(kind: PickerKind, v: PickerValue, o: PickerOptions, today: Date): string {
  const time = formatPickerTime(o.timeFormat, v.time)
  if (kind === 'time') return time
  const date = formatPickerDate(
    v.date ?? { year: today.getFullYear(), month: today.getMonth(), day: today.getDate() },
  )
  return kind === 'date' ? date : `${date} ${time}`
}

/**
 * The value of the field when the picker opens: its date (`yyyy-mm-dd`) and time when they parse,
 * else no date and the current time (addDatepicker's hour/minute/second defaults, no fraction).
 */
export function parsePickerValue(kind: PickerKind, value: string, now: Date): PickerValue {
  const fallback: PickerTime = {
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
    millisec: 0,
    microsec: 0,
  }
  const s = value.trim()
  let date: PickerValue['date'] = null
  let rest = s
  if (kind !== 'time') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
    if (m !== null) {
      const year = Number(m[1])
      const month = Number(m[2]) - 1
      const day = Number(m[3])
      if (month >= 0 && month < 12 && day >= 1 && day <= daysInMonth(year, month)) date = { year, month, day }
      rest = s.slice(m[0].length).trim()
    }
  }
  if (kind === 'date') return { date, time: fallback }
  const t = /^(-?\d{1,3}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,6}))?$/.exec(rest)
  if (t === null) return { date, time: fallback }
  const frac = (t[4] ?? '').padEnd(6, '0')
  return {
    date,
    time: {
      hour: Math.abs(Number(t[1])),
      minute: Number(t[2]),
      second: Number(t[3] ?? 0),
      millisec: Number(frac.slice(0, 3)),
      microsec: Number(frac.slice(3, 6)),
    },
  }
}

export function daysInMonth(year: number, month: number): number {
  return 32 - new Date(year, month, 32).getDate()
}

export interface CalendarCell {
  /** null for a day of another month (showOtherMonths: false draws a blank) */
  day: number | null
  /** Saturday and Sunday columns (`ui-datepicker-week-end`) */
  weekEnd: boolean
}

/** _generateHTML: the week-day columns from `firstDay`, and the rows of the drawn month. */
export function calendarGrid(
  year: number,
  month: number,
  firstDay: number,
): { columns: Array<{ dow: number; weekEnd: boolean }>; rows: CalendarCell[][] } {
  const fd = Number.isNaN(firstDay) ? 0 : firstDay
  const columns = Array.from({ length: 7 }, (_, i) => ({
    dow: (i + fd) % 7,
    weekEnd: (i + fd + 6) % 7 >= 5,
  }))
  const lead = (new Date(year, month, 1).getDay() - fd + 7) % 7
  const days = daysInMonth(year, month)
  const rows: CalendarCell[][] = []
  for (let r = 0; r < Math.ceil((lead + days) / 7); r++) {
    rows.push(
      columns.map((c, i) => {
        const d = r * 7 + i - lead + 1
        return { day: d >= 1 && d <= days ? d : null, weekEnd: c.weekEnd }
      }),
    )
  }
  return { columns, rows }
}

/** functions.ts toggleDatepickerIfInvalid: the values the open picker can show. */
export function pickerCanShow(kind: PickerKind, value: string): boolean {
  if (kind === 'date')
    return /^([0-9]{4})-(((01|03|05|07|08|10|12)-((0[1-9])|([1-2][0-9])|(3[0-1])))|((02|04|06|09|11)-((0[1-9])|([1-2][0-9])|30)))$/.test(
      value,
    )
  if (kind === 'time')
    return /^(([0-1][0-9])|(2[0-3])):((0[0-9])|([1-5][0-9])):((0[0-9])|([1-5][0-9]))(.[0-9]{1,6}){0,1}$/.test(
      value,
    )
  return true
}
