import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PmaIcon,
} from '@bettermyadmin/ui'
import { useBlocker } from '@tanstack/react-router'
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react'
import { t } from '../../lib/i18n'

/**
 * Page-level chrome a page can opt into: the "Page-related settings" gear (pages register their
 * PageSettings form with features/preferences/PageSettings.tsx usePagePrefs) and the lock icon of `lock-page`
 * forms with the unsaved-changes confirmation.
 * pma: src/Config/PageSettings.php, resources/js/modules/page_settings.ts, modules/ajax.ts (lockPageHandler)
 */

export interface PageSettingsRegistration {
  /** PageFormList group: Browse, DbStructure, Edit, Export, Import, Navi, Sql, TableStructure */
  group: string
  /** The form; it should submit itself when `apply` is called */
  render: () => ReactNode
  /** Submits the form; `false` keeps the modal open (the form shows its errors) */
  apply: () => unknown
}

interface Chrome {
  settings: PageSettingsRegistration | null
  setSettings: (s: PageSettingsRegistration | null) => void
  locked: number
  setLocked: (fn: (n: number) => number) => void
}

const Ctx = createContext<Chrome | null>(null)

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PageSettingsRegistration | null>(null)
  const [locked, setLocked] = useState(0)
  const value = useMemo(() => ({ settings, setSettings, locked, setLocked }), [settings, locked])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useChrome(): Chrome {
  const c = useContext(Ctx)
  if (c === null) throw new Error('PageChromeProvider missing')
  return c
}

/** `PageSettings::init(group)` for the mounted page. */
export function usePageSettings(reg: PageSettingsRegistration | null): void {
  const { setSettings } = useChrome()
  useEffect(() => {
    setSettings(reg)
    return () => setSettings(null)
  }, [reg, setSettings])
}

/** A `lock-page` form: shows the lock icon while dirty and asks before navigating away. */
export function useLockPage(dirty: boolean): void {
  const { setLocked } = useChrome()
  useEffect(() => {
    if (!dirty) return
    setLocked((n) => n + 1)
    return () => setLocked((n) => n - 1)
  }, [dirty, setLocked])
  // Messages.strConfirmNavigation
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm(t('You have unsaved changes; are you sure you want to leave this page?')),
    disabled: !dirty,
    // the confirmation is for leaving through the page's links (AJAX.requestHandler), not for
    // closing or reloading the window
    enableBeforeUnload: false,
  })
}

// (an <input> without a type attribute is a text input too)
const LOCK_FIELDS =
  'textarea, input[type="text"], input:not([type]), input[type="number"], select, input[type="checkbox"], input[type="radio"]'

type LockField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function lockValue(el: LockField): string {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
    ? String(el.checked)
    : el.value
}

/**
 * A `form.lock-page`: a field whose committed value (its `change` event) differs from the value it
 * had is a locked target; while there is one the lock icon shows and leaving asks first. Checkbox
 * changes do not lock, a reset or a submit of the form releases the lock. `editorDirty` is the
 * CodeMirror lock (the query editor is not clean). Returns the form's ref.
 * pma: resources/js/modules/ajax.ts (lockPageHandler, resetLock, the form.lock-page keyup / change /
 *      reset handlers), functions.ts::onloadLockPage (lock-id, val-hash)
 */
export function useFormLock(editorDirty = false): (form: HTMLFormElement | null) => void {
  const [form, setForm] = useState<HTMLFormElement | null>(null)
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (form === null) return
    // val-hash: the value a field had before the user touched it
    const initial = new WeakMap<Element, string>()
    const targets = new Set<Element>()
    const field = (t: EventTarget | null): LockField | null =>
      t instanceof Element && t.matches(LOCK_FIELDS) ? (t as LockField) : null
    const remember = (e: Event) => {
      const el = field(e.target)
      if (el !== null && !initial.has(el)) initial.set(el, lockValue(el))
    }
    const onChange = (e: Event) => {
      const el = field(e.target)
      // lockPageHandler: checkbox events are not considered
      if (el === null || (el instanceof HTMLInputElement && el.type === 'checkbox')) return
      const old = initial.get(el)
      if (old === undefined) return
      if (lockValue(el) !== old) targets.add(el)
      else targets.delete(el)
      setLocked(targets.size > 0)
    }
    // resetLock: the form's reset, and a submit (AJAX.requestHandler resets before the request)
    const release = () => {
      targets.clear()
      setLocked(false)
    }
    form.addEventListener('focusin', remember)
    form.addEventListener('change', onChange)
    form.addEventListener('reset', release)
    form.addEventListener('submit', release)
    return () => {
      form.removeEventListener('focusin', remember)
      form.removeEventListener('change', onChange)
      form.removeEventListener('reset', release)
      form.removeEventListener('submit', release)
    }
  }, [form])
  useLockPage(locked || editorDirty)
  return setForm
}

/** `#lock_page_icon`, `#page_settings_icon`, `#goto_pagetop` (base.twig #page_nav_icons). */
export function PageIcons({ onTop }: { onTop: () => void }) {
  const { settings, locked } = useChrome()
  const [open, setOpen] = useState(false)
  return (
    <span className="flex items-center gap-1.5">
      <span id="lock_page_icon">
        {locked > 0 && (
          // Messages.strLockToolTip
          <PmaIcon
            name="s_lock"
            alt={t(
              'Indicates that you have made changes to this page; you will be prompted for confirmation before abandoning changes',
            )}
          />
        )}
      </span>
      {settings !== null && (
        <span id="page_settings_icon">
          <button
            type="button"
            title={t('Page-related settings')}
            onClick={() => setOpen(true)}
            className="p-0.5"
          >
            <PmaIcon name="s_cog" alt={t('Page-related settings')} />
          </button>
        </span>
      )}
      <button
        type="button"
        id="goto_pagetop"
        title={t('Click on the bar to scroll to top of page')}
        onClick={onTop}
        className="p-0.5"
      >
        <PmaIcon name="s_top" alt={t('Click on the bar to scroll to top of page')} />
      </button>
      {settings !== null && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="lg" id="pageSettingsModal" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t('Page-related settings')}</DialogTitle>
            </DialogHeader>
            <DialogBody>{settings.render()}</DialogBody>
            <DialogFooter>
              {/* pma: page_settings.ts — #pageSettingsModalApplyButton is a btn-secondary */}
              <Button
                id="pageSettingsModalApplyButton"
                onClick={async () => {
                  if ((await settings.apply()) !== false) setOpen(false)
                }}
              >
                {t('Apply')}
              </Button>
              <Button id="pageSettingsModalCancelButton" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </span>
  )
}
