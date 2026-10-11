import type { SqlMessage } from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  Checkbox,
  DocLink,
  IconText,
  Input,
  Label,
  MySqlDocLink,
  NativeSelect,
  Panel,
  PanelBody,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { runQuery } from '../sql/runner'
import { path, CreateTableBox, Messages, dbBase, errorMessage } from './common'

/**
 * Database → Operations.
 * pma: templates/database/operations/index.twig, resources/js/database/operations.ts
 */
export function OperationsPage({ server, db }: { server: number; db: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const q = useQuery({
    queryKey: qk.dbPage({ server, db }, 'operations'),
    queryFn: () => api.dbOperations({ server, db }),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [comment, setComment] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState(db)
  const [adjustRename, setAdjustRename] = useState<boolean | null>(null)
  const [copyTo, setCopyTo] = useState(db)
  const [what, setWhat] = useState<'structure' | 'data' | 'dataonly'>('data')
  const [copyOpts, setCopyOpts] = useState({
    createDatabase: true,
    dropIfExists: false,
    autoIncrement: true,
    addConstraints: true,
  })
  const [adjustCopy, setAdjustCopy] = useState<boolean | null>(null)
  const [switchToNew, setSwitchToNew] = useState<boolean | null>(null)
  const [collation, setCollation] = useState<string | null>(null)
  const [allTables, setAllTables] = useState(false)
  const [allColumns, setAllColumns] = useState(false)

  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  if (d.isSystemSchema) return null
  const reloadNav = () => qc.invalidateQueries({ queryKey: qk.nav(server) })
  const run = async (fn: () => Promise<{ messages: SqlMessage[] }>) => {
    try {
      const r = await fn()
      setMessages(r.messages)
      await qc.invalidateQueries({ queryKey: qk.db({ server, db }) })
      return r
    } catch (e) {
      setMessages([errorMessage(e)])
      return null
    }
  }
  const missing = () => setMessages([{ type: 'error', text: t('Missing value in the form!') }])

  const rename = async () => {
    if (renameTo === '') return missing()
    if (renameTo === db) {
      setMessages([
        { type: 'error', text: t('Cannot rename database to the same name. Change the name and try again.') },
      ])
      return
    }
    if (!(await confirm({ question: `CREATE DATABASE ${renameTo} / DROP DATABASE ${db}` }))) return
    try {
      const r = await api.dbRenameCopy({ server, db }, 'rename', {
        newName: renameTo,
        ...(d.dbCollation !== '' ? { collation: d.dbCollation } : {}),
        adjustPrivileges: adjustRename ?? d.hasAdjustPrivileges,
      })
      setMessages(r.messages)
      await reloadNav()
      if (r.messages[0]?.type === 'success') void navigate({ to: path(`${dbBase(server, r.db)}/operations`) })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const copy = async () => {
    if (copyTo === '') return missing()
    try {
      const r = await api.dbRenameCopy({ server, db }, 'copy', {
        newName: copyTo,
        ...(d.dbCollation !== '' ? { collation: d.dbCollation } : {}),
        what,
        ...copyOpts,
        adjustPrivileges: adjustCopy ?? d.hasAdjustPrivileges,
        switchToNew: switchToNew ?? d.switchToNew,
      })
      setMessages(r.messages)
      await reloadNav()
      if (r.db !== db) void navigate({ to: path(`${dbBase(server, r.db)}/operations`) })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const drop = async () => {
    const sql = `DROP DATABASE \`${db}\``
    const ok = await confirm({
      question: `${t('You are about to DESTROY a complete database!')} ${t('Do you really want to execute "%s"?', sql)}`,
      destructive: true,
    })
    if (!ok) return
    try {
      const r = await runQuery(server, { sql, db }, 'page')
      const err = r.statements.find((s) => s.kind === 'error')
      if (err !== undefined) {
        setMessages([{ type: 'error', text: err.message?.text ?? '', sql }])
        return
      }
      await reloadNav()
      void navigate({ to: path(`/s/${server}/databases`) })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const insufficient = t(
    "You don't have sufficient privileges to perform this operation; Please refer to the documentation for more details.",
  )
  const adjustBox = (id: string, value: boolean | null, set: (v: boolean) => void) => (
    <Label className="flex items-center gap-2" title={d.hasAdjustPrivileges ? undefined : insufficient}>
      <Checkbox
        id={id}
        checked={value ?? d.hasAdjustPrivileges}
        disabled={!d.hasAdjustPrivileges}
        onCheckedChange={(v) => set(v === true)}
      />
      {t('Adjust privileges')} <DocLink page="faq" anchor="faq6-39" />
    </Label>
  )
  const card = (title: ReactNode, body: ReactNode, footer: ReactNode, id?: string) => (
    <Panel title={title} className="mb-2" {...(id !== undefined ? { id } : {})}>
      <PanelBody>{body}</PanelBody>
      {footer !== null && <div className="flex justify-end border-t border-border px-3 py-2">{footer}</div>}
    </Panel>
  )
  const go = (onClick: () => void, name?: string) => (
    <Button variant="primary" onClick={onClick} {...(name !== undefined ? { name } : {})}>
      {t('Go')}
    </Button>
  )
  const collationValue = collation ?? d.dbCollation

  return (
    <div className="container my-3 max-w-4xl">
      <h2 className="mb-3 text-lg font-semibold">{t('Database operations')}</h2>
      <Messages messages={messages} />
      {d.storageNotice !== null && (
        <Alert variant={d.storageNotice.type === 'error' ? 'error' : 'notice'} className="mb-3">
          {d.storageNotice.text.split(/%s/).map((part, i) =>
            i === 1 ? (
              <Link key={part} to={path(`/s/${server}/check-relations`)} search={{ db } as never}>
                {part}
              </Link>
            ) : (
              part
            ),
          )}
        </Alert>
      )}
      {d.hasComment &&
        card(
          <IconText icon="b_edit" text={t('Database comment')} forceText />,
          <Input
            id="databaseCommentInput"
            aria-label={t('Database comment')}
            className="max-w-80"
            value={comment ?? d.comment}
            onChange={(e) => setComment(e.target.value)}
          />,
          go(
            () =>
              void run(() => api.dbOperation({ server, db }, 'comment', { comment: comment ?? d.comment })),
          ),
          'formDatabaseComment',
        )}
      <CreateTableBox server={server} db={db} />
      {db !== 'mysql' &&
        card(
          <IconText icon="b_edit" text={t('Rename database to')} forceText />,
          <div className="flex flex-col gap-3">
            <Input
              id="new_db_name"
              aria-label={t('New database name')}
              className="max-w-80"
              maxLength={64}
              required
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
            />
            {adjustBox('checkbox_adjust_privileges', adjustRename, setAdjustRename)}
          </div>,
          go(() => void rename()),
          'rename_db_form',
        )}
      {d.isDropDatabaseAllowed &&
        card(
          <IconText icon="b_drop" text={t('Remove database')} forceText />,
          <div className="flex items-center gap-1">
            <Button variant="link" id="drop_db_anchor" className="text-error" onClick={() => void drop()}>
              {t('Drop the database (DROP)')}
            </Button>
            <MySqlDocLink link="DROP_DATABASE" />
          </div>,
          null,
        )}
      {card(
        <IconText icon="b_edit" text={t('Copy database to')} forceText />,
        <div className="flex flex-col gap-2">
          <Input
            id="renameDbNameInput"
            aria-label={t('Database name')}
            className="mb-2 max-w-80"
            maxLength={64}
            required
            value={copyTo}
            onChange={(e) => setCopyTo(e.target.value)}
          />
          <div className="mb-2 flex flex-col gap-1">
            {(
              [
                ['structure', t('Structure only')],
                ['data', t('Structure and data')],
                ['dataonly', t('Data only')],
              ] as const
            ).map(([v, label], i) => (
              <Label key={v} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="what"
                  id={`whatRadio${i + 1}`}
                  value={v}
                  checked={what === v}
                  onChange={() => setWhat(v)}
                />
                {label}
              </Label>
            ))}
          </div>
          {(
            [
              [
                'createDatabase',
                'checkbox_create_database_before_copying',
                t('CREATE DATABASE before copying'),
              ],
              ['dropIfExists', 'checkbox_drop', t('Add %s', 'DROP TABLE / DROP VIEW')],
              ['autoIncrement', 'checkbox_auto_increment', t('Add AUTO_INCREMENT value')],
              ['addConstraints', 'checkbox_constraints', t('Add constraints')],
            ] as const
          ).map(([k, id, label]) => (
            <Label key={k} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={copyOpts[k]}
                onCheckedChange={(v) => setCopyOpts({ ...copyOpts, [k]: v === true })}
              />
              {label}
            </Label>
          ))}
          {adjustBox('checkbox_privileges', adjustCopy, setAdjustCopy)}
          <Label className="flex items-center gap-2">
            <Checkbox
              id="checkbox_switch"
              checked={switchToNew ?? d.switchToNew}
              onCheckedChange={(v) => setSwitchToNew(v === true)}
            />
            {t('Switch to copied database')}
          </Label>
        </div>,
        go(() => void copy(), 'submit_copy'),
        'copy_db_form',
      )}
      {card(
        <IconText icon="s_asci" text={t('Collation')} forceText />,
        <div className="flex flex-col gap-2">
          <NativeSelect
            id="select_db_collation"
            name="db_collation"
            aria-label={t('Collation')}
            lang="en"
            dir="ltr"
            className="mb-2 max-w-80"
            value={collationValue}
            onChange={(e) => setCollation(e.target.value)}
          >
            <option value="" />
            {d.charsets.map((cs) => (
              <optgroup key={cs.name} label={cs.name} title={cs.description}>
                {cs.collations.map((c) => (
                  <option key={c.name} value={c.name} title={c.description}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          <Label className="flex items-center gap-2">
            <Checkbox
              id="checkbox_change_all_tables_collations"
              checked={allTables}
              onCheckedChange={(v) => setAllTables(v === true)}
            />
            {t('Change all tables collations')}
          </Label>
          {/* operations.ts: shown once "Change all tables collations" is clicked */}
          {allTables && (
            <Label className="flex items-center gap-2" id="span_change_all_tables_columns_collations">
              <Checkbox
                id="checkbox_change_all_tables_columns_collations"
                checked={allColumns}
                onCheckedChange={(v) => setAllColumns(v === true)}
              />
              {t('Change all tables columns collations')}
            </Label>
          )}
        </div>,
        go(
          () =>
            void run(() =>
              api.dbOperation({ server, db }, 'collation', {
                collation: collationValue,
                changeAllTables: allTables,
                changeAllColumns: allTables && allColumns,
              }),
            ),
        ),
        'change_db_charset_form',
      )}
    </div>
  )
}
