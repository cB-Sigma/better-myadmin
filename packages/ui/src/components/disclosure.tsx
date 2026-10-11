import * as Collapsible from '@radix-ui/react-collapsible'
import { type ReactNode, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { disclosureInitial } from '../lib/sliders.ts'
import { useUiSettings } from '../settings.tsx'
import { buttonVariants } from './button.tsx'

export interface DisclosureProps {
  /** Toggle button text (e.g. "Extra options", "Partitions"). */
  label: ReactNode
  children: ReactNode
  id?: string
  className?: string
  /** Overrides $cfg['InitialSlidersState'] for this block. */
  initialState?: 'open' | 'closed' | 'disabled'
}

/**
 * Bootstrap collapse with a toggle button, initial state from `InitialSlidersState`; with
 * 'disabled' the content is shown and no toggle exists.
 * pma: resources/templates/display/results/table.twig (#extraOptions), table/structure/display_structure.twig
 */
export function Disclosure({ label, children, id, className, initialState }: DisclosureProps) {
  const settings = useUiSettings()
  const init = disclosureInitial(initialState ?? settings.InitialSlidersState)
  const [open, setOpen] = useState(init.open)
  if (!init.collapsible) {
    return (
      <div className={className} {...(id !== undefined ? { id } : {})}>
        {children}
      </div>
    )
  }
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={className}>
      <div className="mb-3">
        <Collapsible.Trigger className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
          {label}
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content {...(id !== undefined ? { id } : {})} className="mb-3">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
