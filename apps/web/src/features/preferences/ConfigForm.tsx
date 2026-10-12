import type { PrefsField, PrefsFormSet } from '@bettermyadmin/contracts'
import {
  Alert,
  Checkbox,
  Input,
  NativeSelect,
  NavTabs,
  Panel,
  PanelBody,
  PmaIcon,
  SafeHtml,
  Textarea,
  buttonVariants,
  cn,
} from '@bettermyadmin/ui'
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import {
  type FormValues,
  allowId,
  fieldsOf,
  initialValues,
  isDefault,
  postedValues,
  restoredValue,
  validateAll,
  validateField,
} from './configForm.ts'

/**
 * Field values and the client-side errors of a form set (resources/js/modules/config.ts).
 * `inert`: config.ts reads its defaults and validators from the page's first
 * `#configInlineParamsData`, the navigation settings' one: a page settings form other than Navi
 * gets no default marking, no restore links and no client validation.
 */
export function useConfigForm(
  formSet: PrefsFormSet,
  inert = false,
  /** after a committed change (the setup script's AJAX validators) */
  onChange?: (id: string, values: FormValues) => void,
) {
  const [values, setValues] = useState<FormValues>(() => initialValues(formSet))
  // client errors by field id; a field without an entry shows the server's inline errors
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const byId = useMemo(() => new Map(fieldsOf(formSet).map((f) => [f.id, f])), [formSet])
  return {
    formSet,
    inert,
    values,
    errors,
    /** a value typed or picked (no validation until the change event) */
    set: (id: string, v: string | boolean) => setValues((s) => ({ ...s, [id]: v })),
    /** the change event: validateFieldAndFieldset + markField */
    change: (id: string, v: string | boolean) => {
      setValues((s) => ({ ...s, [id]: v }))
      const f = byId.get(id)
      if (f !== undefined && !inert) setErrors((e) => ({ ...e, [id]: validateField(f, v) }))
      onChange?.(id, { ...values, [id]: v })
    },
    /** window.Config.displayErrors: errors by field id or form name (AJAX validation) */
    displayErrors: (e: Record<string, string[]>) => setErrors((cur) => ({ ...cur, ...e })),
    /** the Reset button: setDisplayError (its `closest('fieldset')` finds no fields to reset) */
    revalidate: () => {
      if (!inert) setErrors(validateAll(formSet, values))
    },
    posted: () => postedValues(formSet, values),
  }
}
export type ConfigFormState = ReturnType<typeof useConfigForm>

const pad = (trClass: string): string => {
  // .group-field-N th / .group-header-(N+1) th
  const m = /group-(field|header)-(\d+)/.exec(trClass)
  if (m === null) return ''
  const level = m[1] === 'field' ? Number(m[2]) : Number(m[2]) - 1
  return ['', 'ps-6', 'ps-12', 'ps-18'][Math.min(level, 3)] ?? ''
}

/**
 * A configuration form set: one `nav-tabs` tab per form, its fieldset as a table of rows, Apply /
 * Reset per tab (`showButtons`; page settings have none, the modal's Apply submits).
 * pma: resources/templates/config/form_display/display.twig, input.twig, group_header.twig
 */
export function ConfigForm({
  state,
  showButtons,
  onSubmit,
  tab,
  onTab,
  isSetup = false,
}: {
  state: ConfigFormState
  showButtons: boolean
  /** the setup script: a third column with the "Allow users to customize" checkboxes */
  isSetup?: boolean
  onSubmit: (posted: Record<string, string>) => void
  /** the active form (`tab_hash`) */
  tab?: string
  onTab?: (name: string) => void
}) {
  const forms = state.formSet.forms
  const [localTab, setLocalTab] = useState(forms[0]?.name ?? '')
  const active = tab !== undefined && forms.some((f) => f.name === tab) ? tab : localTab
  const select = (name: string) => {
    setLocalTab(name)
    onTab?.(name)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(state.posted())
  }
  return (
    <form method="post" className="config-form" onSubmit={submit}>
      <NavTabs
        id="configFormDisplayTab"
        items={forms.map((f) => ({ id: f.name, label: <SafeHtml html={f.title} as="span" /> }))}
        active={active}
        onSelect={select}
      />
      {forms.map((form) => (
        <div
          key={form.name}
          className="tab-pane"
          id={form.name}
          role="tabpanel"
          aria-labelledby={`${form.name}-tab`}
          hidden={form.name !== active}
        >
          <Panel
            className="rounded-t-none border-t-0"
            footer={
              showButtons ? (
                <span className="flex gap-2">
                  <input
                    className={buttonVariants({ variant: 'primary' })}
                    type="submit"
                    name="submit_save"
                    value={t('Apply')}
                  />
                  <input
                    className={buttonVariants()}
                    type="button"
                    name="submit_reset"
                    value={t('Reset')}
                    onClick={state.revalidate}
                  />
                </span>
              ) : undefined
            }
          >
            <PanelBody>
              <h5 className="sr-only">
                <SafeHtml html={form.title} as="span" />
              </h5>
              {form.desc !== '' && <SafeHtml html={form.desc} as="h6" className="mb-2 text-fg-muted" />}
              <fieldset className="optbox">
                {/* pmahomme: `.config-form legend { display: none; }`; the setup styles show it */}
                <legend
                  className={
                    isSetup ? 'mb-2 rounded border border-border px-2 py-0.5 font-semibold' : 'hidden'
                  }
                >
                  <SafeHtml html={form.title} as="span" />
                </legend>
                {(state.errors[form.name] ?? form.errors).length > 0 && (
                  // the form error list (`dl.errors`, window.Config.displayErrors)
                  <Alert variant="error" className="mb-3">
                    <dl className="errors">
                      {(state.errors[form.name] ?? form.errors).map((e) => (
                        <SafeHtml key={e} html={e} as="dd" />
                      ))}
                    </dl>
                  </Alert>
                )}
                <table className="w-full border-collapse text-[13px]">
                  <tbody>
                    {form.items.map((item) =>
                      item.kind === 'group' ? (
                        <tr
                          key={`g${item.group}${item.title}`}
                          className={`group-header group-header-${item.group}`}
                        >
                          <th
                            colSpan={isSetup ? 3 : 2}
                            className={cn(
                              'border-t border-border bg-bg-subtle px-2 py-1 text-left',
                              pad(`group-header-${item.group}`),
                            )}
                          >
                            {item.title}
                          </th>
                        </tr>
                      ) : (
                        <FieldRow key={item.field.id} field={item.field} state={state} isSetup={isSetup} />
                      ),
                    )}
                  </tbody>
                </table>
              </fieldset>
            </PanelBody>
          </Panel>
        </div>
      ))}
    </form>
  )
}

/** pma: resources/templates/config/form_display/input.twig */
function FieldRow({
  field,
  state,
  isSetup,
}: { field: PrefsField; state: ConfigFormState; isSetup: boolean }) {
  const value = state.values[field.id] ?? ''
  const custom = !state.inert && !isDefault(field, value)
  const errors = state.errors[field.id] ?? field.errors
  const hasErrors = errors.length > 0
  const mark = cn(custom && 'custom bg-warning-bg', hasErrors && 'field-error border-error!')
  const disabledRow = field.disabled
  const str = typeof value === 'string' ? value : ''
  // the value when the input got the focus: the change event fires when an edit is committed
  const focused = useRef(str)
  const textProps = {
    name: field.id,
    id: field.id,
    value: str,
    onChange: (e: { target: { value: string } }) => state.set(field.id, e.target.value),
    onBlur: (e: { target: { value: string } }) => {
      if (e.target.value !== focused.current) state.change(field.id, e.target.value)
    },
    onFocus: (e: { target: { value: string } }) => {
      focused.current = e.target.value
    },
  }
  let control: ReactNode = null
  switch (field.type) {
    case 'text':
    case 'password':
      control = (
        <Input
          type={field.type}
          {...textProps}
          className={cn('w-3/4!', mark)}
          {...(field.type === 'password' ? { spellCheck: false } : {})}
        />
      )
      break
    case 'short_text':
      control = <Input type="text" size={25} {...textProps} className={cn('w-auto!', mark)} />
      break
    case 'number_text':
      control = <Input type="number" {...textProps} className={cn('w-auto!', mark)} />
      break
    case 'checkbox':
      control = (
        <span
          className={cn(
            'checkbox inline-block p-0.5',
            custom && 'custom border border-warning bg-warning-bg',
            hasErrors && 'field-error',
          )}
        >
          <Checkbox
            id={field.id}
            name={field.id}
            checked={value === true}
            onCheckedChange={(c) => state.change(field.id, c === true)}
          />
        </span>
      )
      break
    case 'select':
      control = (
        <NativeSelect
          name={field.id}
          id={field.id}
          className={cn('w-3/4!', mark)}
          value={str}
          onChange={(e) => state.change(field.id, e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option
              key={o.value}
              value={o.value}
              {...(o.emptyLabel === true ? { label: `"${t('None')}"` } : {})}
            >
              {o.label}
            </option>
          ))}
        </NativeSelect>
      )
      break
    case 'list':
      control = (
        <Textarea cols={35} rows={5} spellCheck={false} {...textProps} className={cn('w-auto!', mark)} />
      )
      break
  }
  const restoreTitle = t('Restore default value')
  return (
    <tr className={cn(field.trClass, disabledRow && 'disabled-field bg-bg-subtle text-fg-muted')}>
      <th
        className={cn(
          'w-2/5 border-t border-border px-2 py-1 text-left align-top font-semibold',
          pad(field.trClass),
        )}
      >
        <label htmlFor={field.id}>
          <SafeHtml html={field.name} as="span" />
        </label>
        {field.doc !== '' && (
          <span className="doc ms-4">
            <a href={field.doc} target="documentation" rel="noopener noreferrer">
              <PmaIcon name="b_help" alt={t('Documentation')} />
            </a>
          </span>
        )}
        {disabledRow && (
          <span
            className="disabled-notice ms-4 cursor-help text-[80%] uppercase text-error"
            title={t('This setting is disabled, it will not be applied to your configuration.')}
          >
            {t('Disabled')}
          </span>
        )}
        {field.desc !== '' && (
          <SafeHtml html={field.desc} as="small" className="block text-[x-small] font-normal text-fg-muted" />
        )}
      </th>
      <td className="border-t border-border py-1 align-top">
        {control}
        {isSetup && field.comment !== undefined && (
          // input.twig: an `<a class="userprefs-comment">` without href, only its tooltip
          <span className="userprefs-comment ms-1 inline-block cursor-help" title={field.comment}>
            <PmaIcon name="b_tblops" alt={t('Comment')} />
          </span>
        )}
        {/* the setup pages never run config.ts' setupRestoreField: both links stay hidden */}
        {field.setvalue !== undefined && !isSetup && (
          <a
            className="set-value ms-1 inline-block opacity-25 hover:opacity-100"
            href={`#${field.id}=${field.setvalue}`}
            title={t('Set value: %s', field.setvalue)}
            onClick={(e) => {
              e.preventDefault()
              state.change(field.id, field.setvalue ?? '')
            }}
          >
            <PmaIcon name="b_edit" alt={t('Set value: %s', field.setvalue)} />
          </a>
        )}
        {!isSetup && (
          <a
            className="restore-default ms-1 inline-block opacity-25 hover:opacity-100"
            href={`#${field.id}`}
            title={restoreTitle}
            onClick={(e) => {
              e.preventDefault()
              state.change(field.id, restoredValue(field))
            }}
          >
            {custom && <PmaIcon name="s_reload" alt={restoreTitle} />}
          </a>
        )}
        {hasErrors && (
          <dl className="inline_errors my-1 text-xs text-error">
            {errors.map((e) => (
              <SafeHtml key={e} html={e} as="dd" />
            ))}
          </dl>
        )}
      </td>
      {isSetup &&
        (field.userprefsAllow !== undefined ? (
          <td
            className="userprefs-allow w-8 border-t border-border py-1 text-center align-top"
            title={t('Allow users to customize this value')}
          >
            <Checkbox
              name={allowId(field)}
              aria-label={t('Allow users to customize this value')}
              checked={state.values[allowId(field)] === true}
              onCheckedChange={(c) => state.set(allowId(field), c === true)}
            />
          </td>
        ) : (
          <td className="border-t border-border">&nbsp;</td>
        ))}
    </tr>
  )
}

/**
 * The red summary of a rejected save: the title and FormDisplay::displayErrors (one `dl` per field
 * or form). pma: resources/templates/preferences/forms/main.twig, config/form_display/errors.twig
 */
export function FormErrors({
  title,
  list,
}: { title: string; list: Array<{ name: string; errors: string[] }> }) {
  return (
    <Alert variant="error" className="config-form mb-3">
      <strong>{title}</strong>
      {list.map((e) => (
        <dl key={e.name}>
          <SafeHtml html={e.name} as="dt" />
          {e.errors.map((x) => (
            <SafeHtml key={x} html={x} as="dd" className="ms-2" />
          ))}
        </dl>
      ))}
    </Alert>
  )
}
