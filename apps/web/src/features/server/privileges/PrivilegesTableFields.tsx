import type { PrivilegesTable } from '@bettermyadmin/contracts'
import { N_ } from '@bettermyadmin/i18n'
import { Button, Input, NativeSelect, Panel, PanelBody, buttonVariants } from '@bettermyadmin/ui'
import { useEffect, useRef, useState } from 'react'
import { pgettext, t } from '../../../lib/i18n'
import {
  type CheckState,
  type PrivBox,
  type PrivGroup,
  initCheckAll,
  privilegesTableModel,
  toggleBox,
  toggleGroup,
  toggleOverall,
} from './privileges.ts'

/** A `.checkall_box` / `.sub_checkall_box` (checked / indeterminate as phpMyAdmin's handlers leave it). */
function CheckAll(props: {
  id: string
  className: string
  state: CheckState
  onChange: (v: boolean) => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const s = props.state
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = s.indeterminate
  }, [s.indeterminate])
  return (
    <>
      <input
        ref={ref}
        type="checkbox"
        id={props.id}
        className={props.className}
        title={t('Check all')}
        checked={s.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />{' '}
      <label htmlFor={props.id}>{props.label}</label>
    </>
  )
}

function Box(props: { box: PrivBox; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  const b = props.box
  return (
    <div className="item py-0.5">
      <input
        type="checkbox"
        className={props.className}
        name={b.name}
        id={b.id}
        value="Y"
        title={t(b.title)}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />{' '}
      <label htmlFor={b.id}>
        <code>
          <dfn title={t(b.dfnTitle ?? b.title)}>{b.label}</dfn>
        </code>
      </label>
    </div>
  )
}

/** The privilege boxes of a set of groups with their check-all boxes (see `CheckAllModel`). */
export function useGroupState(groups: PrivGroup[]) {
  const [m, setM] = useState(() => initCheckAll(groups))
  const key = (g: PrivGroup, b: PrivBox) => `${g.id}:${b.name}`
  return {
    checked: (g: PrivGroup, b: PrivBox) => m.boxes[key(g, b)] === true,
    set: (g: PrivGroup, b: PrivBox, v: boolean) => setM((s) => toggleBox(s, key(g, b), v)),
    setGroup: (g: PrivGroup, v: boolean) => setM((s) => toggleGroup(s, g.id, v)),
    setAll: (v: boolean) => setM((s) => toggleOverall(s, v)),
    overall: m.overall,
    group: (g: PrivGroup) => m.groups[g.id] ?? { checked: false, indeterminate: false },
  }
}

/** A group card (`.card` with its `.sub_checkall_box` header) */
export function GroupCard(props: { group: PrivGroup; st: ReturnType<typeof useGroupState> }) {
  const { group: g, st } = props
  return (
    <Panel
      className="mb-0 min-w-56 flex-1"
      title={
        <span className="font-normal">
          <CheckAll
            id={`checkall_${g.id}_priv`}
            className="sub_checkall_box"
            state={st.group(g)}
            onChange={(v) => st.setGroup(g, v)}
            label={t(g.label)}
          />
        </span>
      }
    >
      <PanelBody>
        {g.boxes.map((b) => (
          <Box
            key={b.name}
            box={b}
            className="checkall"
            checked={st.checked(g, b)}
            onChange={(v) => st.set(g, b, v)}
          />
        ))}
      </PanelBody>
    </Panel>
  )
}

/**
 * The privileges table at global / database / table level, with the column-privilege selects at
 * table level, resource limits and SSL at global level, and the "Update user privileges" footer.
 * pma: templates/server/privileges/privileges_table.twig (+ SslTypeToggle, SelectAllPrivileges)
 */
export function PrivilegesTableFields({ table }: { table: PrivilegesTable }) {
  const m = privilegesTableModel(table)
  const st = useGroupState(m.groups)
  const [sslType, setSslType] = useState(m.ssl?.type ?? '')
  const [tableBoxes, setTableBoxes] = useState(() =>
    Object.fromEntries(m.tableBoxes.map((b) => [b.name, b.checked])),
  )
  const selects = useRef<Record<string, HTMLSelectElement | null>>({})
  const footer = m.hasSubmit && (
    <div className="mb-3">
      <input type="hidden" name="update_privs" value="1" />
      <input
        className={buttonVariants({ variant: 'primary' })}
        type="submit"
        value={t('Update user privileges')}
      />
    </div>
  )
  if (m.variant === 'columns') {
    return (
      <>
        <input type="hidden" name="grant_count" value={m.grantCount} />
        <input type="hidden" name="column_count" value={m.columnCount} />
        <Panel
          id="fieldset_user_priv"
          title={<span data-submenu-label={t(m.submenuLabel)}>{t(m.header)}</span>}
        >
          <PanelBody>
            <p className="mb-2">
              <small>
                <em>{t('Note: MySQL privilege names are expressed in English.')}</em>
              </small>
            </p>
            <div className="flex flex-wrap gap-6">
              {m.columns.map((c) => (
                <div className="item" id={`div_item_${c.key.toLowerCase()}`} key={c.key}>
                  <label htmlFor={c.id}>
                    <code>
                      <dfn title={t(c.title)}>{c.label}</dfn>
                    </code>
                  </label>
                  <NativeSelect
                    className="resize-vertical block h-auto"
                    id={c.id}
                    name={`${c.key}_priv[]`}
                    size={8}
                    multiple
                    ref={(el) => {
                      selects.current[c.key] = el
                    }}
                    defaultValue={c.options.filter((o) => o.selected).map((o) => o.name)}
                  >
                    {c.options.map((o) => (
                      <option key={o.name} value={o.name}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <div>
                    <Button
                      variant="link"
                      id={`${c.key.toLowerCase()}_priv_all`}
                      data-select-target={`#${c.id}`}
                      onClick={() => {
                        const el = selects.current[c.key]
                        if (el !== null && el !== undefined)
                          for (const o of Array.from(el.options)) o.selected = true
                      }}
                    >
                      {t('Select all')}
                    </Button>
                  </div>
                  <em>{t('Or')}</em>{' '}
                  <label htmlFor={`checkbox_${c.key}_priv_none`}>
                    <input
                      type="checkbox"
                      name={`${c.key}_priv_none`}
                      id={`checkbox_${c.key}_priv_none`}
                      title={pgettext('None privileges', 'None')}
                    />{' '}
                    {pgettext('None privileges', 'None')}
                  </label>
                </div>
              ))}
              <div className="item">
                {m.tableBoxes.map((b) => (
                  <Box
                    key={b.name}
                    box={b}
                    checked={tableBoxes[b.name] === true}
                    onChange={(v) => setTableBoxes((s) => ({ ...s, [b.name]: v }))}
                  />
                ))}
              </div>
            </div>
          </PanelBody>
        </Panel>
        {footer}
      </>
    )
  }
  return (
    <>
      <Panel
        title={
          <span className="flex items-center gap-2" data-submenu-label={t(m.submenuLabel)}>
            {t(m.header)}
            <span className="font-normal">
              <CheckAll
                id="addUsersForm_checkall"
                className="checkall_box"
                state={st.overall}
                onChange={(v) => st.setAll(v)}
                label={t('Check all')}
              />
            </span>
          </span>
        }
      >
        <PanelBody>
          <p className="mb-2">
            <small>
              <em>{t('Note: MySQL privilege names are expressed in English.')}</em>
            </small>
          </p>
          <div className="flex flex-wrap gap-3">
            {m.groups.map((g) => (
              <GroupCard key={g.id} group={g} st={st} />
            ))}
            {m.limits !== null && (
              <Panel className="mb-0 min-w-56 flex-1" title={t('Resource limits')}>
                <PanelBody>
                  <p className="mb-2">
                    <small>
                      <em>{t('Note: Setting these options to 0 (zero) removes the limit.')}</em>
                    </small>
                  </p>
                  {m.limits.map((l) => (
                    <div className="item py-0.5" key={l.name}>
                      <label htmlFor={`text_${l.name}`}>
                        <code>
                          <dfn title={t(l.title)}>{l.label}</dfn>
                        </code>
                      </label>
                      <Input
                        type="number"
                        name={l.name}
                        id={`text_${l.name}`}
                        defaultValue={l.value}
                        title={t(l.title)}
                        className="w-32"
                      />
                    </div>
                  ))}
                </PanelBody>
              </Panel>
            )}
            {m.ssl !== null && (
              <Panel className="mb-0 min-w-72 flex-1" title="SSL">
                <PanelBody>
                  <div id="require_ssl_div">
                    {(
                      [
                        ['NONE', 'REQUIRE NONE', N_('Does not require SSL-encrypted connections.')],
                        ['ANY', 'REQUIRE SSL', N_('Requires SSL-encrypted connections.')],
                        ['X509', 'REQUIRE X509', N_('Requires a valid X509 certificate.')],
                        ['SPECIFIED', 'SPECIFIED', ''],
                      ] as const
                    ).map(([v, label, title]) => (
                      <div className="item py-0.5" key={v}>
                        <input
                          type="radio"
                          name="ssl_type"
                          id={`ssl_type_${v}`}
                          value={v}
                          {...(title !== '' ? { title: t(title) } : {})}
                          checked={v === 'NONE' ? sslType === 'NONE' || sslType === '' : sslType === v}
                          onChange={() => setSslType(v)}
                        />{' '}
                        <label htmlFor={`ssl_type_${v}`}>
                          <code>{label}</code>
                        </label>
                      </div>
                    ))}
                    <div id="specified_div" className="ps-5">
                      {(
                        [
                          [
                            'ssl_cipher',
                            'text_ssl_cipher',
                            'REQUIRE CIPHER',
                            N_('Requires that a specific cipher method be used for a connection.'),
                            m.ssl.cipher,
                          ],
                          [
                            'x509_issuer',
                            'text_x509_issuer',
                            'REQUIRE ISSUER',
                            N_('Requires that a valid X509 certificate issued by this CA be presented.'),
                            m.ssl.issuer,
                          ],
                          [
                            'x509_subject',
                            'text_x509_subject',
                            'REQUIRE SUBJECT',
                            N_('Requires that a valid X509 certificate with this subject be presented.'),
                            m.ssl.subject,
                          ],
                        ] as const
                      ).map(([name, id, label, title, value]) => (
                        <div className="item py-0.5" key={name}>
                          <label htmlFor={id}>
                            <code>{label}</code>
                          </label>
                          <Input
                            type="text"
                            name={name}
                            id={id}
                            defaultValue={value}
                            size={80}
                            title={t(title)}
                            disabled={sslType !== 'SPECIFIED'}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </PanelBody>
              </Panel>
            )}
          </div>
        </PanelBody>
      </Panel>
      <input type="hidden" name="grant_count" value={m.grantCount} />
      {footer}
    </>
  )
}
