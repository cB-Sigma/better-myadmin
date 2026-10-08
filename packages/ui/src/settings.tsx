import { type ReactNode, createContext, useContext } from 'react'

/** phpMyAdmin's three-valued link mode used by TabsMode, ActionLinksMode, RowActionType... */
export type LinkMode = 'icons' | 'text' | 'both'

/**
 * The directives the component kit honours. The app fills this from the merged configuration and
 * user preferences; components read it through `useUiSettings()` so they never import app state.
 */
export interface UiSettings {
  /** $cfg['ActionLinksMode'] (default 'both') */
  ActionLinksMode: LinkMode
  /** $cfg['TabsMode'] (default 'both') */
  TabsMode: LinkMode
  /** $cfg['TableNavigationLinksMode'] (default 'icons') */
  TableNavigationLinksMode: LinkMode
  /** $cfg['RowActionType'] (default 'both') */
  RowActionType: LinkMode
  /** $cfg['Confirm'] "Confirm DROP queries" (default true) */
  Confirm: boolean
  /** $cfg['InitialSlidersState'] (default 'closed') */
  InitialSlidersState: 'open' | 'closed' | 'disabled'
  /** $cfg['ShowHint'] (default true) */
  ShowHint: boolean
  /** Server facts for MySQL documentation links (Util::getMySQLDocuURL). 0 = not connected. */
  serverVersion: number
  isMariaDb: boolean
}

export const defaultUiSettings: UiSettings = {
  ActionLinksMode: 'both',
  TabsMode: 'both',
  TableNavigationLinksMode: 'icons',
  RowActionType: 'both',
  Confirm: true,
  InitialSlidersState: 'closed',
  ShowHint: true,
  serverVersion: 0,
  isMariaDb: false,
}

const Ctx = createContext<UiSettings>(defaultUiSettings)

export function UiSettingsProvider({ value, children }: { value: UiSettings; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUiSettings(): UiSettings {
  return useContext(Ctx)
}
