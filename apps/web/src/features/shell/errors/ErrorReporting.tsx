import type { ErrorReportResponse } from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PmaIcon,
  Textarea,
  showMessage,
} from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api.ts'
import { t, tProduct } from '../../../lib/i18n'

/**
 * JavaScript error reporting with SendErrorReports = ask | always | never.
 * pma: resources/js/error_report.ts, templates/error/report_form.twig + report_modal.twig,
 *      src/Controllers/ErrorReportController.php
 */

export interface CapturedError {
  name: string
  message: string
  stack: Array<{ func?: string; url?: string; line?: number; column?: number; context?: string[] }>
}

/** TraceKit-like normalisation of an Error. */
export function captureError(e: unknown): CapturedError {
  const err = e instanceof Error ? e : new Error(String(e))
  const frames = (err.stack ?? '')
    .split('\n')
    .slice(1)
    .map((l) => {
      const m = l.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/) ?? l.match(/^(.*?)@(.+?):(\d+):(\d+)$/)
      return m === null
        ? null
        : { func: m[1] ?? '?', url: m[2] ?? '', line: Number(m[3]), column: Number(m[4]) }
    })
    .filter((f) => f !== null)
  // extractExceptionName: "Name:" prefix of the message when the name is missing
  const name = err.name !== '' ? err.name : (err.message.match(/([a-zA-Z]+):/)?.[1] ?? '')
  return { name, message: err.message, stack: frames }
}

type Notice = { key: string; error: CapturedError }

let reportError: ((e: unknown) => void) | null = null

/** Report an error caught somewhere else (error boundary, failed async handler). */
export function reportClientError(e: unknown): void {
  reportError?.(e)
}

export function ErrorReporting({ server, setting }: { server: number; setting: 'ask' | 'always' | 'never' }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [dialog, setDialog] = useState<{ error: CapturedError; report: Record<string, unknown> } | null>(null)
  const settings = useRef<ErrorReportResponse | null>(null)
  const last = useRef('')

  const handle = useCallback(
    async (e: unknown) => {
      if (setting === 'never') return
      const error = captureError(e)
      // issue 14359: the same exception twice in a row is reported once
      const sig = JSON.stringify(error)
      if (sig === last.current) return
      last.current = sig
      try {
        settings.current ??= await api.errorReport({ exception_type: 'js', get_settings: true })
      } catch {
        return
      }
      const mode = settings.current.report_setting ?? setting
      if (mode === 'ask') {
        setNotices((n) => [...n, { key: Math.random().toString(36).substring(2, 12), error }])
      } else if (mode === 'always') {
        const r = await api
          .errorReport({
            exception_type: 'js',
            send_error_report: true,
            automatic: true,
            exception: error,
            url: location.href,
          })
          .catch(() => null)
        if (r?.message) showMessage(r.message.text, false, r.message.type === 'error' ? 'error' : null)
      }
    },
    [setting],
  )

  useEffect(() => {
    reportError = (e) => void handle(e)
    const onError = (ev: ErrorEvent) => void handle(ev.error ?? ev.message)
    const onRejection = (ev: PromiseRejectionEvent) => void handle(ev.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      reportError = null
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [handle])

  const openDialog = async (n: Notice) => {
    setNotices((all) => all.filter((x) => x.key !== n.key))
    const r = await api
      .errorReport({ exception_type: 'js', exception: n.error, url: location.href })
      .catch(() => null)
    setDialog({ error: n.error, report: r?.report ?? {} })
  }

  return (
    <>
      {notices.length > 0 && (
        <div className="fixed right-3 bottom-10 z-40 flex w-[min(40rem,calc(100vw-1.5rem))] flex-col gap-2">
          {notices.map((n) => (
            <Alert
              key={n.key}
              variant="error"
              id={`error_notification_${n.key}`}
              className="flex flex-wrap items-center gap-2 shadow"
            >
              <PmaIcon name="s_error" />
              <span className="flex-1">
                {t('A fatal JavaScript error has occurred. Would you like to send an error report?')}
              </span>
              <span className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  id={`show_error_report_${n.key}`}
                  onClick={() => void openDialog(n)}
                >
                  {t('Show report details')}
                </Button>
                <Link
                  to="/s/$server/$"
                  params={{ server, _splat: 'settings/features' }}
                  title={t('Change report settings')}
                >
                  <PmaIcon name="s_cog" alt={t('Change report settings')} />
                </Link>
                <button
                  type="button"
                  id={`ignore_error_${n.key}`}
                  title={t('Ignore')}
                  onClick={() => setNotices((all) => all.filter((x) => x.key !== n.key))}
                >
                  <PmaIcon name="b_close" alt={t('Ignore')} />
                </button>
              </span>
            </Alert>
          ))}
        </div>
      )}
      <ReportDialog value={dialog} onClose={() => setDialog(null)} allowed={setting !== 'never'} />
    </>
  )
}

function ReportDialog(props: {
  value: { error: CapturedError; report: Record<string, unknown> } | null
  onClose: () => void
  allowed: boolean
}) {
  const [description, setDescription] = useState('')
  const [always, setAlways] = useState(false)
  const send = async () => {
    const v = props.value
    props.onClose()
    if (v === null) return
    const r = await api
      .errorReport({
        exception_type: 'js',
        send_error_report: true,
        description,
        always_send: always,
        exception: v.error,
        url: location.href,
      })
      .catch(() => null)
    if (r?.message) showMessage(r.message.text, 3000)
  }
  return (
    <Dialog open={props.value !== null} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent
        size="lg"
        modal="static"
        closeLabel={t('Cancel')}
        id="errorReportModal"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('Submit error report')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {props.allowed ? (
            <form id="errorReportForm" onSubmit={(e) => e.preventDefault()} className="space-y-3">
              <p>
                {tProduct(
                  'This report automatically includes data about the error and information about relevant configuration settings. It will be sent to the phpMyAdmin team for debugging the error.',
                )}
              </p>
              <div>
                <label htmlFor="errorReportDescription">
                  <strong>
                    {t('Can you tell us the steps leading to this error? It decisively helps in debugging:')}
                  </strong>
                </label>
                <Textarea
                  id="errorReportDescription"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                {t('You may examine the data in the error report:')}
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-bg-inset p-2 font-mono text-xs">
                  {JSON.stringify(props.value?.report ?? {}, null, 4)}
                </pre>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="errorReportAlwaysSendCheckbox"
                  checked={always}
                  onCheckedChange={(c) => setAlways(c === true)}
                />
                <label htmlFor="errorReportAlwaysSendCheckbox">
                  {t('Automatically send report next time')}
                </label>
              </div>
            </form>
          ) : (
            <pre className="max-h-72 overflow-auto font-mono text-xs">
              {JSON.stringify(props.value?.report ?? {}, null, 4)}
            </pre>
          )}
        </DialogBody>
        <DialogFooter>
          {props.allowed ? (
            <>
              <Button onClick={props.onClose}>{t('Cancel')}</Button>
              <Button variant="primary" id="errorReportModalConfirm" onClick={() => void send()}>
                {t('Send error report')}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={props.onClose}>
              {t('Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Render errors inside the page keep the shell usable and go through the same report flow. */
export class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    reportClientError(error)
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) this.setState({ error: null })
  }

  override render() {
    if (this.state.error !== null) {
      return (
        <Alert variant="error">
          <PmaIcon name="s_error" /> A fatal JavaScript error has occurred. {this.state.error.message}
        </Alert>
      )
    }
    return this.props.children
  }
}
