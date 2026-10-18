import type { AutocompleteResponse, SqlFormResponse } from '@bettermyadmin/contracts'

/** Imperative API of the SQL editors (CodeMirror or the plain textarea). */
export interface SqlEditorHandle {
  getValue(): string
  setValue(value: string): void
  /** CodeMirror replaceSelection / textarea selectionStart..End */
  replaceSelection(text: string): void
  focus(): void
  /** Whether the content differs from the last markClean() (the page lock, CodeMirror isClean()). */
  isDirty(): boolean
  markClean(): void
  /** True on the first / last line (the console's history navigation). */
  cursorOnFirstLine(): boolean
  cursorOnLastLine(): boolean
}

/** A key handled before CodeMirror's defaults; return true when handled. */
export interface EditorKey {
  key: string
  run: () => boolean
}

export interface SqlEditorProps {
  id?: string
  ariaLabel: string
  initialValue: string
  onChange?: (value: string) => void
  onBlur?: () => void
  /** Ctrl+Enter / Alt+Enter (getKeyboardFormSubmitEventHandler) */
  onSubmit?: () => void
  /** Extra keys (console: Enter executes, Ctrl+L, Ctrl+U, history arrows). */
  keys?: EditorKey[]
  /** TextareaRows: visible lines. */
  rows: number
  cols?: number
  /** $cfg['CodemirrorEnable'] */
  codemirror: boolean
  /** Lint gutter ($cfg['LintEnable']) with the connected server's parser context. */
  lint: { server: SqlFormResponse['server']; editorType?: 'event' | 'routine' | 'trigger' } | null
  /** Tables/columns of the current database and the current table (EnableAutocompleteForTablesAndColumns). */
  autocomplete: { tables: AutocompleteResponse['tables']; defaultTable: string } | null
  /**
   * Focus the editor once it is loaded (pma: onloadCodeMirrorEditor's `codeMirrorEditor.focus()` for
   * the SQL box, the inline editor's `codeMirrorInlineEditor.focus()`). Skipped when the user acted
   * (pointer or key) after the editor started loading: the CodeMirror chunk loads lazily and must
   * not take the focus away from what the user did meanwhile.
   */
  autoFocus?: boolean
  /** Internal (SqlEditor → CodeMirrorEditor): whether the loaded editor should take the focus. */
  focusOnLoad?: () => boolean
  /** $cfg['TextareaAutoSelect']: the plain textarea selects its content on the first click. */
  autoSelect?: boolean
  /** Console dark theme. */
  dark?: boolean
  /** Fixed height in px (console); otherwise derived from rows and resizable vertically. */
  height?: number
  className?: string
}
