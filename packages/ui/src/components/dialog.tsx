import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

/** Bootstrap-modal equivalent (`#modal`): sizes sm/md/lg/xl/full, Esc and backdrop close. */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
  full: 'max-w-[calc(100vw-2rem)] h-[calc(100vh-2rem)]',
} as const

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in-fade', className)}
      {...props}
    />
  )
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: keyof typeof sizes
  /** aria-label of the corner close button (phpMyAdmin: "Close", error report modal: "Cancel"). */
  closeLabel?: string
  /** Static backdrop: clicking outside / Esc does not close (error report modal). */
  modal?: 'static' | 'dismissable'
  hideClose?: boolean
}

export function DialogContent({
  className,
  children,
  size = 'md',
  closeLabel = 'Close',
  modal = 'dismissable',
  hideClose = false,
  onInteractOutside,
  onEscapeKeyDown,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-[8vh] left-1/2 z-50 flex max-h-[84vh] w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-(--radius) border border-border-strong bg-bg-elevated text-fg shadow-xl data-[state=open]:animate-in-scale',
          sizes[size],
          className,
        )}
        onInteractOutside={(e) => {
          if (modal === 'static') e.preventDefault()
          // clicking the AJAX notification (which sits above the modal) dismisses the message,
          // not the dialog: phpMyAdmin's modal stays open
          else if (e.target instanceof Element && e.target.closest('[data-sonner-toaster]') !== null)
            e.preventDefault()
          onInteractOutside?.(e)
        }}
        onEscapeKeyDown={(e) => {
          if (modal === 'static') e.preventDefault()
          onEscapeKeyDown?.(e)
        }}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute top-2 right-2 rounded p-1 text-fg-muted hover:bg-bg-subtle hover:text-fg"
            aria-label={closeLabel}
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-b border-border bg-bg-subtle px-3 py-2 pr-10', className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-fg-muted', className)} {...props} />
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-auto p-3 text-sm', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border bg-bg-subtle px-3 py-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The standard modal: title bar, scrolling body, optional button footer — the Bootstrap `#modal`
 * pages open for forms and confirmations. Compose the Dialog parts directly only for layouts this
 * does not cover.
 */
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  size = 'lg',
  id,
  closeLabel,
}: {
  title: ReactNode
  open: boolean
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: keyof typeof sizes
  id?: string
  /** aria-label of the corner × (DialogContent `closeLabel`; the Designer's modals say "Cancel") */
  closeLabel?: string
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size={size}
        aria-describedby={undefined}
        {...(id !== undefined ? { id } : {})}
        {...(closeLabel !== undefined ? { closeLabel } : {})}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer !== undefined && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
