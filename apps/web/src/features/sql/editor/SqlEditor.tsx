import { type KeyboardEvent, type Ref, Suspense, lazy, useImperativeHandle, useRef, useState } from 'react'
import type { SqlEditorHandle, SqlEditorProps } from './types'

// CodeMirror is a lazy chunk (docs/architecture/08-performance-and-snappiness.md)
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'))

/**
 * The SQL editor: CodeMirror when $cfg['CodemirrorEnable'], else (and while CodeMirror loads) the
 * plain textarea, which keeps the same keys (Ctrl/Alt+Enter) and the TextareaAutoSelect behaviour.
 */
export function SqlEditor(props: SqlEditorProps & { handleRef: Ref<SqlEditorHandle> }) {
  // what was typed while the CodeMirror chunk loads carries over
  const [typed, setTyped] = useState(props.initialValue)
  const fallback = (
    <PlainEditor
      {...props}
      initialValue={typed}
      onChange={(v) => {
        setTyped(v)
        props.onChange?.(v)
      }}
    />
  )
  if (!props.codemirror) return fallback
  return (
    <Suspense fallback={fallback}>
      <CodeMirrorEditor {...props} initialValue={typed} />
    </Suspense>
  )
}

/** The textarea path (`window.CodeMirror` undefined in phpMyAdmin). */
export function PlainEditor(props: SqlEditorProps & { handleRef: Ref<SqlEditorHandle> }) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const clean = useRef(props.initialValue)
  const selectedOnce = useRef(false)

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
      onBlur={() => props.onBlur?.()}
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
