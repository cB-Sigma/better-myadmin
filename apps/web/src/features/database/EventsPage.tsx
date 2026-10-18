import type { EventEditorData, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  Input,
  MySqlDocLink,
  NativeSelect,
  Panel,
  PanelBody,
  Textarea,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { runQuery } from '../sql/runner'
import { DbModal, DefinitionEditor, Messages, errorMessage } from './common'
import { EditorFooter, EditorRow, ProgramListPage, RowAction } from './programs'

/**
 * Database → Events.
 * pma: templates/events/{index,row,editor-form}.twig, resources/js/events.ts
 */
const STATUSES = ['ENABLED', 'DISABLED', 'SLAVESIDE_DISABLED']
const INTERVALS = [
  'YEAR',
  'QUARTER',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'WEEK',
  'SECOND',
  'YEAR_MONTH',
  'DAY_HOUR',
  'DAY_MINUTE',
  'DAY_SECOND',
  'HOUR_MINUTE',
  'HOUR_SECOND',
  'MINUTE_SECOND',
]

const emptyEvent = (): EventEditorData => ({
  name: '',
  status: '',
  type: 'ONE TIME',
  executeAt: '',
  intervalValue: '',
  intervalField: '',
  starts: '',
  ends: '',
  definition: '',
  preserve: false,
  definer: '',
  comment: '',
})

export function EventsPage({
  server,
  db,
  editItem = null,
}: {
  server: number
  db: string
  /** `edit_item=1&item_name=…`: open that event's editor */
  editItem?: { name: string } | null
}) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: qk.dbPage({ server, db }, 'events'),
    queryFn: () => api.dbEvents({ server, db }),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [editor, setEditor] = useState<{ event: EventEditorData; original: string | null } | null>(null)
  const openRef = useRef<(name: string) => Promise<void>>(async () => {})
  // once, after the list has loaded (the route keys the page by db)
  const opened = useRef(false)
  useEffect(() => {
    if (editItem === null || opened.current || q.data === undefined) return
    opened.current = true
    void openRef.current(editItem.name)
  })
  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  const refresh = () => qc.invalidateQueries({ queryKey: qk.db({ server, db }) })
  // events/index.twig: the toggle is "on" only for ON (d284996d6b)
  const on = d.schedulerState === 'ON'

  const open = async (name?: string) => {
    try {
      setEditor(
        name === undefined
          ? { event: emptyEvent(), original: null }
          : { event: await api.dbEventEditor({ server, db }, name), original: name },
      )
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }
  openRef.current = open
  const toggleScheduler = async () => {
    const sql = `SET GLOBAL event_scheduler="${on ? 'OFF' : 'ON'}"`
    try {
      await runQuery(server, { sql, db }, 'page')
      setMessages([{ type: 'success', text: t('Your SQL query has been executed successfully.'), sql }])
      await refresh()
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  return (
    <>
      <ProgramListPage
        codemirror={q.data?.codemirror ?? false}
        server={server}
        db={db}
        icon="b_events"
        title={t('Events')}
        docLink="EVENTS"
        headers={[t('Name'), t('Status'), t('Type')]}
        actionCols={3}
        tableId="eventsTable"
        canCreate={d.canCreate}
        createIcon="b_event_add"
        createLabel={t('Create new event')}
        onCreate={() => void open()}
        empty={t('There are no events to display.')}
        disabledNotice={d.schedulerState === 'DISABLED' ? t('The event scheduler is disabled.') : undefined}
        messages={messages}
        setMessages={setMessages}
        onExport={(name) => api.dbEventExport({ server, db }, name)}
        items={d.items.map((e) => ({
          name: e.name,
          dropSql: e.dropSql,
          exportable: true,
          cells: [e.status, e.type],
          actions: [
            <RowAction
              key="edit"
              icon="b_edit"
              text={t('Edit')}
              className="edit_anchor"
              onClick={() => void open(e.name)}
            />,
          ],
        }))}
        after={
          <Panel title={t('Event scheduler status')} className="mt-3 max-w-md">
            <PanelBody>
              <Button
                title={t('Click to toggle')}
                className="toggleAjax"
                aria-pressed={on}
                onClick={() => void toggleScheduler()}
              >
                <span className={on ? 'font-semibold' : 'opacity-50'}>{t('ON')}</span>
                <span>/</span>
                <span className={!on ? 'font-semibold' : 'opacity-50'}>{t('OFF')}</span>
              </Button>
            </PanelBody>
          </Panel>
        }
      />
      {editor !== null && (
        <EventEditor
          server={server}
          codemirror={q.data?.codemirror ?? false}
          initial={editor.event}
          editMode={editor.original !== null}
          onClose={() => setEditor(null)}
          onSave={async (body) => {
            try {
              const r = await api.dbEventSave(
                { server, db },
                {
                  ...body,
                  ...(editor.original !== null ? { originalName: editor.original } : {}),
                },
              )
              if (r.messages[0]?.type === 'error') return r.messages
              setMessages(r.messages)
              setEditor(null)
              await refresh()
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

function EventEditor({
  server,
  codemirror,
  initial,
  editMode,
  onClose,
  onSave,
}: {
  server: number
  codemirror: boolean
  initial: EventEditorData
  editMode: boolean
  onClose: () => void
  onSave: (body: EventEditorData) => Promise<SqlMessage[] | null>
}) {
  const [e, setE] = useState(initial)
  const set = (p: Partial<EventEditorData>) => setE({ ...e, ...p })
  const recurring = e.type === 'RECURRING'
  const save = async () => {
    if (e.name === '' || e.definition === '') {
      // validate(): alert(Messages.strFormEmpty)
      window.alert(t('Missing value in the form!'))
      return
    }
    const r = await onSave(e)
    // a failed save: ajaxShowMessage(data.error, false), the editor stays open
    if (r !== null && r.length > 0) showMessage(<Messages messages={r} />, false)
  }
  return (
    <DbModal
      id="eventsEditorModal"
      title={editMode ? t('Edit') : t('Create new event')}
      wide
      onClose={onClose}
      footer={<EditorFooter onClose={onClose} onSave={() => void save()} />}
    >
      {/* editor_form.twig: the fields sit in one card headed "Details" (with its doc link) */}
      <Panel
        title={
          <>
            {t('Details')} {!editMode && <MySqlDocLink link="CREATE_EVENT" />}
          </>
        }
      >
        <PanelBody>
          <table className="rte_table w-full text-sm">
            <tbody>
              <EditorRow label={t('Event name')}>
                <Input
                  name="item_name"
                  maxLength={64}
                  value={e.name}
                  onChange={(x) => set({ name: x.target.value })}
                />
              </EditorRow>
              <EditorRow label={t('Status')}>
                <NativeSelect
                  name="item_status"
                  value={e.status}
                  onChange={(x) => set({ status: x.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </EditorRow>
              <EditorRow label={t('Event type')}>
                <NativeSelect name="item_type" value={e.type} onChange={(x) => set({ type: x.target.value })}>
                  <option value="RECURRING">RECURRING</option>
                  <option value="ONE TIME">ONE TIME</option>
                </NativeSelect>
              </EditorRow>
              <EditorRow label={t('Execute at')} hidden={recurring}>
                <Input
                  name="item_execute_at"
                  className="datetimefield"
                  value={e.executeAt}
                  onChange={(x) => set({ executeAt: x.target.value })}
                />
              </EditorRow>
              <EditorRow label={t('Execute every')} hidden={!recurring}>
                <div className="flex gap-2">
                  <Input
                    name="item_interval_value"
                    className="max-w-40"
                    value={e.intervalValue}
                    onChange={(x) => set({ intervalValue: x.target.value })}
                  />
                  <NativeSelect
                    name="item_interval_field"
                    value={e.intervalField}
                    onChange={(x) => set({ intervalField: x.target.value })}
                  >
                    {INTERVALS.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </EditorRow>
              <EditorRow label={pgettext('Start of recurring event', 'Start')} hidden={!recurring}>
                <Input
                  name="item_starts"
                  className="datetimefield"
                  value={e.starts}
                  onChange={(x) => set({ starts: x.target.value })}
                />
              </EditorRow>
              <EditorRow label={pgettext('End of recurring event', 'End')} hidden={!recurring}>
                <Input
                  name="item_ends"
                  className="datetimefield"
                  value={e.ends}
                  onChange={(x) => set({ ends: x.target.value })}
                />
              </EditorRow>
              <EditorRow label={t('Definition')}>
                <DefinitionEditor
                  label={t('Definition')}
                  value={e.definition}
                  onChange={(v) => set({ definition: v })}
                  codemirror={codemirror}
                />
                <Button
                  id="format"
                  className="mt-1"
                  onClick={() =>
                    void api.sqlFormat(server, e.definition, false).then((f) => set({ definition: f.sql }))
                  }
                >
                  {t('Format')}
                </Button>
              </EditorRow>
              <EditorRow label={t('On completion preserve')}>
                <Checkbox
                  name="item_preserve"
                  checked={e.preserve}
                  onCheckedChange={(v) => set({ preserve: v === true })}
                />
              </EditorRow>
              <EditorRow label={t('Definer')}>
                <Input
                  name="item_definer"
                  value={e.definer}
                  onChange={(x) => set({ definer: x.target.value })}
                />
              </EditorRow>
              <EditorRow label={t('Comment')}>
                <Input
                  name="item_comment"
                  maxLength={64}
                  value={e.comment}
                  onChange={(x) => set({ comment: x.target.value })}
                />
              </EditorRow>
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    </DbModal>
  )
}
