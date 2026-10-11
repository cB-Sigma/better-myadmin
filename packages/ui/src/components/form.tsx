import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Command } from 'cmdk'
import { Check, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { type ComponentProps, type ReactNode, useId, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { Popover, PopoverContent, PopoverTrigger } from './menus.tsx'

const control =
  'rounded-(--radius) border border-border-strong bg-bg text-fg px-2 text-[13px] leading-snug placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-(--focus-ring) disabled:opacity-60'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-7 w-full', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'w-full py-1', className)} {...props} />
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or wrap the control
  return <label className={cn('text-[13px]', className)} {...props} />
}

/**
 * Styled native `<select>`: phpMyAdmin's long lists (collations with optgroups, `autosubmit`
 * selects) keep native keyboard behaviour and type-ahead.
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(control, 'h-7 max-w-full cursor-pointer pe-6', className)} {...props}>
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------------------------
// Select (Radix) — for short lists (≤ 12 options) per the design system
// ---------------------------------------------------------------------------------------------

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onValueChange: (v: string) => void
  options: SelectOption[]
  id?: string
  className?: string
  'aria-label'?: string
  disabled?: boolean
}

export function Select({ value, onValueChange, options, id, className, disabled, ...rest }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} {...(disabled ? { disabled } : {})}>
      <SelectPrimitive.Trigger
        {...(id !== undefined ? { id } : {})}
        aria-label={rest['aria-label']}
        className={cn(control, 'inline-flex h-7 items-center justify-between gap-2', className)}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={2}
          className="z-50 max-h-80 min-w-(--radix-select-trigger-width) overflow-hidden rounded-(--radius) border border-border-strong bg-bg-elevated text-fg shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                {...(o.disabled ? { disabled: true } : {})}
                className="relative flex cursor-pointer items-center rounded-sm py-1 pr-2 pl-6 text-[13px] outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-bg-subtle"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5">
                  <Check className="size-3.5" aria-hidden />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------------------------
// Combobox (Command + Popover) — long lists with search above (FK dropdowns, …)
// ---------------------------------------------------------------------------------------------

export interface ComboboxProps {
  value: string
  onValueChange: (v: string) => void
  options: Array<{ value: string; label: string; group?: string }>
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  id?: string
  className?: string
}

export function Combobox(props: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const current = props.options.find((o) => o.value === props.value)
  const groups = new Map<string, ComboboxProps['options']>()
  for (const o of props.options) {
    const g = o.group ?? ''
    groups.set(g, [...(groups.get(g) ?? []), o])
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          {...(props.id !== undefined ? { id: props.id } : {})}
          className={cn(
            control,
            'inline-flex h-7 w-auto min-w-40 items-center justify-between gap-2',
            props.className,
          )}
        >
          <span className="truncate">{current?.label ?? props.placeholder ?? ''}</span>
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <Command className="text-[13px]">
          <Command.Input
            placeholder={props.searchPlaceholder ?? ''}
            className="h-8 w-full border-b border-border bg-transparent px-2 outline-none"
          />
          <Command.List id={listId} className="max-h-72 overflow-auto p-1">
            <Command.Empty className="px-2 py-1 text-fg-muted">{props.emptyText ?? ''}</Command.Empty>
            {[...groups].map(([g, items]) => (
              <Command.Group
                key={g}
                heading={g}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-muted"
              >
                {items.map((o) => (
                  <Command.Item
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => {
                      props.onValueChange(o.value)
                      setOpen(false)
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 data-[selected=true]:bg-bg-subtle"
                  >
                    <Check
                      className={cn('size-3.5', o.value === props.value ? 'opacity-100' : 'opacity-0')}
                    />
                    {o.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------------------------

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-bg data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------------------------
// FormRow — label left (220 px), control right; stacked below 900 px (docs/architecture/09)
// ---------------------------------------------------------------------------------------------

/**
 * One row of a free-layout admin form (`.form-group`). Forms that mirror a phpMyAdmin `<table>`
 * template keep the table for parity; everything else lays out its fields with FormRow.
 */
export function FormRow({
  label,
  htmlFor,
  hint,
  children,
  className,
}: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid items-center gap-x-3 gap-y-1 py-1 min-[900px]:grid-cols-[220px_minmax(0,1fr)]',
        className,
      )}
    >
      <Label {...(htmlFor !== undefined ? { htmlFor } : {})}>{label}</Label>
      <div className="min-w-0">
        {children}
        {hint !== undefined && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Radio — a native radio button (phpMyAdmin's radio groups post with the form and keep ids for
// keyboard navigation), styled like the other controls
// ---------------------------------------------------------------------------------------------

export function Radio({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="radio"
      className={cn('size-3.5 cursor-pointer accent-(--color-accent) align-middle', className)}
      {...props}
    />
  )
}
