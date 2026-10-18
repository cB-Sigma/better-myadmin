import {
  type KeyboardEvent,
  type Ref,
  Suspense,
  lazy,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { SqlEditorHandle, SqlEditorProps } from './types'

// CodeMirror is a lazy chunk (docs/architecture/08-performance-and-snappiness.md)
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'))

/** Time of the last pointer or key input of the user (capture phase, before any handler). */
let lastUserInput = Number.NEGATIVE_INFINITY
if (typeof window !== 'undefined') {
  const mark = (e: Event) => {
    if (e.isTrusted) lastUserInput = performance.now()
  }
  window.addEventListener('pointerdown', mark, true)
  window.addEventListener('keydown', mark, true)
}

/**
 * The SQL editor: CodeMirror when $cfg['CodemirrorEnable'], else (and while CodeMirror loads) the
 * plain textarea, which keeps the same keys (Ctrl/Alt+Enter) and the TextareaAutoSelect behaviour.
 */
export function SqlEditor(props: SqlEditorProps & { handleRef: Ref<SqlEditorHandle> }) {
  // what was typed while the CodeMirror chunk loads carries over
  const [typed, setTyped] = useState(props.initialValue)
  // autoFocus: when the editor started loading, and whether the user is typing into the fallback
  const startedAt = useRef(performance.now())
  const plainFocused = useRef(false)
  const focusOnLoad = () =>
    props.autoFocus === true && (plainFocused.current || lastUserInput < startedAt.current)
  const fallback = (
    <PlainEditor
      {...props}
      initialValue={typed}
      focusOnLoad={focusOnLoad}
      onFocusChange={(f) => {
        plainFocused.current = f
      }}
      onChange={(v) => {
        setTyped(v)
        props.onChange?.(v)
      }}
    />
  )
  if (!props.codemirror) return fallback
  return (
    <Suspense fallback={fallback}>
      <CodeMirrorEditor {...props} initialValue={typed} focusOnLoad={focusOnLoad} />
    </Suspense>
  )
}

/** The textarea path (`window.CodeMirror` undefined in phpMyAdmin). */
export function PlainEditor(
  props: SqlEditorProps & { handleRef: Ref<SqlEditorHandle>; onFocusChange?: (focused: boolean) => void },
) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const clean = useRef(props.initialValue)
  const selectedOnce = useRef(false)
  // the textarea path focuses the box too ($elm.trigger('focus')); while CodeMirror loads it is the
  // fallback, which only takes the focus with CodemirrorEnable off
  const focusOnLoad = useRef(props.focusOnLoad)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    if (!props.codemirror && focusOnLoad.current?.() === true) ta.current?.focus()
  }, [])

  useImperativeHandle(
    props.handleRef,
    (): SqlEditorHandle => ({
      getValue: () => ta.current?.value ?? '',
      setValue: (v) => {
        if (ta.current === null) return
        ta.current.value = v
        props.onChange?.(v)
      },
      replaceSelection: (text) => {
        const el = ta.current
        if (el === null) return
        const { selectionStart: s, selectionEnd: e, value } = el
        el.value = value.substring(0, s) + text + value.substring(e, value.length)
        el.selectionStart = el.selectionEnd = s + text.length
        props.onChange?.(el.value)
      },
      focus: () => ta.current?.focus(),
      isDirty: () => (ta.current?.value ?? '') !== clean.current,
      markClean: () => {
        clean.current = ta.current?.value ?? ''
      },
      cursorOnFirstLine: () =>
        !(ta.current?.value ?? '').slice(0, ta.current?.selectionStart ?? 0).includes('\n'),
      cursorOnLastLine: () => !(ta.current?.value ?? '').slice(ta.current?.selectionEnd ?? 0).includes('\n'),
    }),
    [props.onChange],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    for (const k of props.keys ?? []) {
      if (matches(k.key, e) && k.run()) {
        e.preventDefault()
        return
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.altKey) && props.onSubmit !== undefined) {
      e.preventDefault()
      props.onSubmit()
    }
  }

  return (
    <textarea
      ref={ta}
      id={props.id}
      aria-label={props.ariaLabel}
      data-testid="sql-editor"
      className={`input font-mono ${props.className ?? ''}`}
      rows={props.rows}
      cols={props.cols}
      spellCheck={false}
      defaultValue={props.initialValue}
      onChange={(e) => props.onChange?.(e.target.value)}
      onFocus={() => props.onFocusChange?.(true)}
      onBlur={() => {
        props.onFocusChange?.(false)
        props.onBlur?.()
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // selectContent: only once, and only with $cfg['TextareaAutoSelect']
        if (props.autoSelect === true && !selectedOnce.current) {
          selectedOnce.current = true
          e.currentTarget.select()
        }
      }}
      style={props.height !== undefined ? { height: props.height } : undefined}
    />
  )
}

/** CodeMirror-style key names ("Ctrl-l", "Shift-Enter", "ArrowUp") against a DOM event. */
function matches(key: string, e: KeyboardEvent): boolean {
  const parts = key.split('-')
  const name = parts.pop() ?? ''
  const want = new Set(parts.map((p) => p.toLowerCase()))
  if (want.has('ctrl') !== e.ctrlKey || want.has('shift') !== e.shiftKey || want.has('alt') !== e.altKey)
    return false
  return e.key.toLowerCase() === name.toLowerCase()
}
