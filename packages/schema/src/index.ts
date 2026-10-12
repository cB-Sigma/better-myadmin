/**
 * Relational schema export (the Designer's "Export schema"): SVG, EPS and Dia, byte-compatible
 * with phpMyAdmin's schema plugins. PDF (TCPDF) is not ported.
 * pma: src/Plugins/Schema/*, src/Plugins.php::getSchema
 */
import { diaSchema } from './dia.ts'
import { epsSchema } from './eps.ts'
import type { SchemaRequest, SchemaResult, SchemaTableData } from './model.ts'
import { svgSchema } from './svg.ts'

export { getStringWidth } from './font.ts'
export type { SchemaRequest, SchemaResult, SchemaTableData } from './model.ts'
export { XmlWriter } from './xml-writer.ts'

export type SchemaFormat = 'dia' | 'eps' | 'svg'

/** One option of a plugin's "Format specific options" (Plugins::getOptions). */
export type SchemaOption =
  | { kind: 'bool'; name: string; text: string }
  | { kind: 'select'; name: string; text: string; values: Array<{ value: string; text: string }> }

export interface SchemaPluginInfo {
  name: SchemaFormat
  /** properties text (SVG, EPS, Dia) */
  text: string
  options: SchemaOption[]
}

/**
 * The plugins in phpMyAdmin's listing order (Plugins::getPlugins: directory order, by name) and
 * their options. `t` translates msgids; `paperSizes` is $cfg['PDFPageSizes'].
 * pma: src/Plugins/Schema/Schema{Dia,Eps,Svg}.php::setProperties, SchemaPlugin::addCommonOptions
 */
export function schemaPlugins(
  t: (msgid: string) => string,
  paperSizes: readonly string[],
): SchemaPluginInfo[] {
  const common = (name: string): SchemaOption[] => [
    { kind: 'bool', name: `${name}_show_color`, text: t('Show color') },
    { kind: 'bool', name: `${name}_show_keys`, text: t('Only show keys') },
  ]
  const orientation = (name: string): SchemaOption => ({
    kind: 'select',
    name: `${name}_orientation`,
    text: t('Orientation'),
    values: [
      { value: 'L', text: t('Landscape') },
      { value: 'P', text: t('Portrait') },
    ],
  })
  return [
    {
      name: 'dia',
      text: 'Dia',
      options: [
        ...common('dia'),
        orientation('dia'),
        {
          kind: 'select',
          name: 'dia_paper',
          text: t('Paper size'),
          values: paperSizes.map((p) => ({ value: p, text: p })),
        },
      ],
    },
    {
      name: 'eps',
      text: 'EPS',
      options: [
        ...common('eps'),
        { kind: 'bool', name: 'eps_all_tables_same_width', text: t('Same width for all tables') },
        orientation('eps'),
      ],
    },
    {
      name: 'svg',
      text: 'SVG',
      options: [
        ...common('svg'),
        { kind: 'bool', name: 'svg_all_tables_same_width', text: t('Same width for all tables') },
      ],
    },
  ]
}

/** Export::getExportSchemaInfo for one format */
export function exportSchema(
  format: SchemaFormat,
  req: SchemaRequest,
  data: ReadonlyMap<string, SchemaTableData>,
): SchemaResult {
  if (format === 'dia') return diaSchema(req, data)
  if (format === 'eps') return epsSchema(req, data)
  return svgSchema(req, data)
}
