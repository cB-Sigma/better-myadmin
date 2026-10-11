import { sanitizeToFragment } from '@bettermyadmin/ui'
import { autocompletion, completionKeymap, startCompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { MySQL, sql } from '@codemirror/lang-sql'
import { bracketMatching, defaultHighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { type Diagnostic, lintGutter, linter } from '@codemirror/lint'
import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'
import { t } from '../../../lib/i18n'
import { lintInWorker } from './lintClient'
import type { SqlEditorHandle, SqlEditorProps } from './types'

/** Offset in the document of (line, column in code points), clamped to the line. */
function posOf(view: EditorView, line: number, column: number): number {
  const doc = view.state.doc
  const l = doc.line(Math.min(Math.max(line + 1, 1), doc.lines))
  const chars = Array.from(l.text)
  return l.from + chars.slice(0, Math.min(column, chars.length)).join('').length
}

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'var(--bg)', color: 'var(--fg)', height: '100%' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.45',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-subtle)',
    color: 'var(--fg-subtle)',
    borderRight: '1px solid var(--border)',
  },
  '&.cm-focused': { outline: '2px solid var(--focus-ring)', outlineOffset: '-2px' },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    marginLeft: '1em',
    fontStyle: 'normal',
    color: 'var(--fg-subtle)',
  },
})

const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--console-dark-bg)', color: 'var(--console-dark-fg)' },
    '.cm-content': { caretColor: 'var(--console-dark-fg)' },
    '.ͼb, .tok-keyword': { color: 'var(--console-dark-keyword)' },
  },
  { dark: true },
)

/**
 * The CodeMirror 6 SQL editor with phpMyAdmin's options: line numbers, bracket matching, MySQL mode,
 * 4-space indent, line wrapping, Ctrl-Space autocomplete, lint gutter, Ctrl/Alt+Enter submit.
 * pma: resources/js/modules/functions.ts::getSqlEditor
 */
export default function CodeMirrorEditor(props: SqlEditorProps & { handleRef?: Ref<SqlEditorHandle> }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const cleanDoc = useRef(props.initialValue)
  const latest = useRef(props)
  latest.current = props
  const languageConf = useRef(new Compartment())
  const lintConf = useRef(new Compartment())
  const keysConf = useRef(new Compartment())

  useImperativeHandle(
    props.handleRef,
    (): SqlEditorHandle => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (value) => {
        const v = viewRef.current
        if (v === null) return
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: value },
          selection: { anchor: value.length },
        })
      },
      replaceSelection: (text) => {
        const v = viewRef.current
        if (v === null) return
        v.dispatch(v.state.replaceSelection(text))
      },
      focus: () => viewRef.current?.focus(),
      isDirty: () => (viewRef.current?.state.doc.toString() ?? '') !== cleanDoc.current,
      markClean: () => {
        cleanDoc.current = viewRef.current?.state.doc.toString() ?? ''
      },
      cursorOnFirstLine: () => {
        const v = viewRef.current
        return v === null || v.state.doc.lineAt(v.state.selection.main.head).number === 1
      },
      cursorOnLastLine: () => {
        const v = viewRef.current
        return v === null || v.state.doc.lineAt(v.state.selection.main.head).number === v.state.doc.lines
      },
    }),
    [],
  )

  // the view is created once; later props flow through refs and compartments
  useEffect(() => {
    if (host.current === null) return
    const submit = () => {
      const onSubmit = latest.current.onSubmit
      if (onSubmit === undefined) return false
      onSubmit()
      return true
    }
    const submitKeys = Prec.highest(
      keymap.of([
        // getKeyboardFormSubmitEventHandler: Ctrl+Enter or Alt+Enter clicks the form's submit button
        { key: 'Ctrl-Enter', run: submit },
        { key: 'Alt-Enter', run: submit },
        { key: 'Ctrl-Space', run: startCompletion },
      ]),
    )
    const extensions: Extension[] = [
      keysConf.current.of(customKeys(latest)),
      submitKeys,
      lineNumbers(),
      history(),
      bracketMatching(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      languageConf.current.of(languageFor(latest.current.autocomplete)),
      // completeSingle: false — a single candidate is never inserted on its own
      autocompletion({ activateOnTyping: true, defaultKeymap: true }),
      lintConf.current.of(lintFor(latest.current.lint)),
      keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      theme,
      ...(latest.current.dark === true ? [darkTheme] : []),
      EditorView.contentAttributes.of({ 'aria-label': latest.current.ariaLabel }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange?.(u.state.doc.toString())
        if (u.focusChanged && !u.view.hasFocus) latest.current.onBlur?.()
      }),
    ]
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: latest.current.initialValue, extensions }),
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // autocomplete data arrives after the first load
  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageConf.current.reconfigure(languageFor(props.autocomplete)) })
  }, [props.autocomplete])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: lintConf.current.reconfigure(lintFor(props.lint)) })
  }, [props.lint])

  // the console's keys change with its options (Enter executes)
  const keySignature = (props.keys ?? []).map((k) => k.key).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconfigure when the set of keys changes
  useEffect(() => {
    viewRef.current?.dispatch({ effects: keysConf.current.reconfigure(customKeys(latest)) })
  }, [keySignature])

  const height = props.height !== undefined ? `${props.height}px` : `${Math.max(props.rows, 3) * 19 + 8}px`
  return (
    <div
      ref={host}
      id={props.id}
      data-testid="sql-editor"
      className={`overflow-hidden rounded border border-border ${props.className ?? ''}`}
      style={{ height, resize: props.height === undefined ? 'vertical' : 'none', minHeight: '3em' }}
    />
  )
}

/** The caller's keys, run through the latest props. */
function customKeys(latest: { current: SqlEditorProps }): Extension {
  return Prec.highest(
    keymap.of(
      (latest.current.keys ?? []).map((k) => ({
        key: k.key,
        run: () => latest.current.keys?.find((x) => x.key === k.key)?.run() ?? false,
      })),
    ),
  )
}

function languageFor(ac: SqlEditorProps['autocomplete']): Extension {
  const schema: Record<string, Array<{ label: string; detail: string; type: string }>> = {}
  for (const [table, columns] of Object.entries(ac?.tables ?? {})) {
    schema[table] = columns.map((c) => ({ label: c.field, detail: c.columnHint, type: 'property' }))
  }
  return sql({
    dialect: MySQL,
    schema,
    ...(ac !== null && ac.defaultTable !== '' && schema[ac.defaultTable] !== undefined
      ? { defaultTable: ac.defaultTable }
      : {}),
    upperCaseKeywords: true,
  })
}

function lintFor(cfg: SqlEditorProps['lint']): Extension {
  if (cfg === null) return []
  return [
    lintGutter(),
    linter(
      async (view): Promise<Diagnostic[]> => {
        const text = view.state.doc.toString()
        // Skipping check if text box is empty.
        if (text.trim() === '') return []
        const lints = await lintInWorker({
          sql: text,
          editorType: cfg.editorType,
          server: cfg.server,
          // LINT_MSGIDS (literal here so the editor chunk does not load the parser)
          messages: {
            near: t('%1$s (near <code>%2$s</code>)'),
            tooLong: t('Linting is disabled for this query because it exceeds the maximum length.'),
          },
        })
        if (view.state.doc.toString() !== text) return []
        return lints.map((l) => {
          const from = posOf(view, l.fromLine, l.fromColumn)
          const to = Math.max(from, posOf(view, l.toLine, l.toColumn))
          return {
            from,
            to,
            severity: l.severity,
            message: l.message.replace(/<[^>]+>/g, ''),
            // messageHTML: the linter escapes the message and wraps the token in <code>
            renderMessage: () => {
              const span = document.createElement('span')
              span.append(sanitizeToFragment(l.message))
              return span
            },
          }
        })
      },
      { delay: 300 },
    ),
  ]
}
