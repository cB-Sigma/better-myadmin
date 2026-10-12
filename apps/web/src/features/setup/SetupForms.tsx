import type { PrefsFormSet, SetupSaveResponse } from '@bettermyadmin/contracts'
import { Loading, MessageBox, buttonVariants } from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { ConfigForm, FormErrors, useConfigForm } from '../preferences/ConfigForm.tsx'
import type { FormValues } from '../preferences/configForm.ts'
import { SetupError } from './OverviewPage'
import { SetupLayout } from './SetupLayout'

/**
 * A setup form set (Features, SQL queries, …).
 * pma: src/Controllers/Setup/FormController.php, resources/templates/setup/form/index.twig
 */
export function SetupFormPage({ formset }: { formset: string }) {
  const q = useQuery({ queryKey: qk.setupForm(formset), queryFn: () => api.setupForm(formset) })
  if (q.isError) return <SetupError error={q.error} />
  if (q.data === undefined) return <Loading className="p-4" />
  return (
    <SetupLayout pages={q.data.pages} formset={formset}>
      <h2 className="mb-3 text-lg font-semibold">{q.data.name}</h2>
      <SetupFormBody
        key={q.dataUpdatedAt}
        formSet={q.data.formSet}
        save={(values) => api.saveSetupForm(formset, { values })}
        revert={() => api.revertSetupForm(formset)}
        editLink={{ to: '/setup/form/$formset', params: { formset } }}
      />
    </SetupLayout>
  )
}

/**
 * Add / edit a server (the five Servers tabs).
 * pma: src/Controllers/Setup/ServersController.php, resources/templates/setup/servers/index.twig
 */
export function SetupServerPage({ id }: { id: number }) {
  const q = useQuery({ queryKey: qk.setupServer(id), queryFn: () => api.setupServer(id) })
  if (q.isError) return <SetupError error={q.error} />
  if (q.data === undefined) return <Loading className="p-4" />
  const d = q.data
  return (
    <SetupLayout pages={d.pages} formset="">
      <h2 className="mb-3 text-lg font-semibold">
        {id > 0 ? (
          <>
            {t('Edit server')} {d.serverId} <small className="text-fg-muted">({d.dsn})</small>
          </>
        ) : (
          t('Add a new server')
        )}
      </h2>
      <SetupFormBody
        key={q.dataUpdatedAt}
        formSet={d.formSet}
        save={(values) => api.saveSetupServer(id, { values })}
        revert={() => api.revertSetupServer(id)}
        editLink={{ to: '/setup/servers/$id', params: { id: String(id) } }}
        newServerLink={(serverId) => ({ to: '/setup/servers/$id', params: { id: String(serverId) } })}
        ajax
      />
    </SetupLayout>
  )
}

type EditLink = { to: string; params: Record<string, string> }

/**
 * The form, then after a submit: back to the overview, the form again (missing data) or the
 * "Submitted form contains errors" page with revert / ignore / show form.
 * pma: resources/templates/setup/error.twig
 */
function SetupFormBody(props: {
  formSet: PrefsFormSet
  save: (values: Record<string, string>) => Promise<SetupSaveResponse>
  revert: () => Promise<unknown>
  editLink: EditLink
  /** a new server saved with errors is edited under its new id */
  newServerLink?: (serverId: number) => EditLink
  /** the setup script's AJAX validators (Server, Server_pmadb, hide_db, TrustedProxies) */
  ajax?: boolean
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [shown, setShown] = useState<PrefsFormSet>(props.formSet)
  const [errors, setErrors] = useState<SetupSaveResponse | null>(null)
  const [revision, setRevision] = useState(0)
  const save = useMutation({
    mutationFn: props.save,
    onSuccess: async (r) => {
      if (r.saved) {
        await qc.invalidateQueries({ queryKey: qk.setup })
        await navigate({ to: '/setup' })
        return
      }
      // the page is not refetched (a refetch would remount this form): the overview is stale only
      void qc.invalidateQueries({ queryKey: qk.setupOverview(false) })
      if (r.formSet !== undefined) {
        setShown(r.formSet)
        setRevision((n) => n + 1)
      } else setErrors(r)
    },
  })
  const revert = useMutation({
    mutationFn: props.revert,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.setup })
      await navigate({ to: '/setup' })
    },
  })

  if (errors !== null) {
    const link =
      errors.serverId !== undefined && props.newServerLink !== undefined
        ? props.newServerLink(errors.serverId)
        : props.editLink
    return (
      <>
        <MessageBox type="error">
          <h4 className="font-semibold">{t('Warning')}</h4>
          <p>{t('Submitted form contains errors')}</p>
          <p>
            {/* biome-ignore lint/a11y/useValidAnchor: setup/error.twig links to mode=revert */}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                revert.mutate()
              }}
            >
              {t('Try to revert erroneous fields to their default values')}
            </a>
          </p>
        </MessageBox>
        <FormErrors title="" list={errors.errors ?? []} />
        <div className="flex gap-2">
          <Link to="/setup" className={buttonVariants()}>
            {t('Ignore errors')}
          </Link>
          <Link
            to={link.to}
            params={link.params}
            className={buttonVariants()}
            onClick={() => setErrors(null)}
          >
            {t('Show form')}
          </Link>
        </div>
      </>
    )
  }
  return (
    <>
      {save.isError && <MessageBox {...errorMessage(save.error)} />}
      <FormState key={revision} formSet={shown} ajax={props.ajax === true} onSubmit={(v) => save.mutate(v)} />
    </>
  )
}

/** The AJAX validators of resources/js/setup/scripts.ts (window.validators). */
const FIELD_AJAX = /^(Servers-\d+-hide_db|TrustedProxies)$/

function FormState({
  formSet,
  ajax,
  onSubmit,
}: { formSet: PrefsFormSet; ajax: boolean; onSubmit: (v: Record<string, string>) => void }) {
  const validate = async (id: string, data: Record<string, unknown>) => {
    const r = await api.setupValidate(id, data).catch(() => null)
    if (r === null || 'success' in r) return
    state.displayErrors(r as Record<string, string[]>)
  }
  const onChange = (fieldId: string, values: FormValues) => {
    if (!ajax) return
    const value = values[fieldId]
    if (FIELD_AJAX.test(fieldId) && value !== '') {
      void validate(fieldId.startsWith('Servers') ? 'Servers/1/hide_db' : 'TrustedProxies', {
        [fieldId]: value,
      })
      return
    }
    // the fieldset validators: Server for the server tabs, Server_pmadb when a pmadb is set
    const form = formSet.forms.find((f) => f.items.some((i) => i.kind === 'field' && i.field.id === fieldId))
    if (form === undefined) return
    if (form.name === 'Server_pmadb') {
      const pmadb = Object.entries(values).find(([k]) => /^Servers-\d+-pmadb$/.test(k))?.[1]
      if (pmadb !== '' && pmadb !== undefined) void validate('Server_pmadb', values)
    } else if (form.name === 'Server') void validate('Server', values)
  }
  const state = useConfigForm(formSet, false, onChange)
  // the overview's links open a form with `#<form name>`
  const [tab, setTab] = useState(() => window.location.hash.replace(/^#/, ''))
  return <ConfigForm state={state} showButtons isSetup onSubmit={onSubmit} tab={tab} onTab={setTab} />
}
