import { Slot } from '@radix-ui/react-slot'
import { type VariantProps, cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

/** shadcn/ui Button with the dense admin preset (28 px default height, 13 px text). */
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap border font-medium text-[13px] leading-none transition-colors disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0 rounded-(--btn-radius)',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'border-border-strong bg-btn text-fg hover:bg-btn-hover',
        ghost: 'border-transparent bg-transparent text-fg hover:bg-bg-subtle',
        destructive: 'border-transparent bg-error text-white hover:opacity-90',
        link: 'border-transparent bg-transparent px-0 text-accent underline-offset-2 hover:underline',
      },
      size: {
        sm: 'h-6 px-2 text-xs',
        md: 'h-7 px-3',
        lg: 'h-8 px-4 text-sm',
        icon: 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  )
}
