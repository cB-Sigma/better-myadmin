import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { useUiSettings } from '../settings.tsx'
import { buttonVariants } from './button.tsx'

export interface ConfirmOptions {
  /** The question (phpMyAdmin passes HTML; we take a node). */
  question: ReactNode
  /** Modal title, "Confirm" by default (Messages.strConfirm). */
  title?: string
  /** Primary button text, "OK" by default (Messages.strOK). */
  okLabel?: string
  /** Dismiss button text, "Close" by default — phpMyAdmin's modal has OK/Close, not OK/Cancel. */
  closeLabel?: string
  /** Red OK button for destructive actions (DROP/TRUNCATE/DELETE). */
  destructive?: boolean
  /**
   * A page's own Bootstrap modal instead of `#functionConfirmModal`: the dismiss button first and a
   * primary OK button (e.g. check_all_tables.twig's Cancel / Continue).
   */
  cancelFirst?: boolean
  /**
   * Ignore `$cfg['Confirm']` and always ask. phpMyAdmin bypasses only the `$.fn.confirm` path when
   * Confirm is off; a few prompts (e.g. empty password with AllowNoPassword=false) use it too.
   */
  force?: boolean
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>

const Ctx = createContext<Ask | null>(null)

/**
 * Shared confirmation modal, the `#functionConfirmModal` of phpMyAdmin.
 * pma: resources/js/modules/functions.ts::confirmDialog ($.fn.confirm), templates/modals/function_confirm.twig
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { Confirm } = useUiSettings()
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const ask = useCallback<Ask>(
    (o) => {
      // CommonParams.confirm === false → the callback runs immediately
      if (!Confirm && o.force !== true) return Promise.resolve(true)
      resolver.current?.(false)
      setOpts(o)
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve
      })
    },
    [Confirm],
  )

  const settle = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }

  return (
    <Ctx.Provider value={ask}>
      {children}
      <ConfirmDialog
        open={opts !== null}
        onOpenChange={(o) => {
          if (!o) settle(false)
        }}
        onConfirm={() => settle(true)}
        {...(opts ?? { question: null })}
      />
    </Ctx.Provider>
  )
}

/** `const confirm = useConfirm(); if (await confirm({question})) …` */
export function useConfirm(): Ask {
  const ask = useContext(Ctx)
  if (ask === null) throw new Error('useConfirm() needs <ConfirmProvider>')
  return ask
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** Controlled variant, for pages that keep their own state. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { gettext } = useUiSettings()
  // Messages.strConfirm / strOK / strClose
  const memo = useMemo(
    () => ({
      title: props.title ?? gettext('Confirm'),
      ok: props.okLabel ?? gettext('OK'),
      close: props.closeLabel ?? gettext('Close'),
    }),
    [props.title, props.okLabel, props.closeLabel, gettext],
  )
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          id="functionConfirmModal"
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-(--radius) border border-border-strong bg-bg-elevated text-fg shadow-xl"
        >
          <div className="border-b border-border bg-bg-subtle px-3 py-2">
            <AlertDialog.Title className="text-base font-semibold">{memo.title}</AlertDialog.Title>
          </div>
          <AlertDialog.Description asChild>
            <div className="p-3 text-sm break-words">{props.question}</div>
          </AlertDialog.Description>
          <div className="flex justify-end gap-2 border-t border-border bg-bg-subtle px-3 py-2">
            {props.cancelFirst === true && (
              <AlertDialog.Cancel className={cn(buttonVariants({ variant: 'secondary' }))}>
                {memo.close}
              </AlertDialog.Cancel>
            )}
            <AlertDialog.Action
              id="functionConfirmOkButton"
              className={cn(
                buttonVariants({
                  variant:
                    props.destructive === true
                      ? 'destructive'
                      : props.cancelFirst === true
                        ? 'primary'
                        : 'secondary',
                }),
              )}
              onClick={props.onConfirm}
            >
              {memo.ok}
            </AlertDialog.Action>
            {props.cancelFirst !== true && (
              <AlertDialog.Cancel className={cn(buttonVariants({ variant: 'secondary' }))}>
                {memo.close}
              </AlertDialog.Cancel>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
