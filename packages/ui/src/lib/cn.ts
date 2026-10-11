import { type ClassValue, clsx } from 'clsx'

/**
 * Class combiner. shadcn/ui pairs clsx with tailwind-merge; the kit composes classes so that
 * caller overrides never conflict (more specific utilities such as `rounded-s-none` win in
 * Tailwind's ordering), which keeps tailwind-merge's ~8 KB gz out of the initial bundle.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
