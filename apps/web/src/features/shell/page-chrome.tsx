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
 * Page-level chrome a page can opt into: the "Page-related settings" gear (PageSettings forms come
 * with the preferences layer; pages register their form here) and the lock icon of `lock-page`
 * forms with the unsaved-changes confirmation.
 * pma: src/Config/PageSettings.php, resources/js/modules/page_settings.ts, modules/ajax.ts (lockPageHandler)
 */

export interface PageSettingsRegistration {
  /** PageFormList group: Browse, DbStructure, Edit, Export, Import, Navi, Sql, TableStructure */
  group: string
  /** The form; it should submit itself when `apply` is called */
  render: () => ReactNode
  apply: () => void | Promise<void>
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

export const UNSAVED_CHANGES = 'You have unsaved changes; are you sure you want to leave this page?'
export const LOCK_TOOLTIP =
  'Indicates that you have made changes to this page; you will be prompted for confirmation before abandoning changes'

/** A `lock-page` form: shows the lock icon while dirty and asks before navigating away. */
export function useLockPage(dirty: boolean): void {
  const { setLocked } = useChrome()
  useEffect(() => {
    if (!dirty) return
    setLocked((n) => n + 1)
    return () => setLocked((n) => n - 1)
  }, [dirty, setLocked])
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm(UNSAVED_CHANGES), disabled: !dirty })
}

/** `#lock_page_icon`, `#page_settings_icon`, `#goto_pagetop` (base.twig #page_nav_icons). */
export function PageIcons({ onTop }: { onTop: () => void }) {
  const { settings, locked } = useChrome()
  const [open, setOpen] = useState(false)
  return (
    <span className="flex items-center gap-1.5">
      <span id="lock_page_icon">{locked > 0 && <PmaIcon name="s_lock" alt={LOCK_TOOLTIP} />}</span>
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
              <Button
                variant="primary"
                onClick={async () => {
                  await settings.apply()
                  setOpen(false)
                }}
              >
                Apply
              </Button>
              <Button onClick={() => setOpen(false)}>{t('Cancel')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </span>
  )
}
