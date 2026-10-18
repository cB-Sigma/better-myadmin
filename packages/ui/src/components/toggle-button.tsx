import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * phpMyAdmin's sliding ON / OFF switch (`div.toggleButton` with its `toggle-container`): both
 * labels are in the switch, which shows the current one next to the knob and slides on click. The
 * two parts get the width of the wider label, as functions.ts toggleButton() sizes them.
 * pma: resources/templates/database/tracking/tables.twig, events/index.twig (toggleAjax),
 *      resources/js/modules/functions.ts::toggleButton, themes/pmahomme/scss/_common.scss
 */
export function ToggleButton({
  on,
  onLabel,
  offLabel,
  title,
  disabled = false,
  onToggle,
}: {
  on: boolean
  onLabel: string
  offLabel: string
  /** "Click to toggle" */
  title: string
  /** a toggle in progress (`isActive`): clicks are ignored */
  disabled?: boolean
  onToggle: () => void
}) {
  // both parts are as wide as the wider label (functions.ts: Math.max(on, off) + 2): each holds
  // the two labels in one grid cell, the other one invisible; the switch slides by that width
  const partRef = useRef<HTMLSpanElement>(null)
  const [part, setPart] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when a label changes
  useLayoutEffect(() => {
    setPart((partRef.current?.offsetWidth ?? 0) + 2)
  }, [onLabel, offLabel])
  const knob = 22
  const label = (shown: string, other: string) => (
    <>
      <span className="col-start-1 row-start-1">{shown}</span>
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {other}
      </span>
    </>
  )
  return (
    <div className="wrapper toggleAjax inline-block">
      <div
        className="toggleButton relative inline-block h-[1.55em] cursor-pointer overflow-hidden rounded-[0.3em] border-x border-border-strong text-center text-[0.8em] leading-[1.4em]"
        style={{ width: part + knob }}
      >
        <div
          role="switch"
          aria-checked={on}
          tabIndex={0}
          title={title}
          className={cn(
            'toggle-container absolute top-0 flex transition-[left] duration-200',
            on ? 'on' : 'off',
          )}
          style={{ left: on ? 0 : -part }}
          onClick={() => !disabled && onToggle()}
          onKeyDown={(e) => {
            if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              onToggle()
            }
          }}
        >
          <span
            ref={partRef}
            className="toggleOn inline-grid shrink-0 justify-center bg-success px-[1em] text-white [text-shadow:0_0_0.2em_#000]"
            style={{ minWidth: part }}
          >
            {label(onLabel, offLabel)}
          </span>
          <span
            aria-hidden
            className="inline-block h-[1.55em] shrink-0 rounded-[0.3em] border border-border-strong bg-gradient-to-b from-bg to-bg-inset"
            style={{ width: knob }}
          />
          <span
            className="toggleOff inline-grid shrink-0 justify-center bg-bg-inset px-[1em] text-fg"
            style={{ minWidth: part }}
          >
            {label(offLabel, onLabel)}
          </span>
        </div>
      </div>
    </div>
  )
}
