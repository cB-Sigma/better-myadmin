import type { PreferencesImportResponse } from '@bettermyadmin/contracts'
import {
  Checkbox,
  Label,
  Loading,
  MessageBox,
  Panel,
  PanelBody,
  Radio,
  buttonVariants,
  cn,
  showMessage,
} from '@bettermyadmin/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useConfig } from '../../lib/config.ts'
import { t, useLanguage } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { setTheme } from '../shell/theme/theme.ts'
import { FormErrors } from './ConfigForm.tsx'
import { PrefsHeader } from './PrefsHeader.tsx'
import { localStorageSupported, readFile, savePrefs, savedOn, storedPrefs } from './manage.ts'
import { usePrefsSaved } from './prefsSaved.ts'

/**
 * Manage your settings: import (file or browser storage, merge), export (JSON, PHP, browser
 * storage) and reset.
 * pma: src/Controllers/Preferences/ManageController.php, resources/templates/preferences/manage/main.twig,
 *      manage/error.twig, resources/js/modules/config.ts
 */
export function ManagePage({ server, saved }: { server: number; saved: boolean }) {
  const q = useQuery({ queryKey: qk.preferencesManage(server), queryFn: () => api.preferencesManage(server) })
  const navigate = useNavigate()
  const applied = usePrefsSaved(server)
  const cfg = useConfig()
  const { setLanguage } = useLanguage()
  // config.ts: isStorageSupported('localStorage', true) warns once when the storage is unusable
  useEffect(() => {
    if (!localStorageSupported())
      showMessage(
        t(
          'There was a problem accessing your browser storage, some features may not work properly for you. It is likely that the browser doesn\'t support storage or the quota limit has been reached. In Firefox, corrupted storage can also cause such a problem, clearing your "Offline Website Data" might help. In Safari, such problem is commonly caused by "Private Mode Browsing".',
        ),
        false,
      )
  }, [])
  // the import whose bad fields are listed (the "Do you want to import remaining settings?" step)
  const [pending, setPending] = useState<{
    json: string
    merge: boolean
    errors: Array<{ name: string; errors: string[] }>
  } | null>(null)

  const afterImport = async (r: PreferencesImportResponse, json: string, merge: boolean) => {
    if (r.status === 'errors') {
      setPending({ json, merge, errors: r.errorList })
      return
    }
    setPending(null)
    if (r.status !== 'saved') return
    // check for ThemeDefault, then the lang redirect parameter
    if (r.themeDefault !== null)
      setTheme({ themeDefault: cfg.ThemeDefault, perServer: cfg.ThemePerServer, server }, r.themeDefault)
    if (r.lang !== null) await setLanguage(r.lang)
    await applied()
    await navigate({ to: '/s/$server/preferences/manage', params: { server }, search: { saved: 1 } })
  }

  const importPrefs = useMutation({
    mutationFn: (req: { json: string; merge: boolean; fixErrors?: boolean }) =>
      api.importPreferences(server, {
        json: req.json,
        merge: req.merge,
        ...(req.fixErrors === true ? { fixErrors: true } : {}),
      }),
    onSuccess: (r, req) => afterImport(r, req.json, req.merge),
  })
  const reset = useMutation({
    mutationFn: () => api.resetPreferences(server),
    onSuccess: async (r) => {
      if (!r.ok) return
      await applied()
      await navigate({ to: '/s/$server/preferences/manage', params: { server }, search: { saved: 1 } })
    },
  })

  const failure =
    importPrefs.data?.status === 'failed' ? importPrefs.data.message : (reset.data?.message ?? null)

  if (pending !== null) {
    // pma: preferences/manage/error.twig
    return (
      <>
        <PrefsHeader server={server} active="manage" saved={false} header={q.data} />
        <MessageBox type="error" text={t('Configuration contains incorrect data for some fields.')} />
        <FormErrors title="" list={pending.errors} />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const yes = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('name') === 'submit_import'
            if (yes) importPrefs.mutate({ json: pending.json, merge: pending.merge, fixErrors: true })
            else setPending(null)
          }}
        >
          <p>{t('Do you want to import remaining settings?')}</p>
          <span className="flex gap-2">
            <input className={buttonVariants()} type="submit" name="submit_import" value={t('Yes')} />
            <input className={buttonVariants()} type="submit" name="submit_ignore" value={t('No')} />
          </span>
        </form>
      </>
    )
  }

  return (
    <>
      <PrefsHeader server={server} active="manage" saved={saved} header={q.data} />
      {q.isPending && <Loading />}
      {[importPrefs.error, reset.error].map(
        (e) => e !== null && <MessageBox key={String(e)} {...errorMessage(e)} />,
      )}
      {failure !== null && <MessageBox type={failure.type} text={failure.text} />}
      <div id="maincontainer" className="grid gap-4 min-[768px]:grid-cols-[7fr_5fr]">
        <div>
          <ImportCard
            onImport={(json, merge) => importPrefs.mutate({ json, merge })}
            busy={importPrefs.isPending}
          />
        </div>
        <div>
          <ExportCard server={server} />
          <Panel title={t('Reset')} className="mt-4">
            <PanelBody>
              <form
                className="prefs-form"
                name="prefs_reset"
                onSubmit={(e) => {
                  e.preventDefault()
                  reset.mutate()
                }}
              >
                {t('You can reset all your settings and restore them to default values.')}
                <br />
                <br />
                <input className={buttonVariants()} type="submit" name="submit_clear" value={t('Reset')} />
              </form>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  )
}

/** The Import card: from a file or from the browser's storage. */
function ImportCard({ onImport, busy }: { onImport: (json: string, merge: boolean) => void; busy: boolean }) {
  const supported = useMemo(localStorageSupported, [])
  const stored = useMemo(storedPrefs, [])
  const [type, setType] = useState<'text_file' | 'local_storage'>('text_file')
  const [merge, setMerge] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const submitDisabled = busy || (type === 'local_storage' && (!supported || stored === null))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const json = type === 'local_storage' ? (stored?.config ?? '') : file === null ? '' : await readFile(file)
    onImport(json, merge)
  }
  return (
    <Panel title={t('Import')} className="mt-4">
      <PanelBody>
        <form className="prefs-form" name="prefs_import" onSubmit={(e) => void submit(e)}>
          <Radio
            id="import_text_file"
            name="import_type"
            value="text_file"
            checked={type === 'text_file'}
            onChange={() => setType('text_file')}
          />
          <Label htmlFor="import_text_file"> {t('Import from file')} </Label>
          <div
            id="opts_import_text_file"
            className={cn('prefsmanage_opts ms-8', type !== 'text_file' && 'disabled opacity-60')}
          >
            <Label htmlFor="input_import_file"> {t('Browse your computer:')} </Label>
            <input
              type="file"
              name="import_file"
              id="input_import_file"
              disabled={type !== 'text_file'}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Radio
            id="import_local_storage"
            name="import_type"
            value="local_storage"
            checked={type === 'local_storage'}
            onChange={() => setType('local_storage')}
          />
          <Label htmlFor="import_local_storage">{t("Import from browser's storage")}</Label>
          <div
            id="opts_import_local_storage"
            className={cn('prefsmanage_opts ms-8', type !== 'local_storage' && 'disabled opacity-60')}
          >
            {supported ? (
              <div className="localStorage-supported">
                {t("Settings will be imported from your browser's local storage.")}
                <br />
                {stored !== null ? (
                  <div className="localStorage-exists">
                    {savedOn(t('Saved on: @DATE@'), stored.mtimeLocal)}
                  </div>
                ) : (
                  <div className="localStorage-empty">
                    <MessageBox type="notice" text={t('You have no saved settings!')} />
                  </div>
                )}
              </div>
            ) : (
              <div className="localStorage-unsupported">
                <MessageBox type="notice" text={t('This feature is not supported by your web browser')} />
              </div>
            )}
          </div>
          <Checkbox
            id="import_merge"
            name="import_merge"
            checked={merge}
            onCheckedChange={(c) => setMerge(c === true)}
          />
          <Label htmlFor="import_merge"> {t('Merge with current configuration')} </Label>
          <br />
          <br />
          <input
            className={buttonVariants({ variant: 'primary' })}
            type="submit"
            name="submit_import"
            value={t('Go')}
            disabled={submitDisabled}
          />
        </form>
      </PanelBody>
    </Panel>
  )
}

/** The Export card: JSON / PHP download or the browser's storage (submit_get_json). */
function ExportCard({ server }: { server: number }) {
  const supported = useMemo(localStorageSupported, [])
  const [exists, setExists] = useState(() => storedPrefs() !== null)
  const [type, setType] = useState<'text_file' | 'php_file' | 'local_storage'>('text_file')
  const [savedMessage, setSavedMessage] = useState(false)
  const toStorage = useMutation({
    mutationFn: () => api.preferencesJson(server),
    onSuccess: (r) => {
      savePrefs(r.prefs, r.mtime)
      setExists(true)
      setSavedMessage(true)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (type === 'local_storage') toStorage.mutate()
    else window.location.assign(api.preferencesExportUrl(server, type === 'php_file' ? 'php' : 'json'))
  }
  return (
    <Panel title={t('Export')} className="mt-4">
      <PanelBody>
        {toStorage.isError && <MessageBox {...errorMessage(toStorage.error)} />}
        {savedMessage ? (
          // .click-hide-message: a click shows the form again
          <button
            type="button"
            className="click-hide-message block w-full cursor-pointer text-left"
            onClick={() => setSavedMessage(false)}
          >
            <MessageBox type="success" text={t('Configuration has been saved.')} />
          </button>
        ) : (
          <form className="prefs-form" name="prefs_export" onSubmit={submit}>
            <div>
              <Radio
                id="export_text_file"
                name="export_type"
                value="text_file"
                checked={type === 'text_file'}
                onChange={() => setType('text_file')}
              />
              <Label htmlFor="export_text_file"> {t('Save as JSON file')} </Label>
              <br />
              <Radio
                id="export_php_file"
                name="export_type"
                value="php_file"
                checked={type === 'php_file'}
                onChange={() => setType('php_file')}
              />
              <Label htmlFor="export_php_file"> {t('Save as PHP file')} </Label>
              <br />
              <Radio
                id="export_local_storage"
                name="export_type"
                value="local_storage"
                checked={type === 'local_storage'}
                onChange={() => setType('local_storage')}
              />
              <Label htmlFor="export_local_storage"> {t("Save to browser's storage")} </Label>
            </div>
            <div
              id="opts_export_local_storage"
              className={cn('prefsmanage_opts ms-8', type !== 'local_storage' && 'disabled opacity-60')}
            >
              {supported ? (
                <span className="localStorage-supported">
                  {t("Settings will be saved in your browser's local storage.")}
                  {exists && (
                    <div className="localStorage-exists">
                      <b>{t('Existing settings will be overwritten!')}</b>
                    </div>
                  )}
                </span>
              ) : (
                <div className="localStorage-unsupported">
                  <MessageBox type="notice" text={t('This feature is not supported by your web browser')} />
                </div>
              )}
            </div>
            <br />
            <input
              className={buttonVariants({ variant: 'primary' })}
              type="submit"
              name="submit_export"
              value={t('Go')}
              disabled={toStorage.isPending || (type === 'local_storage' && !supported)}
            />
          </form>
        )}
      </PanelBody>
    </Panel>
  )
}
