/**
 * Node-only catalogue loading for the server and tests: compiles po/<code>.po on first use and keeps one
 * Translator per locale (each request picks the one for its selected language).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Catalog, compileCatalog } from './compile.ts'
import { Translator } from './translator.ts'

const poDir = fileURLToPath(new URL('../po/', import.meta.url))
const catalogs = new Map<string, Catalog | null>()
const translators = new Map<string, Translator>()

/** The compiled catalogue for a catalogue code (`de`, `pt_BR`), or null for English / unknown codes. */
export function loadCatalog(code: string): Catalog | null {
  let c = catalogs.get(code)
  if (c !== undefined) return c
  const file = `${poDir}${code}.po`
  c = code !== 'en' && existsSync(file) ? compileCatalog(readFileSync(file, 'utf8')) : null
  catalogs.set(code, c)
  return c
}

/** A cached Translator for a catalogue code. */
export function translatorFor(code: string): Translator {
  let t = translators.get(code)
  if (t === undefined) {
    t = new Translator(code, loadCatalog(code))
    translators.set(code, t)
  }
  return t
}
