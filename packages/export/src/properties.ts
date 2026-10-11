/**
 * The plugin option declarations (format-specific options of the export and import pages), as data.
 * Texts are already translated (they may contain HTML, as phpMyAdmin's do); the page renders them.
 * pma: src/Properties/Options/**, src/Properties/Plugins/*
 */

/** MySQL documentation link `[page, anchor?]` or an FAQ anchor (string). */
export type DocLink = readonly [string] | readonly [string, string] | string

export type OptionItem =
  | { kind: 'bool'; name: string; text: string; doc?: DocLink }
  | { kind: 'text'; name: string; text: string; size?: number; len?: number; doc?: DocLink }
  | { kind: 'number'; name: string; text: string; doc?: DocLink }
  | { kind: 'select'; name: string; text: string; values: Array<[string, string]>; doc?: DocLink }
  | { kind: 'radio'; name: string; text: string; values: Array<[string, string]>; doc?: DocLink }
  | { kind: 'hidden'; name: string; text: string; value?: string }
  | { kind: 'message'; name: string; text: string; doc?: DocLink }
  | OptionSubgroup

export type LeafItem = Exclude<OptionItem, OptionSubgroup>

export interface OptionSubgroup {
  kind: 'subgroup'
  name: string
  text: string
  header: Exclude<OptionItem, OptionSubgroup> | null
  items: OptionItem[]
}

export interface OptionMainGroup {
  kind: 'main'
  name: string
  text: string
  items: OptionItem[]
}

export interface PluginProperties {
  /** plugin name, e.g. `sql` */
  name: string
  /** display text (Plugins::getChoice, getTranslatedText) */
  text: string
  extension: string
  mimeType: string
  /** forceFile: binary formats cannot be shown as text */
  forceFile: boolean
  /** null when the plugin declares no options (e.g. SQL at table scope without single_table) */
  options: OptionMainGroup[] | null
}

export const boolItem = (name: string, text: string, doc?: DocLink): LeafItem =>
  doc === undefined ? { kind: 'bool', name, text } : { kind: 'bool', name, text, doc }
export const textItem = (
  name: string,
  text: string,
  o: { size?: number; len?: number; doc?: DocLink } = {},
): LeafItem => ({
  kind: 'text',
  name,
  text,
  ...o,
})
export const numberItem = (name: string, text: string): LeafItem => ({ kind: 'number', name, text })
export const select = (
  name: string,
  text: string,
  values: Array<[string, string]>,
  doc?: DocLink,
): LeafItem =>
  doc === undefined ? { kind: 'select', name, text, values } : { kind: 'select', name, text, values, doc }
export const radio = (name: string, text: string, values: Array<[string, string]>): LeafItem => ({
  kind: 'radio',
  name,
  text,
  values,
})
export const hidden = (name: string, text = ''): LeafItem => ({ kind: 'hidden', name, text })
export const message = (name: string, text: string): LeafItem => ({ kind: 'message', name, text })
export const subgroup = (
  header: LeafItem | null,
  items: OptionItem[],
  name = '',
  text = '',
): OptionSubgroup => ({ kind: 'subgroup', name, text, header, items })
export const main = (name: string, text: string, items: OptionItem[]): OptionMainGroup => ({
  kind: 'main',
  name,
  text,
  items,
})

/** Every named item of an option tree (subgroup headers included). */
export function optionItems(
  groups: readonly OptionMainGroup[] | null,
): Array<Exclude<OptionItem, OptionSubgroup>> {
  const out: Array<Exclude<OptionItem, OptionSubgroup>> = []
  const walk = (items: readonly OptionItem[]) => {
    for (const i of items) {
      if (i.kind === 'subgroup') {
        if (i.header !== null) out.push(i.header)
        walk(i.items)
      } else out.push(i)
    }
  }
  for (const g of groups ?? []) walk(g.items)
  return out
}
