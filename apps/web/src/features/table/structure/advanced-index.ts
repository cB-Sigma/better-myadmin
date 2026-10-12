import type { FormIndex } from '@bettermyadmin/contracts'

/**
 * The indexes of the create table / add columns form, as phpMyAdmin keeps them in the browser:
 * one array per index choice (primaryColumns, uniqueColumns, …), serialised into the hidden
 * primary_indexes / unique_indexes / indexes / fulltext_indexes / spatial_indexes fields. The
 * Index select of a row only opens the dialogs; the indexes created are these.
 *
 * pma: resources/js/modules/indexes.ts (getIndexArray, addColumnToIndex, removeColumnFromIndex)
 */
export type IndexChoice = 'primary' | 'unique' | 'index' | 'fulltext' | 'spatial'

export interface DraftIndex {
  keyName: string
  comment: string
  choice: FormIndex['choice']
  keyBlockSize: string
  parser: string
  type: string
  /** col_index: the row of the form; size: the sub part */
  columns: Array<{ colIndex: number; size: string }>
}

export type IndexLists = Record<IndexChoice, DraftIndex[]>

export const emptyIndexLists = (): IndexLists => ({
  primary: [],
  unique: [],
  index: [],
  fulltext: [],
  spatial: [],
})

export const INDEX_CHOICES: readonly IndexChoice[] = ['primary', 'unique', 'index', 'fulltext', 'spatial']

/** the `data-index` of a row's Index select: "<choice>,<array index>" (empty: in no index) */
export function parseDataIndex(
  dataIndex: string | undefined,
): { choice: IndexChoice; arrayIndex: number } | null {
  if (dataIndex === undefined || dataIndex === '') return null
  const [c, n] = dataIndex.split(',')
  const choice = (c ?? '').toLowerCase() as IndexChoice
  if (!INDEX_CHOICES.includes(choice)) return null
  return { choice, arrayIndex: Number(n) }
}

/**
 * removeColumnFromIndex: drops the column from the index its select points at, and the index
 * when no column is left. (phpMyAdmin tests `previousIndex[1] in sourceArray` on the string,
 * so its removal never runs; we remove as the function intends.)
 */
export function removeColumnFromIndex(
  lists: IndexLists,
  dataIndex: string | undefined,
  colIndex: number,
): IndexLists {
  const prev = parseDataIndex(dataIndex)
  if (prev === null) return lists
  const source = lists[prev.choice]
  const index = source[prev.arrayIndex]
  if (index === undefined) return lists
  const columns = index.columns.filter((c) => c.colIndex !== colIndex)
  const next =
    columns.length === 0
      ? source.filter((_, i) => i !== prev.arrayIndex)
      : source.map((x, i) => (i === prev.arrayIndex ? { ...x, columns } : x))
  return { ...lists, [prev.choice]: next }
}

/** addColumnToIndex: creates or replaces sourceArray[arrayIndex] with the dialog's index */
export function setIndex(
  lists: IndexLists,
  choice: IndexChoice,
  arrayIndex: number,
  index: DraftIndex,
): IndexLists {
  const source = [...lists[choice]]
  source[arrayIndex] = index
  return { ...lists, [choice]: source }
}

/** The JSON fields the form posts (CreateAddField::getIndexedColumns reads the five buckets). */
export function formIndexes(lists: IndexLists): FormIndex[] {
  return INDEX_CHOICES.flatMap((c) =>
    lists[c]
      .filter((i) => i.columns.length > 0)
      .map((i) => ({
        keyName: i.keyName,
        comment: i.comment,
        choice: i.choice,
        keyBlockSize: i.keyBlockSize,
        parser: i.parser,
        type: i.type,
        columns: i.columns,
      })),
  )
}

/**
 * The name shown under each indexed row's select (the .show_index_dialog link): the index name,
 * or "[col, col]" when it has none.
 */
export function indexLabels(lists: IndexLists, names: readonly string[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const c of INDEX_CHOICES) {
    for (const i of lists[c]) {
      const label =
        i.keyName !== ''
          ? i.keyName
          : `[${i.columns
              .map((x) => names[x.colIndex] ?? '')
              .join(', ')
              .trimEnd()}]`
      for (const x of i.columns) out.set(x.colIndex, label)
    }
  }
  return out
}
