import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@bettermyadmin/ui'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { SHORTCUT_HELP, type ShortcutAction, ShortcutMachine } from './shortcuts.ts'

/** Window events other shell parts listen to (the console and the navigation panel are separate features). */
export const CONSOLE_TOGGLE_EVENT = 'bma:console-toggle'
export const NAVIGATION_SETTINGS_EVENT = 'bma:navigation-settings'

/** Clicks the first element matching `selector` the way jQuery's trigger('click') on the icon does. */
function clickFirst(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector)
  if (el === null) return false
  ;(el.closest<HTMLElement>('a, button') ?? el).click()
  return true
}

const dialogOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

/**
 * The global shortcut layer (loaded unless `$cfg['DisableShortcutKeys']`), plus phpMyAdmin's
 * Ctrl+Enter / Alt+Enter form submit inside any form field.
 * pma: resources/js/shortcuts_handler.ts, modules/functions.ts::getKeyboardFormSubmitEventHandler
 */
export function ShortcutLayer({
  server,
  db,
  table,
  disabled,
}: {
  server: number
  db: string
  table: string
  disabled: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const [help, setHelp] = useState(false)
  const machine = useRef(new ShortcutMachine())
  const page = useRef({ db, table })
  page.current = { db, table }

  useEffect(() => {
    const perform = (a: ShortcutAction) => {
      switch (a) {
        case 'console-toggle':
          window.dispatchEvent(new CustomEvent(CONSOLE_TOGGLE_EVENT))
          break
        case 'navigation-settings':
          if (!clickFirst('#pma_navigation_settings_icon'))
            window.dispatchEvent(new CustomEvent(NAVIGATION_SETTINGS_EVENT))
          break
        case 'db-structure':
        case 'table-structure':
          clickFirst('.tab-link .ic_b_props')
          break
        case 'db-search':
        case 'table-search':
          clickFirst('.tab-link .ic_b_search')
          break
        case 'export':
          clickFirst('.ic_b_export')
          break
        case 'home':
          if (!clickFirst('.ic_b_home')) void navigate({ to: '/s/$server', params: { server } })
          break
        case 'back':
          router.history.back()
          break
        case 'help':
          setHelp(true)
          break
      }
    }
    const info = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      // phpMyAdmin's CodeMirror 5 editors type into a hidden <textarea>: CodeMirror 6's
      // contenteditable counts as that textarea (Ctrl+K and Ctrl+Alt+C still toggle the console)
      const inEditor = t?.closest?.('.cm-editor') != null
      return {
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        targetTag: inEditor ? 'TEXTAREA' : (t?.nodeName ?? ''),
        contentEditable: !inEditor && t?.isContentEditable === true,
      }
    }
    const onDown = (e: KeyboardEvent) => {
      // Ctrl+Enter / Alt+Enter submits the field's form (independent of DisableShortcutKeys)
      const t = e.target as HTMLElement | null
      if (
        !e.defaultPrevented &&
        e.key === 'Enter' &&
        (e.ctrlKey || e.altKey) &&
        t !== null &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(t.nodeName)
      ) {
        const form = (t as HTMLInputElement).form
        if (form) {
          e.preventDefault()
          const submit = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"]')
          if (submit !== null) submit.click()
          else form.requestSubmit()
          return
        }
      }
      if (disabled) return
      const r = machine.current.keydown(info(e), { ...page.current, blocked: dialogOpen() })
      if (r.preventDefault) e.preventDefault()
      for (const a of r.actions) {
        if (a === 'back') e.preventDefault()
        perform(a)
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (!disabled) machine.current.keyup(info(e))
    }
    document.addEventListener('keydown', onDown)
    document.addEventListener('keyup', onUp)
    return () => {
      document.removeEventListener('keydown', onDown)
      document.removeEventListener('keyup', onUp)
    }
  }, [disabled, navigate, router, server])

  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent size="md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <table className="w-full text-[13px]">
            <tbody>
              {SHORTCUT_HELP.map((s) => (
                <tr key={s.keys + s.action} className="border-b border-border last:border-0">
                  <td className="py-1 pr-3 whitespace-nowrap">
                    <kbd className="rounded border border-border-strong bg-bg-subtle px-1 font-mono text-xs">
                      {s.keys}
                    </kbd>
                  </td>
                  <td className="py-1 pr-3">{s.action}</td>
                  <td className="py-1 text-fg-muted">{s.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
