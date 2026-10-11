/**
 * phpMyAdmin's keyboard shortcuts as a pure state machine (unit-tested); the hook in
 * useShortcuts.ts wires it to `document` and performs the actions.
 * pma: resources/js/shortcuts_handler.ts
 */

export type ShortcutAction =
  | 'console-toggle'
  | 'navigation-settings'
  | 'db-structure'
  | 'table-structure'
  | 'db-search'
  | 'table-search'
  | 'export'
  | 'home'
  | 'back'
  | 'help'

export interface KeyInfo {
  keyCode: number
  ctrlKey: boolean
  altKey: boolean
  shiftKey?: boolean
  /** e.target.nodeName */
  targetTag: string
  /** e.target is contenteditable */
  contentEditable: boolean
}

export interface PageInfo {
  /** CommonParams db / table */
  db: string
  table: string
  /** phpMyAdmin: `#modalOverlay` (session expired); BetterMyAdmin also pauses while a dialog is open */
  blocked: boolean
}

const KEY = { D: 68, T: 84, K: 75, S: 83, F: 70, E: 69, H: 72, C: 67, BACKSPACE: 8, SLASH: 191 } as const

/** The two-key chords (`D`/`T` then a letter) stay armed 2 s after the first key is released. */
export const CHORD_MS = 2000

const isField = (k: KeyInfo) =>
  k.targetTag === 'INPUT' || k.targetTag === 'TEXTAREA' || k.targetTag === 'SELECT'

export class ShortcutMachine {
  databaseOp = false
  tableOp = false
  readonly #schedule: (fn: () => void, ms: number) => void

  constructor(schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)) {
    this.#schedule = schedule
  }

  /** `$(document).on('keyup')`: releasing D or T disarms its chord after 2 s. */
  keyup(k: KeyInfo): void {
    if (k.contentEditable || isField(k)) return
    if (k.keyCode === KEY.D) {
      this.#schedule(() => {
        this.databaseOp = false
      }, CHORD_MS)
    } else if (k.keyCode === KEY.T) {
      this.#schedule(() => {
        this.tableOp = false
      }, CHORD_MS)
    }
  }

  /**
   * `$(document).on('keydown')`. Returns the actions in the order phpMyAdmin performs them; note
   * that Ctrl+K outside form fields toggles the console twice (once for Ctrl+K, once for K —
   * quirk Q45), and single letters fire whatever modifier is held, exactly like phpMyAdmin.
   */
  keydown(k: KeyInfo, page: PageInfo): { actions: ShortcutAction[]; preventDefault: boolean } {
    const actions: ShortcutAction[] = []
    let preventDefault = false
    if (k.contentEditable || page.blocked) return { actions, preventDefault }
    if (k.ctrlKey && k.altKey && k.keyCode === KEY.C) actions.push('console-toggle')
    if (k.ctrlKey && k.keyCode === KEY.K) {
      preventDefault = true
      actions.push('console-toggle')
    }
    if (isField(k)) return { actions, preventDefault }

    const isDb = page.db !== ''
    const isTable = page.table !== ''
    switch (k.keyCode) {
      case KEY.D:
        this.databaseOp = true
        break
      case KEY.K:
        preventDefault = true
        actions.push('console-toggle')
        break
      case KEY.S:
        if (this.databaseOp) {
          if (isDb && !isTable) actions.push('db-structure')
        } else if (this.tableOp) {
          if (isDb && isTable) actions.push('table-structure')
        } else {
          actions.push('navigation-settings')
        }
        break
      case KEY.F:
        if (this.databaseOp) {
          if (isDb && !isTable) actions.push('db-search')
        } else if (this.tableOp) {
          if (isDb && isTable) actions.push('table-search')
        }
        break
      case KEY.T:
        this.tableOp = true
        break
      case KEY.E:
        actions.push('export')
        break
      case KEY.BACKSPACE:
        actions.push('back')
        break
      case KEY.H:
        actions.push('home')
        break
      case KEY.SLASH:
        // BetterMyAdmin addition: `?` opens the shortcut list (phpMyAdmin has none)
        if (k.shiftKey === true && !k.ctrlKey && !k.altKey) actions.push('help')
        break
    }
    return { actions, preventDefault }
  }
}

/** The help overlay: phpMyAdmin's shortcuts (docs/features/01 "Keyboard shortcuts table"). */
export const SHORTCUT_HELP: Array<{ keys: string; scope: string; action: string }> = [
  { keys: 'Ctrl+Alt+C', scope: 'anywhere', action: 'Toggle the console' },
  { keys: 'Ctrl+K', scope: 'anywhere', action: 'Toggle the console' },
  { keys: 'K', scope: 'outside form fields', action: 'Toggle the console' },
  { keys: 'S', scope: 'outside form fields', action: 'Navigation panel settings' },
  { keys: 'D then S', scope: 'database selected', action: 'Database structure' },
  { keys: 'T then S', scope: 'table selected', action: 'Table structure' },
  { keys: 'D then F', scope: 'database selected', action: 'Search the database' },
  { keys: 'T then F', scope: 'table selected', action: 'Search the table' },
  { keys: 'E', scope: 'outside form fields', action: 'Export' },
  { keys: 'H', scope: 'outside form fields', action: 'Home' },
  { keys: 'Backspace', scope: 'outside form fields', action: 'Back' },
  { keys: 'Ctrl+Enter / Alt+Enter', scope: 'in a form field', action: 'Submit the form' },
  { keys: 'Ctrl+←/↑/→/↓', scope: 'column definition and insert forms', action: 'Move between fields' },
  { keys: 'Ctrl+Space', scope: 'SQL editors', action: 'Autocomplete' },
  { keys: '?', scope: 'outside form fields', action: 'Show this list' },
  { keys: 'Esc', scope: 'dialogs', action: 'Close the dialog' },
]
