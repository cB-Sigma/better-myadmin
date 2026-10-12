/**
 * The Designer's pages without the configuration storage's pdf pages: kept in the browser's
 * IndexedDB `pma_designer` (object stores `pdf_pages` keyed `pgNr`, `table_coords` keyed `id`),
 * like phpMyAdmin.
 * pma: resources/js/designer/database.ts (DesignerOfflineDB), resources/js/designer/page.ts,
 *      resources/js/designer/objects.ts
 */

export interface OfflinePage {
  pgNr?: number
  dbName: string
  pageDescr: string
  tblCords: number[]
}

export interface OfflineCoord {
  id?: number
  dbName: string
  tableName: string
  pdfPgNr: number
  x: number
  y: number
}

type Store = 'pdf_pages' | 'table_coords'

let datastore: Promise<IDBDatabase> | null = null

/** DesignerOfflineDB.open */
export function openOfflineDb(): Promise<IDBDatabase> {
  if (datastore !== null) return datastore
  datastore = new Promise((resolve, reject) => {
    const request = window.indexedDB.open('pma_designer', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const t of ['pdf_pages', 'table_coords'])
        if (db.objectStoreNames.contains(t)) db.deleteObjectStore(t)
      db.createObjectStore('pdf_pages', { keyPath: 'pgNr', autoIncrement: true })
      db.createObjectStore('table_coords', { keyPath: 'id', autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      datastore = null
      reject(request.error)
    }
  })
  return datastore
}

const done = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

async function store(table: Store): Promise<IDBObjectStore> {
  return (await openOfflineDb()).transaction([table], 'readwrite').objectStore(table)
}

const loadObject = async <T>(table: Store, id: number): Promise<T | undefined> =>
  done((await store(table)).get(id)) as Promise<T | undefined>
const loadAllObjects = async <T>(table: Store): Promise<T[]> =>
  done((await store(table)).getAll(IDBKeyRange.lowerBound(0))) as Promise<T[]>
const addObject = async (table: Store, obj: object): Promise<number> =>
  Number(await done((await store(table)).put(obj)))
const deleteObject = async (table: Store, id: number): Promise<void> => {
  await done((await store(table)).delete(id))
}

/** DesignerPage.createPageList: the database's pages */
export async function offlinePageList(db: string): Promise<Array<{ id: number; name: string }>> {
  const pages = await loadAllObjects<OfflinePage>('pdf_pages')
  return pages.filter((p) => p.dbName === db).map((p) => ({ id: p.pgNr ?? 0, name: p.pageDescr }))
}

/** DesignerPage.saveToNewPage */
export async function offlineSaveToNewPage(
  db: string,
  pageName: string,
  positions: Array<Omit<OfflineCoord, 'pdfPgNr' | 'id'>>,
): Promise<OfflinePage> {
  const page: OfflinePage = { dbName: db, pageDescr: pageName, tblCords: [] }
  page.pgNr = await addObject('pdf_pages', page)
  const ids: number[] = []
  for (const p of positions) ids.push(await addObject('table_coords', { ...p, pdfPgNr: page.pgNr }))
  page.tblCords = ids
  await addObject('pdf_pages', page)
  return page
}

/** DesignerPage.deletePage */
export async function offlineDeletePage(pageId: number): Promise<boolean> {
  const page = await loadObject<OfflinePage>('pdf_pages', pageId)
  if (page === undefined) return false
  for (const id of page.tblCords) await deleteObject('table_coords', id)
  await deleteObject('pdf_pages', pageId)
  return true
}

/** DesignerPage.saveToSelectedPage: the page is replaced by a new one */
export async function offlineSaveToSelectedPage(
  db: string,
  pageId: number,
  pageName: string,
  positions: Array<Omit<OfflineCoord, 'pdfPgNr' | 'id'>>,
): Promise<OfflinePage> {
  await offlineDeletePage(pageId)
  return offlineSaveToNewPage(db, pageName, positions)
}

/** DesignerPage.loadFirstPage: the page named after the database, else the first one */
export async function offlineFirstPage(db: string): Promise<OfflinePage | null> {
  let first: OfflinePage | null = null
  for (const p of await loadAllObjects<OfflinePage>('pdf_pages')) {
    if (p.dbName !== db) continue
    if (p.pageDescr === db) return p
    if (first === null) first = p
  }
  return first
}

/** DesignerPage.loadPageObjects */
export async function offlineLoadPage(
  pageId: number,
): Promise<{ page: OfflinePage; coords: OfflineCoord[] } | null> {
  const page = await loadObject<OfflinePage>('pdf_pages', pageId)
  if (page === undefined) return null
  const coords: OfflineCoord[] = []
  for (const id of page.tblCords) {
    const c = await loadObject<OfflineCoord>('table_coords', id)
    if (c !== undefined) coords.push(c)
  }
  return { page, coords }
}
