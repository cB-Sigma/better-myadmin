/**
 * Relational schema export (the Designer's "Export schema"): SVG, EPS and Dia, byte-compatible
 * with phpMyAdmin's schema plugins, and PDF (phpMyAdmin's TCPDF document, on the TCPDF port of
 * @bettermyadmin/pdf).
 * pma: src/Plugins/Schema/*, src/Plugins.php::getSchema
 */
import { diaSchema } from './dia.ts'
import { epsSchema } from './eps.ts'
import type { SchemaRequest, SchemaResult, SchemaTableData } from './model.ts'
import { pdfSchema } from './pdf.ts'
import { svgSchema } from './svg.ts'

export { getStringWidth } from './font.ts'
export type { SchemaRequest, SchemaResult, SchemaTableData, SchemaTableDoc } from './model.ts'
export { XmlWriter } from './xml-writer.ts'

export type SchemaFormat = 'dia' | 'eps' | 'pdf' | 'svg'

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
 * pma: src/Plugins/Schema/Schema{Dia,Eps,Pdf,Svg}.php::setProperties, SchemaPlugin::addCommonOptions
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
  const paper = (name: string): SchemaOption => ({
    kind: 'select',
    name: `${name}_paper`,
    text: t('Paper size'),
    values: paperSizes.map((p) => ({ value: p, text: p })),
  })
  return [
    {
      name: 'dia',
      text: 'Dia',
      options: [...common('dia'), orientation('dia'), paper('dia')],
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
      name: 'pdf',
      text: 'PDF',
      options: [
        ...common('pdf'),
        { kind: 'bool', name: 'pdf_all_tables_same_width', text: t('Same width for all tables') },
        orientation('pdf'),
        paper('pdf'),
        { kind: 'bool', name: 'pdf_show_grid', text: t('Show grid') },
        { kind: 'bool', name: 'pdf_with_doc', text: t('Data dictionary') },
        {
          kind: 'select',
          name: 'pdf_table_order',
          text: t('Order of the tables'),
          values: [
            { value: '', text: t('None') },
            { value: 'name_asc', text: t('Name (Ascending)') },
            { value: 'name_desc', text: t('Name (Descending)') },
          ],
        },
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
export async function exportSchema(
  format: SchemaFormat,
  req: SchemaRequest,
  data: ReadonlyMap<string, SchemaTableData>,
): Promise<SchemaResult> {
  if (format === 'dia') return diaSchema(req, data)
  if (format === 'eps') return epsSchema(req, data)
  if (format === 'pdf') return pdfSchema(req, data)
  return svgSchema(req, data)
}
