import type {
  ExportPrivilegesRequest,
  PrivGate,
  PrivItem,
  PrivMessage,
  SqlCard,
} from '@bettermyadmin/contracts'
import { Button, MessageBox, Modal, SafeHtml, Textarea, removeMessage, showMessage } from '@bettermyadmin/ui'
import { Link, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { path } from '../../../lib/paths'
import { type CardEnv, QueryCard } from '../../sql/SqlMessage'

/**
 * Pieces shared by the User accounts pages: the sub-navigation pills, the access-gate messages,
 * a message with its SQL, `<dfn>` privilege lists and the export modal.
 */

/** pma: templates/server/privileges/subnav.twig (only with the configurable-menus feature) */
export function PrivilegesSubnav({ server, isSuperUser }: { server: number; isSuperUser: boolean }) {
  const { pathname } = useLocation()
  const groups = /\/user-groups/.test(pathname)
  const pill = (active: boolean) =>
    `nav-link block rounded px-3 py-1.5 hover:no-underline ${active ? 'active bg-accent text-accent-fg' : 'text-accent hover:bg-bg-subtle'}`
  return (
    <ul className="bma-subnav nav nav-pills mb-3 flex flex-wrap gap-1 text-sm">
      <li className="nav-item">
        <Link to={path(`/s/${server}/privileges`)} className={pill(!groups)}>
          {t('User accounts overview')}
        </Link>
      </li>
      {isSuperUser && (
        <li className="nav-item">
          <Link to={path(`/s/${server}/user-groups`)} className={pill(groups)}>
            {t('User groups')}
          </Link>
        </li>
      )}
    </ul>
  )
}

/** The gate notices of PrivilegesController; returns null when the page may render. */
export function GateMessages({ gate }: { gate: PrivGate }) {
  if (gate.noPrivileges) return <MessageBox type="error" text={t('No Privileges')} />
  if (gate.notice !== null) return <MessageBox type="notice" text={gate.notice} />
  return null
}

/** A privileges action message (Generator::getMessage: the message with the SQL that ran). */
export function PrivMessageBox({
  message,
  sql,
  card,
  env,
}: {
  message: PrivMessage
  sql?: string
  /** Generator::getMessage's query card: the SQL with Edit inline / Edit / Create PHP code */
  card?: SqlCard | null | undefined
  env?: CardEnv
}) {
  if (card !== undefined && card !== null && env !== undefined && message.html !== true) {
    return <QueryCard type={message.type} text={message.text} card={card} sig="" env={env} />
  }
  if (message.html === true)
    return (
      <MessageBox type={message.type} {...(sql !== undefined && sql !== '' ? { sql } : {})}>
        <SafeHtml html={message.text} />
      </MessageBox>
    )
  return (
    <MessageBox
      type={message.type}
      text={message.text}
      {...(sql !== undefined && sql !== '' ? { sql } : {})}
    />
  )
}

/** `extractPrivInfo($row, true)` joined by `sep` inside `<code>` */
export function PrivList({ items, sep = ', ' }: { items: PrivItem[]; sep?: string }) {
  return (
    <code>
      {items.map((p, i) => (
        <span key={`${p.name}${i}`}>
          {i > 0 && sep}
          {p.title === '' ? p.name : <dfn title={p.title}>{p.name}</dfn>}
          {p.columns !== null && ` (${p.columns})`}
        </span>
      ))}
    </code>
  )
}

/**
 * `#exportPrivilegesModal`: "Loading", then the title and the grants textarea.
 * pma: templates/export_modal.twig, resources/js/server/privileges.ts::exportPrivilegesModalHandler
 */
export function useExportPrivileges(server: number) {
  const [state, setState] = useState<{ title: string; grants: string } | null>(null)
  const run = async (req: ExportPrivilegesRequest) => {
    const box = showMessage(t('Loading…'))
    try {
      const r = await api.exportPrivileges(server, req)
      removeMessage(box)
      setState(r)
    } catch (e) {
      removeMessage(box)
      showMessage(errorMessage(e).text, false, 'error')
    }
  }
  const modal = (
    <Modal
      id="exportPrivilegesModal"
      open={state !== null}
      onClose={() => setState(null)}
      title={state?.title ?? t('Loading')}
      footer={<Button onClick={() => setState(null)}>{t('Close')}</Button>}
    >
      <Textarea className="export font-mono" cols={60} rows={15} readOnly value={state?.grants ?? ''} />
    </Modal>
  )
  return { run, modal }
}
