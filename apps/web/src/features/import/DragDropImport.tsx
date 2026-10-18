import type { ImportResult } from '@bettermyadmin/contracts'
import { MessageBox, Modal, PmaIcon, SafeHtml, useUiSettings } from '@bettermyadmin/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useConfig } from '../../lib/config'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { ErrorCard } from '../sql/SqlMessage'

const ALLOWED = ['sql', 'xml', 'ldi', 'mediawiki', 'shp']
const COMPRESSED = ['gz', 'bz2', 'zip']

/** DragDropImport.getExtension: the import format of a dropped file name, '' when not accepted */
export function dropExtension(name: string): string {
  const arr = name.split('.')
  let ext = arr[arr.length - 1] ?? ''
  if (COMPRESSED.includes(ext.toLowerCase())) ext = arr[arr.length - 2] ?? ''
  return ALLOWED.includes(ext.toLowerCase()) ? ext : ''
}

/**
 * DragDropImport.hasFiles: a real file drag from the operating system. (phpMyAdmin's check returns
 * false for every drag without `application/x-moz-nativeimage`, which disables the feature outside
 * Firefox; BetterMyAdmin applies the intended test: such a type marks a browser-internal image drag.)
 */
export function isFileDrag(types: readonly string[], internal: boolean): boolean {
  if (internal || !types.includes('Files')) return false
  if (types.includes('application/x-moz-file')) return true
  if (types.includes('application/x-moz-nativeimage')) return false
  return !types.includes('text/uri-list') && !types.includes('text/html')
}

interface Upload {
  hash: number
  name: string
  size: number
  ext: string
  percent: number
  state: 'live' | 'success' | 'failed' | 'aborted' | 'invalid'
  result?: ImportResult
}

const failed = (r: ImportResult) =>
  r.error !== undefined || r.message?.type === 'error' || (r.statements ?? []).some((s) => s.kind === 'error')

/**
 * Drag and drop import on any page (`.pma_drop_handler`, `.pma_sql_import_status`): each dropped
 * file is imported into the current database with the drop defaults.
 * pma: resources/js/drag_drop_import.ts, resources/templates/navigation/main.twig
 */
export function DragDropImport({ server }: { server: number }) {
  const cfg = useConfig()
  const ui = useUiSettings()
  const qc = useQueryClient()
  const params = useParams({ strict: false }) as { db?: string }
  const db = params.db ?? ''
  const [over, setOver] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [statusOpen, setStatusOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [shown, setShown] = useState<Upload | null>(null)
  const internal = useRef(false)
  const count = useRef(0)
  const enabled = cfg.enable_drag_drop_import

  useEffect(() => {
    if (!enabled) return
    const blocked = () => document.querySelector('.noDragDrop') !== null
    const types = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])]
    const onEnter = (e: DragEvent) => {
      if (blocked()) return
      e.stopPropagation()
      e.preventDefault()
      if (!isFileDrag(types(e), internal.current)) return
      setOver(true)
    }
    const onStart = (e: DragEvent) => {
      if (types(e).includes('Files')) return
      internal.current = true
    }
    const onEnd = () => {
      internal.current = false
    }
    const onDrop = (e: DragEvent) => {
      if (blocked()) return
      e.stopPropagation()
      e.preventDefault()
      const files = isFileDrag(types(e), internal.current) ? [...(e.dataTransfer?.files ?? [])] : []
      internal.current = false
      setOver(false)
      if (db === '' || files.length === 0) return
      setStatusOpen(true)
      for (const file of files) {
        const ext = dropExtension(file.name)
        const hash = ++count.current
        const u: Upload = {
          hash,
          name: file.name,
          size: file.size,
          ext,
          percent: 2,
          state: ext === '' ? 'invalid' : 'live',
        }
        setUploads((list) => [...list, u])
        if (ext !== '') void send(u, file)
      }
    }
    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragover', onEnter)
    document.addEventListener('dragstart', onStart)
    document.addEventListener('dragend', onEnd)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragover', onEnter)
      document.removeEventListener('dragstart', onStart)
      document.removeEventListener('dragend', onEnd)
      document.removeEventListener('drop', onDrop)
    }
  })

  const update = (hash: number, patch: Partial<Upload>) =>
    setUploads((list) => list.map((x) => (x.hash === hash ? { ...x, ...patch } : x)))

  // the request of each live upload, for its cancel link (jqXHR.abort())
  const aborts = useRef(new Map<number, AbortController>())
  const send = async (u: Upload, file: File) => {
    const abort = new AbortController()
    aborts.current.set(u.hash, abort)
    try {
      const id = await api.importUpload(
        server,
        file,
        (sent) => update(u.hash, { percent: file.size === 0 ? 100 : Math.ceil((sent / file.size) * 100) }),
        undefined,
        abort.signal,
      )
      const pairs: Array<[string, string]> = [
        ['db', db],
        ['import_type', 'database'],
        ['charset_of_file', 'utf-8'],
        ['allow_interrupt', 'yes'],
        ['skip_queries', '0'],
        ['format', u.ext],
        ['sql_compatibility', 'NONE'],
        ['sql_no_auto_value_on_zero', 'something'],
      ]
      const job = await api.importJob(server, pairs, { id, name: file.name })
      const result = await api.importEvents(server, job.id, () => {}, abort.signal)
      update(u.hash, { state: failed(result) ? 'failed' : 'success', result })
      void qc.invalidateQueries({ queryKey: qk.nav(server) })
    } catch (e) {
      if (abort.signal.aborted) return
      update(u.hash, {
        state: 'failed',
        result: {
          message: { type: 'error', html: e instanceof Error ? e.message : String(e) },
          reloadNavigation: false,
          db,
          table: '',
        },
      })
    } finally {
      aborts.current.delete(u.hash)
    }
  }

  if (!enabled) return null
  const live = uploads.filter((u) => u.state === 'live').length
  return (
    <>
      {over && (
        <div
          className="pma_drop_handler fixed inset-0 z-50 flex items-center justify-center bg-bg/80 text-2xl"
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOver(false)
          }}
        >
          {db === '' ? t('Select database first') : t('Drop files here')}
        </div>
      )}
      {statusOpen && (
        <div
          className="pma_sql_import_status fixed right-3 bottom-3 z-40 w-96 border border-border bg-bg shadow"
          role="status"
        >
          <h2 className="flex items-center gap-2 bg-bg-subtle px-2 py-1 text-sm">
            {t('SQL upload')} ( <span className="pma_import_count">{live}</span> )
            <span className="ms-auto" />
            <button type="button" className="minimize" onClick={() => setMinimized((m) => !m)}>
              {minimized ? '+' : '-'}
            </button>
            {live === 0 && (
              <button
                type="button"
                className="close"
                onClick={() => {
                  setStatusOpen(false)
                  setUploads([])
                }}
              >
                x
              </button>
            )}
          </h2>
          <div style={{ height: minimized ? 0 : 270, overflowY: 'auto' }}>
            <ul className="px-2 py-1 text-sm">
              {uploads.map((u) => (
                <li key={u.hash} data-hash={u.hash} className="mb-1">
                  {u.state === 'success' && <PmaIcon name="s_success" alt="" />}
                  {u.state === 'failed' && <PmaIcon name="s_error" alt="" />}
                  {(u.state === 'aborted' || u.state === 'invalid') && <PmaIcon name="s_notice" alt="" />}{' '}
                  {u.name}
                  <span className="filesize ms-2" data-filename={u.name}>
                    {u.state === 'live' ? (
                      <button
                        type="button"
                        className="pma_drop_file_status underline"
                        data-task="cancel"
                        onClick={() => {
                          aborts.current.get(u.hash)?.abort()
                          update(u.hash, { state: 'aborted' })
                        }}
                      >
                        {t('cancel')}
                      </button>
                    ) : u.state === 'success' ? (
                      <span className="pma_drop_file_status">{t('Success')}</span>
                    ) : u.state === 'failed' ? (
                      <button
                        type="button"
                        className="pma_drop_file_status underline"
                        onClick={() => setShown(u)}
                      >
                        {t('Failed')}
                      </button>
                    ) : u.state === 'aborted' ? (
                      <span className="pma_drop_file_status">{t('Aborted')}</span>
                    ) : (
                      `${(u.size / 1024).toFixed(2)} kb`
                    )}
                  </span>
                  {u.state === 'live' && (
                    <>
                      <br />
                      <progress max={100} value={u.percent} aria-label={u.name} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <Modal
        open={shown?.result !== undefined}
        onClose={() => setShown(null)}
        title={`${t('Import status')} - ${shown?.name ?? ''}`}
        id="pma_drop_result"
      >
        {shown?.result !== undefined && (
          <>
            {shown.result.message !== undefined && (
              <MessageBox type={shown.result.message.type}>
                <SafeHtml html={shown.result.message.html} />
              </MessageBox>
            )}
            {shown.result.error !== undefined && (
              <ErrorCard st={shown.result.error} env={{ versionInt: ui.serverVersion }} />
            )}
            {(shown.result.statements ?? [])
              .filter((s) => s.kind === 'error')
              .map((s) => (
                <ErrorCard key={s.sig} st={s} env={{ versionInt: ui.serverVersion }} />
              ))}
          </>
        )}
      </Modal>
    </>
  )
}
