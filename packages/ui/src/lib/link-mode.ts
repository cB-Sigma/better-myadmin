import type { LinkMode } from '../settings.tsx'

/** pma: src/Util.php::showIcons */
export function showIcons(mode: LinkMode): boolean {
  return mode === 'icons' || mode === 'both'
}

/** pma: src/Util.php::showText */
export function showText(mode: LinkMode): boolean {
  return mode === 'text' || mode === 'both'
}

/**
 * Which parts of an icon link are rendered. `forceText` always shows the text (Generator::getIcon's
 * third argument). With mode 'icons' and no forced text, the text becomes the icon's title/alt.
 * pma: src/Html/Generator.php::getIcon
 */
export function iconParts(mode: LinkMode, forceText = false): { icon: boolean; text: boolean } {
  return { icon: showIcons(mode), text: forceText || showText(mode) }
}
