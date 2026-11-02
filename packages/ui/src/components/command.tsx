import { Command } from 'cmdk'
import { Search, X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { useUiSettings } from '../settings.tsx'
import { Dialog, DialogClose, DialogContent, DialogTitle } from './dialog.tsx'

/**
 * A command menu in a modal (BetterMyAdmin's command palette, parity exception X61): the standard
 * Dialog (focus trap, Esc / backdrop close, the focus given back to where it was) holding a
 * `CommandMenu`. Tokens only, so it follows every theme and colour mode.
 */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  children,
  className,
  id,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the dialog's accessible name (visually hidden) */
  title: string
  children: ReactNode
  className?: string
  id?: string
  /** after closing, before the focus goes back (Radix `onCloseAutoFocus`) */
  onCloseAutoFocus?: (e: Event) => void
}) {
  const { gettext } = useUiSettings()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        hideClose
        aria-describedby={undefined}
        className={cn('top-[12vh] max-h-[70vh] max-w-2xl', className)}
        {...(id !== undefined ? { id } : {})}
        {...(onCloseAutoFocus !== undefined ? { onCloseAutoFocus } : {})}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
        {/* phones only (the palette is a full screen there, Esc is not at hand): shown by mobile-shell.css */}
        <DialogClose className="bma-sheet-close hidden" aria-label={gettext('Close')}>
          <X className="size-5" aria-hidden />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}

/**
 * cmdk's combobox: `input[role=combobox]` with `aria-activedescendant`, `[role=listbox]`,
 * `[role=option]`, groups with headings; ↑/↓ (looping), Home/End, Enter. Filtering is the
 * caller's (`shouldFilter={false}`): render the items already ranked, best first.
 */
export function CommandMenu({
  label,
  value,
  onValueChange,
  children,
  className,
}: {
  /** the combobox's accessible label (visually hidden) */
  label: string
  /** the highlighted item's value (controlled) */
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
  className?: string
}) {
  return (
    <Command
      label={label}
      shouldFilter={false}
      loop
      {...(value !== undefined ? { value } : {})}
      {...(onValueChange !== undefined ? { onValueChange } : {})}
      className={cn('flex min-h-0 flex-1 flex-col text-[13px]', className)}
    >
      {children}
    </Command>
  )
}

export function CommandInput({ className, ...props }: ComponentProps<typeof Command.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <Command.Input
        className={cn(
          // `!`: the themes' form-control rules (border, background, focus ring) do not apply to
          // the search box, which is part of the dialog's surface
          'h-10 w-full min-w-0 rounded-none! border-0! bg-transparent! px-0 text-sm text-fg shadow-none! outline-none! placeholder:text-fg-subtle',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function CommandList({ className, ...props }: ComponentProps<typeof Command.List>) {
  return <Command.List className={cn('min-h-0 flex-1 overflow-auto p-1', className)} {...props} />
}

export function CommandEmpty({ className, ...props }: ComponentProps<typeof Command.Empty>) {
  return <Command.Empty className={cn('px-3 py-6 text-center text-fg-muted', className)} {...props} />
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof Command.Group>) {
  return (
    <Command.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      className={cn(
        // the highlighted row: the menus' hover surface plus an accent bar (readable in every theme)
        'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-fg outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-bg-subtle data-[selected=true]:shadow-[inset_3px_0_0_var(--accent)] [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

/** A status line next to the list (searching…), announced politely. */
export function CommandStatus({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="status" className={cn('px-3 py-1 text-xs text-fg-muted', className)}>
      {children}
    </div>
  )
}

/** The key combination at the end of a row. */
export function CommandShortcut({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'ms-auto rounded border border-border-strong bg-bg-subtle px-1 font-mono text-[11px] text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}
