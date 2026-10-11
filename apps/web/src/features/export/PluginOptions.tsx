import type { PluginInfo, PluginOptionItem } from '@bettermyadmin/contracts'
import { DocLink, Hint, Input, MySqlDocLink, NativeSelect } from '@bettermyadmin/ui'
import { Fragment, type ReactNode } from 'react'
import { t } from '../../lib/i18n'
import { InlineHtml } from '../shell/inline-html'

/** An option label of phpMyAdmin (msgids carry `<code>`, `<i>`, `<br>` and `&nbsp;`). */
export function OptionText({ text }: { text: string }) {
  // Generator::showHint inside a label (ImportCsv "Column names:")
  const hint = /\s*<span class="pma_hint">.*?<span class="hide">(.*?)<\/span><\/span>/.exec(text)
  if (hint !== null) {
    return (
      <>
        <OptionText text={text.slice(0, hint.index)} /> <Hint message={hint[1] ?? ''} />
      </>
    )
  }
  const lines = text.replaceAll('&nbsp;', ' ').split(/<br\s*\/?>/)
  return (
    <>
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static label parts
        <Fragment key={i}>
          {i > 0 && <br />}
          <InlineHtml text={l} />
        </Fragment>
      ))}
    </>
  )
}

function Doc({ doc }: { doc: PluginOptionItem['doc'] }) {
  if (doc === undefined || doc === '') return null
  // Plugins::getDocumentationLinkHtml: a string is an FAQ anchor, an array a MySQL manual page
  if (typeof doc === 'string') return <DocLink page="faq" anchor={doc} />
  return <MySqlDocLink link={doc[0] ?? ''} {...(doc[1] !== undefined ? { anchor: doc[1] } : {})} />
}

/**
 * One plugin's format-specific options, rendered like Plugins::getOptions (ids `checkbox_<name>`,
 * `text_<name>`, `select_<name>`, `radio_<name>_<key>`, `ul_<header>` …) so behaviours keyed on
 * those ids work the same.
 * pma: src/Plugins.php::getOptions, src/Properties/Options/Items/*::getHtml
 */
export function PluginOptions({
  plugin,
  hidden,
  disabled,
  onChange,
  sectionsHidden,
  forcedOn,
}: {
  plugin: PluginInfo
  hidden: boolean
  /** controls disabled by the page's behaviours (export.ts) */
  disabled: ReadonlySet<string>
  onChange: (name: string, value: string, checked: boolean) => void
  /** main groups slid up by toggleStructureDataOpts */
  sectionsHidden: ReadonlySet<string>
  /** switches forced on: checked, disabled and shadowed by a hidden clone */
  forcedOn: ReadonlySet<string>
}) {
  const one = (item: PluginOptionItem): ReactNode => {
    const off = disabled.has(item.name)
    switch (item.kind) {
      case 'bool':
        if (forcedOn.has(item.name)) {
          return (
            <li key={`b-${item.name}`} className="list-group-item py-1" style={{ opacity: 0.4 }}>
              <div className="form-check form-switch flex items-center gap-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  name={item.name}
                  value="y"
                  id={`checkbox_${item.name}`}
                  defaultChecked
                  disabled
                />
                <input type="hidden" name={item.name} value="y" />
                <label className="form-check-label" htmlFor={`checkbox_${item.name}`}>
                  <OptionText text={item.text} />
                </label>
                <Doc doc={item.doc} />
              </div>
            </li>
          )
        }
        return (
          <li
            key={`b-${item.name}`}
            className="list-group-item py-1"
            style={off ? { opacity: 0.4 } : undefined}
          >
            <div className="form-check form-switch flex items-center gap-2">
              <input
                className="form-check-input"
                type="checkbox"
                name={item.name}
                value="y"
                id={`checkbox_${item.name}`}
                defaultChecked={item.checked === true}
                disabled={off}
                onChange={(e) => onChange(item.name, 'y', e.currentTarget.checked)}
              />
              <label className="form-check-label" htmlFor={`checkbox_${item.name}`}>
                <OptionText text={item.text} />
              </label>
              <Doc doc={item.doc} />
            </div>
          </li>
        )
      case 'text':
        return (
          <li key={`t-${item.name}`} className="list-group-item py-1">
            <label htmlFor={`text_${item.name}`} className="form-label block">
              <OptionText text={item.text} />
            </label>
            <Input
              type="text"
              name={item.name}
              id={`text_${item.name}`}
              defaultValue={item.value ?? ''}
              disabled={off}
              className="max-w-md"
              {...(item.size !== undefined && item.size !== 0 ? { size: item.size } : {})}
              {...(item.len !== undefined && item.len !== 0 ? { maxLength: item.len } : {})}
            />
            <Doc doc={item.doc} />
          </li>
        )
      case 'number':
        return (
          <li key={`n-${item.name}`} className="list-group-item py-1">
            <label htmlFor={`number_${item.name}`} className="form-label block">
              <OptionText text={item.text} />
            </label>
            <Input
              type="number"
              name={item.name}
              id={`number_${item.name}`}
              min={0}
              defaultValue={item.value ?? ''}
              className="max-w-xs"
            />
          </li>
        )
      case 'select':
        return (
          <li key={`s-${item.name}`} className="list-group-item py-1">
            <label htmlFor={`select_${item.name}`} className="form-label block">
              <OptionText text={item.text} />
            </label>
            <NativeSelect
              name={item.name}
              id={`select_${item.name}`}
              defaultValue={item.value ?? ''}
              onChange={(e) => onChange(item.name, e.currentTarget.value, true)}
            >
              {(item.values ?? []).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <Doc doc={item.doc} />
          </li>
        )
      case 'radio':
        return (
          <li key={`r-${item.name}`} className="list-group-item py-1">
            {(item.values ?? []).map(([k, v]) => (
              <div key={k} className="form-check flex items-start gap-2">
                <input
                  type="radio"
                  name={item.name}
                  className="form-check-input mt-1"
                  value={k}
                  id={`radio_${item.name}_${k}`}
                  defaultChecked={k === (item.value ?? '')}
                  onChange={(e) => e.currentTarget.checked && onChange(item.name, k, true)}
                />
                <label className="form-check-label" htmlFor={`radio_${item.name}_${k}`}>
                  <OptionText text={v} />
                </label>
              </div>
            ))}
          </li>
        )
      case 'hidden':
        return (
          <li key={`h-${item.name}`} className="list-group-item hidden">
            <input type="hidden" name={item.name} value={item.value ?? ''} />
            {item.dbDefault !== undefined && (
              <input type="hidden" name={`${item.name}_default`} value={item.dbDefault} disabled />
            )}
          </li>
        )
      case 'message':
        return (
          <li key={`m-${item.name}-${item.text}`} className="list-group-item py-1">
            <OptionText text={item.text} />
            <Doc doc={item.doc} />
          </li>
        )
      case 'subgroup': {
        const header = item.header ?? null
        return (
          <Fragment key={`g-${item.name}-${header?.name ?? ''}-${header?.text ?? ''}`}>
            {header !== null && one(header)}
            <li className="list-group-item ps-6">
              <ul
                className="list-group"
                {...(header !== null && header.name !== '' ? { id: `ul_${header.name}` } : {})}
              >
                {(item.items ?? []).map(one)}
              </ul>
            </li>
          </Fragment>
        )
      }
    }
  }
  const groups = plugin.options ?? []
  const noOptions = groups.length === 0 || groups.every((g) => g.items.every((i) => i.kind === 'hidden'))
  return (
    <div id={`${plugin.name}_options`} className="format_specific_options" hidden={hidden}>
      {groups.map((g) => (
        <div key={g.name} id={g.name} hidden={sectionsHidden.has(g.name)}>
          {g.text !== '' && <h5 className="mt-4 mb-2 font-semibold">{g.text}</h5>}
          <ul className="list-group">{g.items.map(one)}</ul>
        </div>
      ))}
      {noOptions && <p className="card-text">{t('This format has no options')}</p>}
    </div>
  )
}
