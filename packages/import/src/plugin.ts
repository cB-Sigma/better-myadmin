import type { OptionMainGroup } from '@bettermyadmin/export'
import type { Import, ImportType } from './import.ts'

/** ImportPluginProperties */
export interface ImportPluginProperties {
  name: string
  text: string
  extension: string
  mimeType: string
  options: OptionMainGroup[] | null
}

/** What a plugin needs when it lists its options (no import running). */
export interface ImportPageContext {
  importType: ImportType
  tr: { gettext(s: string): string }
  /** DatabaseInterface::getCompatibilities */
  compatibilities: string[]
  /** `SELECT @@local_infile` is ON/1 (ImportLdi::setLdiLocalOptionConfig) */
  localInfile: boolean
}

/**
 * Super class of the import plugins.
 * pma: src/Plugins/ImportPlugin.php
 */
export abstract class ImportPlugin {
  readonly page: ImportPageContext
  readonly properties: ImportPluginProperties

  constructor(page: ImportPageContext) {
    this.page = page
    this.properties = this.setProperties()
  }

  protected __(s: string): string {
    return this.page.tr.gettext(s)
  }

  abstract get name(): string
  protected abstract setProperties(): ImportPluginProperties

  /** ImportPlugin::getTranslatedText */
  getTranslatedText(text: string): string {
    return text
  }

  /** Handles the whole import logic; returns the statements kept for the SQL path */
  abstract doImport(imp: Import): Promise<void>
}
