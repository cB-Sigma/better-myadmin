import type { ComponentProps, ReactNode } from 'react'
import { type PmaIconName, pmaIconOutline, pmaIcons } from '../icons/pma-map.ts'
import { cn } from '../lib/cn.ts'
import { decodeEntities } from '../lib/entities.ts'
import { iconParts } from '../lib/link-mode.ts'
import { type LinkMode, type UiSettings, useUiSettings } from '../settings.tsx'

/**
 * `get_image(name, alt)`: the mapped icon; `alt` becomes the accessible name and title.
 * pma: src/Html/Generator.php::getImage
 */
export function PmaIcon({
  name,
  alt = '',
  className,
  size = 16,
}: { name: PmaIconName; alt?: string; className?: string; size?: 14 | 16 | 20 }) {
  const Icon = pmaIcons[name]
  const outline = pmaIconOutline.has(name)
  const filled = name === 'b_favorite'
  return (
    <Icon
      data-icon={`ic_${name}`}
      className={cn(
        'icon inline-block shrink-0 align-[-3px]',
        `ic_${name}`,
        filled && 'fill-current',
        outline && 'opacity-60',
        className,
      )}
      width={size}
      height={size}
      aria-hidden={alt === '' ? true : undefined}
      {...(alt !== '' ? { 'aria-label': alt, role: 'img' } : {})}
    >
      {alt !== '' && <title>{alt}</title>}
    </Icon>
  )
}

type ModeKey = keyof Pick<
  UiSettings,
  'ActionLinksMode' | 'TabsMode' | 'TableNavigationLinksMode' | 'RowActionType'
>

/**
 * `get_icon(icon, text, forceText, menuIcon, controlParam)`: icon and/or text depending on the
 * link-mode directive (ActionLinksMode by default). Without text, the text is the icon's alt.
 * pma: src/Html/Generator.php::getIcon
 */
export function IconText({
  icon,
  text,
  forceText = false,
  mode = 'ActionLinksMode',
  modeValue,
}: {
  icon: PmaIconName
  text: string
  forceText?: boolean
  mode?: ModeKey
  /** Explicit mode value, bypassing the settings context. */
  modeValue?: LinkMode
}) {
  const settings = useUiSettings()
  const parts = iconParts(modeValue ?? settings[mode], forceText)
  // getIcon prints its text raw: entities in a translation render
  const shown = decodeEntities(text)
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {parts.icon && <PmaIcon name={icon} alt={parts.text ? '' : shown} />}
      {parts.text && <span>{shown}</span>}
    </span>
  )
}

export type IconLinkProps = Omit<ComponentProps<'a'>, 'children'> & {
  icon: PmaIconName
  text: string
  forceText?: boolean
  mode?: ModeKey
  children?: ReactNode
}

/** An `<a>` whose content follows ActionLinksMode (or another mode directive). */
export function IconLink({ icon, text, forceText, mode, className, children, ...props }: IconLinkProps) {
  return (
    <a className={cn('inline-flex items-center', className)} title={text} {...props}>
      <IconText
        icon={icon}
        text={text}
        {...(forceText !== undefined ? { forceText } : {})}
        {...(mode ? { mode } : {})}
      />
      {children}
    </a>
  )
}
