import { Fragment, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { cn } from '../lib/cn.ts'
import {
  DEFAULT_PICKER_OPTIONS,
  type PickerKind,
  type PickerOptions,
  type PickerTime,
  calendarGrid,
  formatPickerTime,
  formatPickerValue,
  parsePickerValue,
} from '../lib/datetime.ts'
import { useUiSettings } from '../settings.tsx'
import { PmaIcon } from './icon.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './menus.tsx'

/**
 * phpMyAdmin's date and time picker: the jQuery UI datepicker with the timepicker addon, as
 * addDatepicker configures it (showOn 'button', changeYear, no button panel, yy-mm-dd and
 * HH:mm:ss[.l[c]], the hour, minute, second, millisecond and microsecond sliders, timeInput),
 * with the calendar names of datetimepicker.ts. Its markup keeps jQuery UI's classes.
 * pma: resources/js/modules/functions.ts (addDatepicker), resources/js/datetimepicker.ts,
 *      jquery-ui datepicker _generateHTML, jquery-ui-timepicker-addon _injectTimePicker
 */
export interface DateTimeCalendarProps {
  kind: PickerKind
  /** the field's value when the picker opens */
  value: string
  /** the new field value (a day picked, a slider moved, the time typed) */
  onChange: (value: string) => void
  options?: Partial<PickerOptions>
  /** `p.note` appended under the calendar of a `.timefield` / `.datefield` */
  note?: string
  /** a day was picked on a date-only picker: the popup closes (inline pickers stay) */
  onClose?: () => void
  /** the grid's cell editor moves #ui-datepicker-div into its edit area (position: relative) */
  inline?: boolean
}

function useCalendarNames() {
  const { gettext, pgettext } = useUiSettings()
  return {
    monthNames: [
      pgettext('Month name', 'January'),
      pgettext('Month name', 'February'),
      pgettext('Month name', 'March'),
      pgettext('Month name', 'April'),
      pgettext('Month name', 'May'),
      pgettext('Month name', 'June'),
      pgettext('Month name', 'July'),
      pgettext('Month name', 'August'),
      pgettext('Month name', 'September'),
      pgettext('Month name', 'October'),
      pgettext('Month name', 'November'),
      pgettext('Month name', 'December'),
    ],
    monthNamesShort: [
      pgettext('Short month name for January', 'Jan'),
      pgettext('Short month name for February', 'Feb'),
      pgettext('Short month name for March', 'Mar'),
      pgettext('Short month name for April', 'Apr'),
      pgettext('Short month name for May', 'May'),
      pgettext('Short month name for June', 'Jun'),
      pgettext('Short month name for July', 'Jul'),
      pgettext('Short month name for August', 'Aug'),
      pgettext('Short month name for September', 'Sep'),
      pgettext('Short month name for October', 'Oct'),
      pgettext('Short month name for November', 'Nov'),
      pgettext('Short month name for December', 'Dec'),
    ],
    dayNames: [
      pgettext('Week day name', 'Sunday'),
      pgettext('Week day name', 'Monday'),
      pgettext('Week day name', 'Tuesday'),
      pgettext('Week day name', 'Wednesday'),
      pgettext('Week day name', 'Thursday'),
      pgettext('Week day name', 'Friday'),
      pgettext('Week day name', 'Saturday'),
    ],
    dayNamesShort: [
      pgettext('Short week day name for Sunday', 'Sun'),
      pgettext('Short week day name for Monday', 'Mon'),
      pgettext('Short week day name for Tuesday', 'Tue'),
      pgettext('Short week day name for Wednesday', 'Wed'),
      pgettext('Short week day name for Thursday', 'Thu'),
      pgettext('Short week day name for Friday', 'Fri'),
      pgettext('Short week day name for Saturday', 'Sat'),
    ],
    dayNamesMin: [
      pgettext('Minimal week day name for Sunday', 'Su'),
      pgettext('Minimal week day name for Monday', 'Mo'),
      pgettext('Minimal week day name for Tuesday', 'Tu'),
      pgettext('Minimal week day name for Wednesday', 'We'),
      pgettext('Minimal week day name for Thursday', 'Th'),
      pgettext('Minimal week day name for Friday', 'Fr'),
      pgettext('Minimal week day name for Saturday', 'Sa'),
    ],
    // showWeek is off: the week header is registered but never drawn
    weekHeader: pgettext('Column header for week of the year in calendar', 'Wk'),
    showMonthAfterYear:
      pgettext('The month-year order in a calendar', 'calendar-month-year') === 'calendar-year-month',
    yearSuffix: (() => {
      const s = pgettext('Year suffix for calendar, "none" is empty', 'none')
      return s !== 'none' ? s : ''
    })(),
    prevText: pgettext('Previous month', 'Prev'),
    nextText: pgettext('Next month', 'Next'),
    timeText: pgettext('A specific point in the day, as shown on a clock', 'Time'),
    hourText: pgettext('Unit of time', 'Hour'),
    minuteText: pgettext('Unit of time', 'Minute'),
    secondText: pgettext('Unit of time', 'Second'),
    millisecText: pgettext('Unit of time', 'Millisecond'),
    microsecText: pgettext('Unit of time', 'Microsecond'),
    // showTimezone and showButtonPanel are off: registered, never drawn
    timezoneText: pgettext('The time zone for a time of day', 'Time zone'),
    closeText: gettext('Done'),
    currentText: gettext('Today'),
  }
}

/** The picker panel (`div.ui-datepicker`): calendar, then the time sliders. */
export function DateTimeCalendar(props: DateTimeCalendarProps) {
  const o: PickerOptions = { ...DEFAULT_PICKER_OPTIONS, ...props.options }
  const names = useCalendarNames()
  const [init] = useState(() => parsePickerValue(props.kind, props.value, new Date()))
  const today = new Date()
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState<PickerTime>(init.time)
  const [view, setView] = useState(() => ({
    year: init.date?.year ?? today.getFullYear(),
    month: init.date?.month ?? today.getMonth(),
  }))
  const [timeText, setTimeText] = useState(() => formatPickerTime(o.timeFormat, init.time))
  const withTime = props.kind !== 'date'
  const timeOnly = props.kind === 'time'

  const emit = (d: typeof date, t: PickerTime) =>
    props.onChange(formatPickerValue(props.kind, { date: d, time: t }, o, new Date()))
  const setUnit = (unit: keyof PickerTime, v: number) => {
    const next = { ...time, [unit]: v }
    setTime(next)
    setTimeText(formatPickerTime(o.timeFormat, next))
    emit(date, next)
  }
  const move = (delta: number) => {
    const m = view.month + delta
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 })
  }
  const grid = calendarGrid(view.year, view.month, o.firstDay)
  const years = Array.from({ length: 21 }, (_, i) => view.year - 10 + i)
  const yearSelect = (
    <select
      className="ui-datepicker-year mx-0.5 rounded border border-border bg-surface px-0.5"
      data-handler="selectYear"
      data-event="change"
      value={view.year}
      onChange={(e) => setView({ ...view, year: Number(e.target.value) })}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  )
  const units: Array<[keyof PickerTime, string, boolean, number]> = [
    ['hour', names.hourText, true, o.hourMax],
    ['minute', names.minuteText, true, 59],
    ['second', names.secondText, true, 59],
    ['millisec', names.millisecText, o.showMillisec, 999],
    ['microsec', names.microsecText, o.showMicrosec, 999],
  ]

  return (
    <div
      id={props.inline ? undefined : 'ui-datepicker-div'}
      className={cn(
        'ui-datepicker ui-widget ui-widget-content ui-helper-clearfix ui-corner-all',
        'w-[19em] rounded border border-border bg-surface p-1 text-xs text-fg shadow-md',
        props.inline && 'relative',
      )}
    >
      {timeOnly ? (
        // the addon's timeOnly header ($.timepicker.regional[''].timeOnlyTitle, not translated by phpMyAdmin)
        <div className="ui-widget-header ui-helper-clearfix ui-corner-all rounded bg-grid-header p-1 text-center font-bold">
          <div className="ui-datepicker-title">Choose Time</div>
        </div>
      ) : (
        <>
          <div className="ui-datepicker-header ui-widget-header ui-helper-clearfix ui-corner-all relative flex items-center rounded bg-grid-header p-1">
            <a
              className="ui-datepicker-prev ui-corner-all cursor-pointer px-1"
              data-handler="prev"
              data-event="click"
              title={names.prevText}
              // biome-ignore lint/a11y/useValidAnchor: jQuery UI's <a data-handler="prev"> has no href
              onClick={() => move(-1)}
              onKeyDown={(e) => e.key === 'Enter' && move(-1)}
            >
              <span className="ui-icon ui-icon-circle-triangle-w">{names.prevText}</span>
            </a>
            <div className="ui-datepicker-title flex-1 text-center font-bold">
              {names.showMonthAfterYear ? (
                <>
                  {yearSelect}
                  {names.yearSuffix}&#xa0;
                  <span className="ui-datepicker-month">{names.monthNames[view.month]}</span>
                </>
              ) : (
                <>
                  <span className="ui-datepicker-month">{names.monthNames[view.month]}</span>&#xa0;
                  {yearSelect}
                  {names.yearSuffix}
                </>
              )}
            </div>
            <a
              className="ui-datepicker-next ui-corner-all cursor-pointer px-1"
              data-handler="next"
              data-event="click"
              title={names.nextText}
              // biome-ignore lint/a11y/useValidAnchor: jQuery UI's <a data-handler="next"> has no href
              onClick={() => move(1)}
              onKeyDown={(e) => e.key === 'Enter' && move(1)}
            >
              <span className="ui-icon ui-icon-circle-triangle-e">{names.nextText}</span>
            </a>
          </div>
          <table className="ui-datepicker-calendar w-full border-collapse text-center">
            <thead>
              <tr>
                {grid.columns.map((c) => (
                  <th key={c.dow} scope="col" className={cn('p-0.5', c.weekEnd && 'ui-datepicker-week-end')}>
                    <span title={names.dayNames[c.dow]}>{names.dayNamesMin[c.dow]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: calendar weeks are positional
                <tr key={r}>
                  {row.map((cell, i) => {
                    const isToday =
                      cell.day !== null &&
                      view.year === today.getFullYear() &&
                      view.month === today.getMonth() &&
                      cell.day === today.getDate()
                    const isCurrent =
                      cell.day !== null &&
                      date !== null &&
                      date.year === view.year &&
                      date.month === view.month &&
                      date.day === cell.day
                    if (cell.day === null)
                      return (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: calendar days are positional
                          key={i}
                          className={cn(
                            cell.weekEnd && 'ui-datepicker-week-end',
                            'ui-datepicker-other-month ui-datepicker-unselectable ui-state-disabled',
                          )}
                        >
                          &#xa0;
                        </td>
                      )
                    const day = cell.day
                    return (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: calendar days are positional
                        key={i}
                        className={cn(
                          'p-px',
                          cell.weekEnd && 'ui-datepicker-week-end',
                          isCurrent && 'ui-datepicker-current-day',
                          isToday && 'ui-datepicker-today',
                        )}
                        data-handler="selectDay"
                        data-event="click"
                        data-month={view.month}
                        data-year={view.year}
                      >
                        {/* biome-ignore lint/a11y/useValidAnchor: jQuery UI's day is an <a href="#"> handled on click */}
                        <a
                          className={cn(
                            'ui-state-default block rounded border border-border px-1 py-0.5 text-right no-underline',
                            isToday && 'ui-state-highlight bg-warning-bg',
                            isCurrent && 'ui-state-active bg-accent text-accent-fg',
                          )}
                          href="#"
                          data-date={day}
                          onClick={(e) => {
                            e.preventDefault()
                            const d = { year: view.year, month: view.month, day }
                            setDate(d)
                            emit(d, time)
                            if (!withTime) props.onClose?.()
                          }}
                        >
                          {day}
                        </a>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {withTime && (
        <div className="ui-timepicker-div">
          <dl className="m-0 grid grid-cols-[6em_1fr] items-center gap-x-2 gap-y-1 p-1">
            <dt className="ui_tpicker_time_label">{names.timeText}</dt>
            <dd className="ui_tpicker_time m-0">
              <input
                className="ui_tpicker_time_input w-full rounded border border-border bg-surface px-1"
                aria-label={names.timeText}
                value={timeText}
                onChange={(e) => {
                  setTimeText(e.target.value)
                  // the addon parses the typed time with timeFormat; an unparsable text changes nothing
                  if (/^\d{1,3}:\d{1,2}(:\d{1,2})?(\.\d{1,6})?$/.test(e.target.value.trim())) {
                    const t = parsePickerValue('time', e.target.value, new Date()).time
                    setTime(t)
                    emit(date, t)
                  }
                }}
              />
            </dd>
            {units
              .filter(([, , show]) => show)
              .map(([unit, label, , max]) => (
                <Fragment key={unit}>
                  <dt className={`ui_tpicker_${unit}_label`}>{label}</dt>
                  <dd className={`ui_tpicker_${unit} m-0`}>
                    <Slider
                      className={`ui_tpicker_${unit}_slider`}
                      label={label}
                      value={time[unit]}
                      max={max}
                      onChange={(v) => setUnit(unit, v)}
                    />
                  </dd>
                </Fragment>
              ))}
          </dl>
        </div>
      )}
      {props.note !== undefined && <p className="note m-1 text-fg-muted">{props.note}</p>}
    </div>
  )
}

/** A jQuery UI slider (`div.ui-slider` with its `span.ui-slider-handle`), mouse and keyboard. */
function Slider(props: {
  className: string
  label: string
  value: number
  max: number
  onChange: (v: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const clamp = (v: number) => Math.max(0, Math.min(props.max, Math.round(v)))
  const fromPointer = (e: PointerEvent) => {
    const r = track.current?.getBoundingClientRect()
    if (r === undefined || r.width === 0) return
    props.onChange(clamp(((e.clientX - r.left) / r.width) * props.max))
  }
  // jquery-ui slider _handleEvents: arrows step 1, PageUp/PageDown a fifth, Home/End the ends
  const key = (e: KeyboardEvent) => {
    const page = Math.max(1, Math.round(props.max / 5))
    const next: Record<string, number> = {
      ArrowRight: props.value + 1,
      ArrowUp: props.value + 1,
      ArrowLeft: props.value - 1,
      ArrowDown: props.value - 1,
      PageUp: props.value + page,
      PageDown: props.value - page,
      Home: 0,
      End: props.max,
    }
    const v = next[e.key]
    if (v === undefined) return
    e.preventDefault()
    props.onChange(clamp(v))
  }
  return (
    <div
      ref={track}
      className={cn(
        props.className,
        'ui-slider ui-corner-all ui-slider-horizontal ui-widget ui-widget-content',
        'relative mx-1.5 h-2 cursor-pointer rounded border border-border bg-grid-odd',
      )}
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        fromPointer(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) fromPointer(e)
      }}
    >
      <span
        tabIndex={0}
        role="slider"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
        className="ui-slider-handle ui-corner-all ui-state-default absolute -top-1 h-3.5 w-2.5 -translate-x-1/2 rounded border border-border bg-surface"
        style={{ left: `${props.max === 0 ? 0 : (props.value / props.max) * 100}%` }}
        onKeyDown={key}
      />
    </div>
  )
}

/**
 * `showOn: 'button'`: the calendar trigger after the field (phpMyAdmin's b_calendar image), the
 * picker below it. The field keeps its own input; the picker reads its value when it opens.
 */
export function DateTimeTrigger(
  props: Omit<DateTimeCalendarProps, 'onClose' | 'inline'> & {
    /** the trigger's title (strMysqlAllowedValuesTipDate / …Time, the field's tooltip) */
    title?: string
    disabled?: boolean
  },
) {
  const [open, setOpen] = useState(false)
  const { title, disabled, ...rest } = props
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ui-datepicker-trigger inline-flex shrink-0 cursor-pointer items-center p-0.5"
          title={title}
          aria-label={title ?? '…'}
          disabled={disabled}
        >
          <PmaIcon name="b_calendar" alt="" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto border-0 bg-transparent p-0 shadow-none">
        {open && <DateTimeCalendar {...rest} onClose={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}
