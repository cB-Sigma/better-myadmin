import type { DbActionResponse, SqlMessage } from '@bettermyadmin/contracts'
import { Button, Checkbox, IconText, Label, useConfirm } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { HighlightedSql } from '../sql/HighlightedSql'
import { MessageBox } from '../sql/SqlMessage'
import { path, CreateTableBox, Messages, errorMessage, tableBase } from './common'

const tableClass =
  'w-auto border-collapse text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left'

/** create_tracking_version.twig: the statements, by input name, in form order and group. */
const DDL_TABLE = [
  ['alter_table', 'ALTER TABLE'],
  ['rename_table', 'RENAME TABLE'],
  ['create_table', 'CREATE TABLE'],
  ['drop_table', 'DROP TABLE'],
] as const
const DDL_VIEW = [
  ['alter_view', 'ALTER VIEW'],
  ['create_view', 'CREATE VIEW'],
  ['drop_view', 'DROP VIEW'],
] as const
const DDL_INDEX = [
  ['create_index', 'CREATE INDEX'],
  ['drop_index', 'DROP INDEX'],
] as const
const DML = [
  ['insert', 'INSERT'],
  ['update', 'UPDATE'],
  ['delete', 'DELETE'],
  ['truncate', 'TRUNCATE'],
] as const

/**
 * Database → Tracking.
 * pma: src/Controllers/Database/TrackingController.php, templates/database/tracking/tables.twig,
 *      templates/create_tracking_version.twig, resources/js/database/tracking.ts
 */
export function TrackingPage({ server, db }: { server: number; db: string }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useQuery({
    queryKey: qk.dbPage(server, db, 'tracking'),
    queryFn: () => api.dbTracking(server, db),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [tracked, setTracked] = useState<string[]>([])
  const [untracked, setUntracked] = useState<string[]>([])
  const [createFor, setCreateFor] = useState<string[] | null>(null)
  const [statements, setStatements] = useState<string[] | null>(null)

  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  const run = async (fn: () => Promise<DbActionResponse>) => {
    try {
      const r = await fn()
      setMessages(r.messages)
      setTracked([])
      setUntracked([])
      await qc.invalidateQueries({ queryKey: qk.db(server, db) })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }
  const deleteTracking = async (tables: string[], multiple: boolean) => {
    if (tables.length === 0) {
      setMessages([{ type: 'notice', text: t('No tables selected.') }])
      return
    }
    // tracking.ts: strDeleteTrackingData / strDeleteTrackingDataMultiple
    const ok = await confirm({
      title: t('Confirm'),
      question: multiple
        ? t('Delete tracking data for these tables?')
        : t('Delete tracking data for this table?'),
    })
    if (ok) await run(() => api.dbTrackingAction(server, db, { action: 'delete', tables }))
  }
  const startCreate = (tables: string[]) => {
    if (tables.length === 0) {
      setMessages([{ type: 'notice', text: t('No tables selected.') }])
      return
    }
    setMessages([])
    setCreateFor(tables)
    setStatements(
      [...DDL_TABLE, ...DDL_VIEW, ...DDL_INDEX, ...DML]
        .filter(([, s]) => d.defaultStatements.includes(s))
        .map(([n]) => n),
    )
  }

  if (createFor !== null) {
    const on = statements ?? []
    const box = (items: ReadonlyArray<readonly [string, string]>) =>
      items.map(([name, label]) => (
        <Label key={name} className="flex items-center gap-2">
          <Checkbox
            name={name}
            checked={on.includes(name)}
            onCheckedChange={(v) => setStatements(v === true ? [...on, name] : on.filter((x) => x !== name))}
          />
          {label}
        </Label>
      ))
    const submit = async () => {
      await run(() =>
        api.dbTrackingAction(server, db, {
          action: 'create-version',
          tables: createFor,
          version: '1',
          statements: on,
        }),
      )
      setCreateFor(null)
    }
    return (
      <div className="my-3">
        <div className="card mt-3 rounded-(--radius) border border-border">
          <div className="card-header border-b border-border bg-bg-subtle px-3 py-2 font-semibold">
            {createFor.length === 1 && createFor[0] !== undefined
              ? t('Create version %1$s of %2$s', 1, `${db}.${createFor[0]}`)
              : t('Create version %1$s', 1)}
          </div>
          <div className="card-body flex flex-col gap-1 p-3 text-sm">
            <p>{t('Track these data definition statements:')}</p>
            {box(DDL_TABLE)}
            <br />
            {box(DDL_VIEW)}
            <br />
            {box(DDL_INDEX)}
            <p>{t('Track these data manipulation statements:')}</p>
            {box(DML)}
          </div>
          <div className="card-footer flex gap-2 border-t border-border px-3 py-2">
            <Button variant="primary" onClick={() => void submit()}>
              {t('Create version')}
            </Button>
            <Button onClick={() => setCreateFor(null)}>{t('Cancel')}</Button>
          </div>
        </div>
      </div>
    )
  }

  if (d.noTables) {
    return (
      <div className="my-3">
        <Messages messages={messages} />
        <p>{t('No tables found in database.')}</p>
        {!d.isSystemSchema && <CreateTableBox server={server} db={db} />}
      </div>
    )
  }

  const selectAll = (all: string[], sel: string[], set: (v: string[]) => void, form: string) => (
    <Label className="flex items-center gap-2">
      <Checkbox
        id={`${form}_checkall`}
        className="checkall_box"
        title={t('Check all')}
        checked={all.length > 0 && sel.length === all.length}
        onCheckedChange={(v) => set(v === true ? all : [])}
      />
      {t('Check all')}
    </Label>
  )
  const check = (name: string, sel: string[], set: (v: string[]) => void) => (
    <Checkbox
      className="checkall"
      id={`selected_tbl_${name}`}
      aria-label={name}
      checked={sel.includes(name)}
      onCheckedChange={(v) => set(v === true ? [...sel, name] : sel.filter((x) => x !== name))}
    />
  )
  const trackedNames = d.tracked.map((v) => v.table)

  return (
    <div className="my-3">
      <Messages messages={messages} />
      {d.tracked.length > 0 && (
        <div id="tracked_tables" className="mb-4">
          <h3 className="mb-2 text-lg font-semibold">{t('Tracked tables')}</h3>
          <form id="trackedForm" onSubmit={(e) => e.preventDefault()}>
            <table id="versions" className={tableClass}>
              <thead>
                <tr className="bg-grid-header">
                  <th />
                  <th>{t('Table')}</th>
                  <th>{t('Last version')}</th>
                  <th>{t('Created')}</th>
                  <th>{t('Updated')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Action')}</th>
                  <th>{t('Show')}</th>
                </tr>
              </thead>
              <tbody>
                {d.tracked.map((v) => (
                  <tr key={v.table} className="odd:bg-grid-odd even:bg-grid-even hover:bg-grid-hover">
                    <td className="text-center">{check(v.table, tracked, setTracked)}</td>
                    <th>
                      <label htmlFor={`selected_tbl_${v.table}`}>{v.table}</label>
                    </th>
                    <td className="text-end">{v.version}</td>
                    <td>{v.created}</td>
                    <td>{v.updated}</td>
                    <td>
                      <Button
                        variant="secondary"
                        size="sm"
                        className={`toggle-container ${v.active ? 'on' : 'off'}`}
                        title={t('Click to toggle')}
                        onClick={() =>
                          void run(() =>
                            api.dbTrackingAction(server, db, {
                              action: 'toggle',
                              table: v.table,
                              version: v.version,
                              active: !v.active,
                            }),
                          )
                        }
                      >
                        {v.active ? t('active') : t('not active')}
                      </Button>
                    </td>
                    <td>
                      <Button
                        variant="link"
                        className="delete_tracking_anchor"
                        onClick={() => void deleteTracking([v.table], false)}
                      >
                        <IconText icon="b_drop" text={t('Delete tracking')} />
                      </Button>
                    </td>
                    <td className="flex gap-2">
                      <Link to={path(`${tableBase(server, db, v.table)}/tracking`)}>
                        <IconText icon="b_versions" text={t('Versions')} />
                      </Link>
                      <Link
                        to={path(
                          `${tableBase(server, db, v.table)}/tracking?report=true&version=${v.version}`,
                        )}
                      >
                        <IconText icon="b_report" text={t('Tracking report')} />
                      </Link>
                      <Link
                        to={path(
                          `${tableBase(server, db, v.table)}/tracking?snapshot=true&version=${v.version}`,
                        )}
                      >
                        <IconText icon="b_props" text={t('Structure snapshot')} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {selectAll(trackedNames, tracked, setTracked, 'trackedForm')}
              <em className="with-selected">{t('With selected:')}</em>
              <Button
                variant="link"
                className="mult_submit"
                title={t('Delete tracking')}
                onClick={() => void deleteTracking(tracked, true)}
              >
                <IconText icon="b_drop" text={t('Delete tracking')} />
              </Button>
            </div>
          </form>
        </div>
      )}
      {d.untracked.length > 0 && (
        <>
          <h3 className="mb-2 text-lg font-semibold">{t('Untracked tables')}</h3>
          <form id="untrackedForm" onSubmit={(e) => e.preventDefault()}>
            <table id="noversions" className={tableClass}>
              <thead>
                <tr className="bg-grid-header">
                  <th />
                  <th>{t('Table')}</th>
                  <th>{t('Action')}</th>
                </tr>
              </thead>
              <tbody>
                {d.untracked.map((name) => (
                  <tr key={name} className="odd:bg-grid-odd even:bg-grid-even hover:bg-grid-hover">
                    <td className="text-center">{check(name, untracked, setUntracked)}</td>
                    <th>
                      <label htmlFor={`selected_tbl_${name}`}>{name}</label>
                    </th>
                    <td>
                      <Link to={path(`${tableBase(server, db, name)}/tracking`)}>
                        <IconText icon="eye" text={t('Track table')} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {selectAll(d.untracked, untracked, setUntracked, 'untrackedForm')}
              <em className="with-selected">{t('With selected:')}</em>
              <Button
                variant="link"
                className="mult_submit"
                title={t('Track table')}
                onClick={() => startCreate(untracked)}
              >
                <IconText icon="eye" text={t('Track table')} />
              </Button>
            </div>
          </form>
        </>
      )}
      {d.log !== null && (
        <div className="mt-4 overflow-hidden rounded-(--radius) border border-border">
          <MessageBox type="notice" text={t('Database Log')} className="border-0" />
          <HighlightedSql sql={d.log} className="bg-bg-inset px-3 py-2" />
        </div>
      )}
    </div>
  )
}
