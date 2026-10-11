import type { BrowseForeignersResponse } from '@bettermyadmin/contracts'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

/**
 * "Browse foreign values" (`#browseForeignModal`): search on key or display column, pages of
 * MaxRows, both halves of the table sorted independently (by key / by description), click to use.
 * pma: src/BrowseForeigners.php, templates/table/browse_foreigners/*.twig, js/sql.ts::browseForeignDialog
 */
export function ForeignBrowser({
  server,
  db,
  table,
  field,
  data,
  onPick,
  onClose,
}: {
  server: number
  db: string
  table: string
  field: string
  /** the current value (shown in bold) */
  data: string
  onPick: (key: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [applied, setApplied] = useState({ filter: '', pos: 0, showAll: false })
  const req = { field, data, ...applied }
  const q = useQuery({
    queryKey: qk.browseForeigners({ server, db, table }, req),
    queryFn: () => api.browseForeigners({ server, db, table }, req),
    placeholderData: (prev) => prev,
  })
  const r = q.data
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" id="browseForeignModal" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('Browse foreign values')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form
            id="browse_foreign_form"
            className="mb-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              // a changed filter starts again on the first page
              setApplied((a) => ({ filter, pos: filter !== a.filter ? 0 : a.pos, showAll: false }))
            }}
          >
            <Label htmlFor="input_foreign_filter">{t('Search:')}</Label>
            <Input
              id="input_foreign_filter"
              name="foreign_filter"
              className="w-56"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Button type="submit" variant="primary" name="submit_foreign_filter">
              {t('Go')}
            </Button>
            {r !== undefined && r.rows !== null && r.total > r.maxRows && (
              <PageSelector r={r} onPos={(pos) => setApplied((a) => ({ ...a, filter, pos }))} />
            )}
            {r?.showAllButton === true && (
              <Button name="foreign_showAll" onClick={() => setApplied((a) => ({ ...a, showAll: true }))}>
                {t('Show all')}
              </Button>
            )}
          </form>
          <table className="w-full border-collapse text-[13px]" id="browse_foreign_table">
            {r?.rows !== null && r?.rows !== undefined && (
              <>
                <thead>
                  <Header />
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                    <Fragment key={i}>
                      {row.header && <Header />}
                      <tr className="odd:bg-bg-subtle hover:bg-bg-inset">
                        <Cell e={row.left} nowrap onPick={onPick} />
                        <Cell e={row.left} onPick={onPick} />
                        <td className="w-1/5" />
                        <Cell e={row.right} onPick={onPick} />
                        <Cell e={row.right} nowrap onPick={onPick} />
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <Header />
                </tfoot>
              </>
            )}
          </table>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function Header() {
  return (
    <tr className="border-b border-border">
      <th className="px-2 py-1 text-start">{t('Keyname')}</th>
      <th className="px-2 py-1 text-start">{t('Description')}</th>
      <td className="w-1/5" />
      <th className="px-2 py-1 text-start">{t('Description')}</th>
      <th className="px-2 py-1 text-start">{t('Keyname')}</th>
    </tr>
  )
}

/** column_element.twig */
function Cell({
  e,
  nowrap = false,
  onPick,
}: {
  e: { key: string; description: string; title: string; selected: boolean }
  nowrap?: boolean
  onPick: (k: string) => void
}) {
  const link = (
    <Button
      variant="link"
      className="foreign_value h-auto font-normal"
      data-key={e.key}
      title={`${t('Use this value')}${e.title !== '' ? `: ${e.title}` : ''}`}
      onClick={() => onPick(e.key)}
    >
      {nowrap ? e.key : e.description}
    </Button>
  )
  return (
    <td className={`px-2 py-1 ${nowrap ? 'whitespace-nowrap' : ''}`}>
      {e.selected ? <strong>{link}</strong> : link}
    </td>
  )
}

/** Util::pageselector('pos', MaxRows, …, 'Page number:') */
function PageSelector({ r, onPos }: { r: BrowseForeignersResponse; onPos: (pos: number) => void }) {
  const pages = Math.ceil(r.total / r.maxRows)
  return (
    <span className="flex items-center gap-1">
      <Label htmlFor="foreign_pos">{t('Page number:')}</Label>
      <NativeSelect
        id="foreign_pos"
        name="pos"
        value={String(r.pos)}
        onChange={(e) => onPos(Number(e.target.value))}
      >
        {Array.from({ length: pages }, (_, i) => i * r.maxRows).map((pos) => (
          <option key={pos} value={String(pos)}>
            {pos / r.maxRows + 1}
          </option>
        ))}
      </NativeSelect>
    </span>
  )
}
