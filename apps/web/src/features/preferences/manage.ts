/**
 * Preferences in the browser's localStorage (Manage your settings, the autoload offer).
 * pma: resources/js/modules/config.ts (savePrefsToLocalStorage, updatePrefsDate,
 *      offerPrefsAutoimport), modules/functions/isStorageSupported.ts, formatDateTime.ts
 */

/** isStorageSupported('localStorage') */
export function localStorageSupported(): boolean {
  try {
    window.localStorage.setItem('PMATest', 'test')
    if (window.localStorage.getItem('PMATest') === 'test') {
      window.localStorage.removeItem('PMATest')
      return true
    }
  } catch {
    // not supported (private window, blocked storage)
  }
  return false
}

export interface StoredPrefs {
  config: string
  mtimeLocal: string | null
}

/** window.localStorage.config (+ configMtimeLocal) */
export function storedPrefs(): StoredPrefs | null {
  try {
    const config = window.localStorage.getItem('config')
    if (config === null || config === '') return null
    return { config, mtimeLocal: window.localStorage.getItem('configMtimeLocal') }
  } catch {
    return null
  }
}

/** savePrefsToLocalStorage: config, configMtime and configMtimeLocal (UTC string). */
export function savePrefs(prefs: string, mtime: number, now = new Date()): void {
  try {
    window.localStorage.setItem('config', prefs)
    window.localStorage.setItem('configMtime', String(mtime))
    window.localStorage.setItem('configMtimeLocal', now.toUTCString())
  } catch {
    // storage unavailable
  }
}

/** The autoload banner's "Delete settings": localStorage.clear() */
export function clearPrefs(): void {
  try {
    window.localStorage.clear()
  } catch {
    // storage unavailable
  }
}

const two = (n: number) => String(n).padStart(2, '0')

/** formatDateTime(date): `yy-mm-dd HH:mm` of jQuery UI's datepicker (four-digit year) */
export function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** updatePrefsDate: `Saved on: @DATE@` */
export function savedOn(template: string, mtimeLocal: string | null): string {
  return template.replace('@DATE@', formatDateTime(new Date(mtimeLocal ?? '')))
}

/** File input: the uploaded file's text (ManageController reads `import_file`). */
export function readFile(file: File): Promise<string> {
  return file.text()
}
