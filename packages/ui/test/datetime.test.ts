import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PICKER_OPTIONS,
  calendarGrid,
  formatPickerTime,
  formatPickerValue,
  isPickerKind,
  parsePickerValue,
  pickerCanShow,
  pickerOptionsFor,
} from '../src/lib/datetime.ts'

/** phpMyAdmin's datepicker as addDatepicker / addDateTimePicker set it up (functions.ts, makegrid.ts). */
describe('picker options', () => {
  it('addDateTimePicker: the fraction follows the decimals; TIME hours go to 99', () => {
    expect(pickerOptionsFor('datetime', 0, 1)).toEqual({
      showMillisec: false,
      showMicrosec: false,
      timeFormat: 'HH:mm:ss',
      hourMax: 23,
      firstDay: 1,
    })
    expect(pickerOptionsFor('timestamp', 3, 0)).toMatchObject({
      showMillisec: true,
      timeFormat: 'HH:mm:ss.l',
    })
    expect(pickerOptionsFor('time', 6, 0)).toMatchObject({
      showMillisec: true,
      showMicrosec: true,
      timeFormat: 'HH:mm:ss.lc',
      hourMax: 99,
    })
    // decimals only count for the time types
    expect(pickerOptionsFor('date', 6, 0).timeFormat).toBe('HH:mm:ss')
  })

  it('addDatepicker defaults (routine parameters): milli and micro seconds', () => {
    expect(DEFAULT_PICKER_OPTIONS).toMatchObject({
      showMillisec: true,
      showMicrosec: true,
      timeFormat: 'HH:mm:ss.lc',
    })
  })

  it('only date, time, datetime and timestamp get a picker', () => {
    expect(
      ['date', 'time', 'datetime', 'timestamp', 'timestamp(6)', '', undefined].map(isPickerKind),
    ).toEqual([true, true, true, true, false, false, false])
  })
})

describe('formats', () => {
  const t = { hour: 7, minute: 5, second: 9, millisec: 42, microsec: 7 }
  it('formatTime: HH, mm, ss, l, c', () => {
    expect(formatPickerTime('HH:mm:ss', t)).toBe('07:05:09')
    expect(formatPickerTime('HH:mm:ss.l', t)).toBe('07:05:09.042')
    expect(formatPickerTime('HH:mm:ss.lc', t)).toBe('07:05:09.042007')
  })

  it('the field value: yy-mm-dd, the time, or both with a space', () => {
    const v = { date: { year: 2026, month: 0, day: 3 }, time: t }
    const now = new Date(2026, 5, 1)
    const o = pickerOptionsFor('datetime', 0, 0)
    expect(formatPickerValue('date', v, o, now)).toBe('2026-01-03')
    expect(formatPickerValue('datetime', v, o, now)).toBe('2026-01-03 07:05:09')
    expect(formatPickerValue('time', v, o, now)).toBe('07:05:09')
    // no day picked yet: today's date with the time
    expect(formatPickerValue('datetime', { ...v, date: null }, o, now)).toBe('2026-06-01 07:05:09')
  })

  it('parse: the field value, else no date and the current time', () => {
    const now = new Date(2026, 4, 2, 13, 14, 15)
    expect(parsePickerValue('datetime', '2025-12-31 23:59:58.123456', now)).toEqual({
      date: { year: 2025, month: 11, day: 31 },
      time: { hour: 23, minute: 59, second: 58, millisec: 123, microsec: 456 },
    })
    expect(parsePickerValue('date', 'x', now)).toEqual({
      date: null,
      time: { hour: 13, minute: 14, second: 15, millisec: 0, microsec: 0 },
    })
    expect(parsePickerValue('date', '2025-02-30', now).date).toBeNull()
    expect(parsePickerValue('time', '838:59:59', now).time).toMatchObject({ hour: 838, minute: 59 })
  })

  it('toggleDatepickerIfInvalid: the values the open picker can show', () => {
    expect(pickerCanShow('date', '2026-02-28')).toBe(true)
    // (February sits with the 30-day months in phpMyAdmin's expression)
    expect(pickerCanShow('date', '2026-02-30')).toBe(true)
    expect(pickerCanShow('date', '2026-02-31')).toBe(false)
    expect(pickerCanShow('time', '23:59:59.5')).toBe(true)
    expect(pickerCanShow('time', '24:00:00')).toBe(false)
    expect(pickerCanShow('datetime', 'anything')).toBe(true)
  })
})

describe('calendarGrid (_generateHTML)', () => {
  it('October 2026 from Sunday: 5 rows, the 1st on Thursday, weekend columns', () => {
    const g = calendarGrid(2026, 9, 0)
    expect(g.columns.map((c) => c.dow)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(g.columns.map((c) => c.weekEnd)).toEqual([true, false, false, false, false, false, true])
    expect(g.rows).toHaveLength(5)
    expect(g.rows[0]?.map((c) => c.day)).toEqual([null, null, null, null, 1, 2, 3])
    expect(g.rows[4]?.map((c) => c.day)).toEqual([25, 26, 27, 28, 29, 30, 31])
  })

  it('FirstDayOfCalendar 1 starts on Monday; 7 is Sunday again', () => {
    const g = calendarGrid(2026, 9, 1)
    expect(g.columns.map((c) => c.dow)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(g.columns.map((c) => c.weekEnd)).toEqual([false, false, false, false, false, true, true])
    expect(g.rows[0]?.map((c) => c.day)).toEqual([null, null, null, 1, 2, 3, 4])
    expect(calendarGrid(2026, 9, 7).columns[0]?.dow).toBe(0)
  })
})
