/**
 * Initial state of a collapsible "Options"-style block.
 * pma: $cfg['InitialSlidersState'] ('open' | 'closed' | 'disabled'); with 'disabled' the content is
 * rendered expanded without a toggle (Generator / templates render no slider at all).
 */
export function disclosureInitial(state: 'open' | 'closed' | 'disabled'): {
  open: boolean
  collapsible: boolean
} {
  if (state === 'disabled') return { open: true, collapsible: false }
  return { open: state === 'open', collapsible: true }
}
