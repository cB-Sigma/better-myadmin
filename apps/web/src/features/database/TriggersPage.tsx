import type { SqlMessage, TriggerEditorData } from '@bettermyadmin/contracts'
import { Button, Input, MySqlDocLink, NativeSelect, Panel, PanelBody } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { path, DbModal, DefinitionEditor, Messages, errorMessage, tableBase } from './common'
import { EditorFooter, EditorRow, ProgramListPage, RowAction } from './programs'

/**
 * Triggers of a database (with the Table column) or of one table (`table`).
 * pma: templates/triggers/{list,row,editor_form}.twig, resources/js/triggers.ts
 */
export function TriggersPage({ server, db, table = '' }: { server: number; db: string; table?: string }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: qk.dbPage({ server, db }, 'triggers', { table }),
    queryFn: () => api.dbTriggers({ server, db }, table),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [editor, setEditor] = useState<{ trigger: TriggerEditorData; original: string | null } | null>(null)
  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  const dbLevel = table === ''

  const open = async (name?: string) => {
    try {
      setEditor(
        name === undefined
          ? {
              trigger: {
                name: '',
                table: dbLevel ? (d.tables[0] ?? '') : table,
                timing: 'BEFORE',
                event: 'INSERT',
                definition: '',
                definer: '',
              },
              original: null,
            }
          : { trigger: await api.dbTriggerEditor({ server, db }, table, name), original: name },
      )
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  return (
    <>
      <ProgramListPage
        server={server}
        db={db}
        table={table}
        icon="b_triggers"
        title={t('Triggers')}
        docLink="TRIGGERS"
        headers={[
          t('Name'),
          ...(dbLevel ? [t('Table')] : []),
          pgettext('Trigger action time', 'Time'),
          t('Event'),
        ]}
        actionCols={3}
        tableId="triggersTable"
        canCreate={d.canCreate}
        createIcon="b_trigger_add"
        createLabel={t('Create new trigger')}
        onCreate={() => void open()}
        empty={t('There are no triggers to display.')}
        messages={messages}
        setMessages={setMessages}
        onExport={(name) => api.dbTriggerExport({ server, db }, table, name)}
        items={d.items.map((tg) => ({
          name: tg.name,
          dropSql: tg.dropSql,
          exportable: true,
          cells: [
            ...(dbLevel
              ? [
                  <Link key="table" to={path(`${tableBase(server, db, tg.table)}/triggers`)}>
                    {tg.table}
                  </Link>,
                ]
              : []),
            tg.timing,
            tg.event,
          ],
          actions: [
            <RowAction
              key="edit"
              icon="b_edit"
              text={t('Edit')}
              className="edit_anchor"
              onClick={() => void open(tg.name)}
            />,
          ],
        }))}
      />
      {editor !== null && (
        <TriggerEditor
          server={server}
          codemirror={q.data?.codemirror ?? false}
          tables={d.tables}
          initial={editor.trigger}
          editMode={editor.original !== null}
          onClose={() => setEditor(null)}
          onSave={async (body) => {
            try {
              const r = await api.dbTriggerSave({ server, db }, table, {
                ...body,
                ...(editor.original !== null ? { originalName: editor.original } : {}),
              })
              if (r.messages[0]?.type === 'error') return r.messages
              setMessages(r.messages)
              setEditor(null)
              await qc.invalidateQueries({ queryKey: qk.db({ server, db }) })
              return null
            } catch (e) {
              return [errorMessage(e)]
            }
          }}
        />
      )}
    </>
  )
}

function TriggerEditor({
  server,
  codemirror,
  tables,
  initial,
  editMode,
  onClose,
  onSave,
}: {
  server: number
  codemirror: boolean
  tables: string[]
  initial: TriggerEditorData
  editMode: boolean
  onClose: () => void
  onSave: (body: TriggerEditorData) => Promise<SqlMessage[] | null>
}) {
  const [tg, setTg] = useState(initial)
  const [errors, setErrors] = useState<SqlMessage[]>([])
  const set = (p: Partial<TriggerEditorData>) => setTg({ ...tg, ...p })
  const save = async () => {
    if (tg.name === '' || tg.definition === '') {
      setErrors([{ type: 'error', text: t('Missing value in the form!') }])
      return
    }
    const r = await onSave(tg)
    if (r !== null) setErrors(r)
  }
  return (
    <DbModal
      id="triggersEditorModal"
      title={editMode ? t('Edit') : t('Create new trigger')}
      wide
      onClose={onClose}
      footer={<EditorFooter onClose={onClose} onSave={() => void save()} />}
    >
      <Messages messages={errors} />
      <div className="mb-2 font-semibold">
        {t('Details')} {!editMode && <MySqlDocLink link="CREATE_TRIGGER" />}
      </div>
      {/* editor_form.twig: the fields sit in a card headed "Details" */}
      <Panel title={t('Details')}>
        <PanelBody>
          <table className="rte_table w-full text-sm">
            <tbody>
              <EditorRow label={t('Trigger name')}>
                <Input
                  name="item_name"
                  maxLength={64}
                  value={tg.name}
                  onChange={(x) => set({ name: x.target.value })}
                />
              </EditorRow>
              <EditorRow label={t('Table')}>
                <NativeSelect
                  name="item_table"
                  value={tg.table}
                  onChange={(x) => set({ table: x.target.value })}
                >
                  {tables.map((tb) => (
                    <option key={tb} value={tb}>
                      {tb}
                    </option>
                  ))}
                </NativeSelect>
              </EditorRow>
              <EditorRow label={pgettext('Trigger action time', 'Time')}>
                <NativeSelect
                  name="item_timing"
                  value={tg.timing}
                  onChange={(x) => set({ timing: x.target.value })}
                >
                  {['BEFORE', 'AFTER'].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </EditorRow>
              <EditorRow label={t('Event')}>
                <NativeSelect
                  name="item_event"
                  value={tg.event}
                  onChange={(x) => set({ event: x.target.value })}
                >
                  {['INSERT', 'UPDATE', 'DELETE'].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </EditorRow>
              <EditorRow label={t('Definition')}>
                <DefinitionEditor
                  label={t('Definition')}
                  value={tg.definition}
                  onChange={(v) => set({ definition: v })}
                  codemirror={codemirror}
                />
                <Button
                  id="format"
                  className="mt-1"
                  onClick={() =>
                    void api.sqlFormat(server, tg.definition, false).then((f) => set({ definition: f.sql }))
                  }
                >
                  {t('Format')}
                </Button>
              </EditorRow>
              <EditorRow label={t('Definer')}>
                <Input
                  name="item_definer"
                  value={tg.definer}
                  onChange={(x) => set({ definer: x.target.value })}
                />
              </EditorRow>
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    </DbModal>
  )
}
