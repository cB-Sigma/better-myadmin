import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

const variants = {
  primary: 'border-transparent bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border-border-strong bg-btn text-fg hover:bg-btn-hover',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-bg-subtle',
  destructive: 'border-transparent bg-error text-white hover:opacity-90',
  link: 'border-transparent bg-transparent px-0 text-accent underline-offset-2 hover:underline',
}
const sizes = {
  sm: 'h-6 px-2 text-xs',
  md: 'h-7 px-3',
  lg: 'h-8 px-4 text-sm',
  icon: 'size-7 p-0',
}
const base =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap border font-medium text-[13px] leading-none transition-colors disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0 rounded-(--btn-radius)'

export interface ButtonVariantProps {
  /** `null` leaves the variant's classes out; `undefined` uses the default (secondary, md). */
  variant?: keyof typeof variants | null | undefined
  size?: keyof typeof sizes | null | undefined
}

/**
 * The class list of the shadcn/ui Button with the dense admin preset (28 px default height, 13 px
 * text): base, then the variant's classes, then the size's, the same order shadcn's cva() gave.
 */
export function buttonVariants({ variant, size }: ButtonVariantProps = {}): string {
  const v = variant === null ? '' : variants[variant ?? 'secondary']
  const s = size === null ? '' : sizes[size ?? 'md']
  return [base, v, s].filter(Boolean).join(' ')
}

export type ButtonProps = ComponentProps<'button'> & ButtonVariantProps & { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'secondary'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  )
}
