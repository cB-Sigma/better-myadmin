import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MySqlDocLink,
  NativeSelect,
  PROCESSING_REQUEST,
  removeMessage,
  showMessage,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../../lib/api.ts'
import { qk } from '../../../lib/queryKeys.ts'
import {
  EMPTY_WITH_ALLOW_NO_PASSWORD_OFF,
  SHA256_NOTICE,
  STRENGTH_LABELS,
  checkPassword,
  passwordScore,
  suggestPassword,
} from './password.ts'

export interface PasswordChanged {
  message: string
  sql: string
}

/**
 * `#changePasswordModal` with the `/user-password` form: No Password / Password (Enter, Re-type,
 * Strength), Password Hashing, Generate password; Go submits, Cancel closes.
 * pma: templates/modals/change_password.twig, templates/server/privileges/change_password.twig,
 *      resources/js/modules/functions.ts::onloadChangePasswordEvents
 */
export function ChangePasswordDialog(props: {
  server: number
  username: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onChanged: (r: PasswordChanged) => void
}) {
  const form = useQuery({
    queryKey: qk.passwordForm(props.server),
    queryFn: () => api.passwordForm(props.server),
    enabled: props.open,
    staleTime: 0,
  })
  const confirm = useConfirm()
  const [nopass, setNopass] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [generated, setGenerated] = useState('')
  const [plugin, setPlugin] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const pwRef = useRef<HTMLInputElement>(null)

  // a fresh form every time the modal opens (the form HTML is re-fetched in phpMyAdmin)
  useEffect(() => {
    if (!props.open) return
    setNopass(false)
    setPw('')
    setPw2('')
    setGenerated('')
    setScore(null)
  }, [props.open])

  useEffect(() => {
    const f = form.data
    if (f === undefined) return
    // the browser selects the first option when the original plugin is not in the list
    setPlugin(
      f.authPlugins.some((p) => p.name === f.origAuthPlugin)
        ? f.origAuthPlugin
        : (f.authPlugins[0]?.name ?? ''),
    )
    pwRef.current?.focus()
  }, [form.data])

  const strength = async (value: string) => {
    setScore(value === '' ? 0 : await passwordScore(value, props.username))
  }

  const go = async () => {
    const f = form.data
    if (f === undefined) return
    const invalid = checkPassword(nopass, pw, pw2)
    if (invalid !== null) {
      window.alert(invalid)
      setPw('')
      setPw2('')
      pwRef.current?.focus()
      return
    }
    if (nopass && !f.allowNoPassword) {
      const [before, after] = EMPTY_WITH_ALLOW_NO_PASSWORD_OFF.split('AllowNoPassword')
      const question = (
        <>
          {before}
          <code>AllowNoPassword</code>
          {after}
        </>
      )
      if (!(await confirm({ question }))) return
    }
    const box = showMessage(PROCESSING_REQUEST)
    props.onOpenChange(false)
    try {
      const r = await api.changePassword(props.server, {
        nopass,
        pma_pw: pw,
        pma_pw2: pw2,
        ...(f.showHashing ? { authentication_plugin: plugin } : {}),
      })
      removeMessage(box)
      props.onChanged({ message: r.message, sql: r.sql })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e)
      showMessage(
        e instanceof ApiError && e.envelope.sql !== undefined ? `${msg} — ${e.envelope.sql}` : msg,
        false,
        'error',
      )
    }
  }

  const f = form.data
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg" id="changePasswordModal" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {form.isError && <Alert variant="error">{form.error.message}</Alert>}
          {f !== undefined && (
            <form
              id="change_password_form"
              name="chgPassword"
              autoComplete="off"
              data-allow-no-password={f.allowNoPassword ? 1 : 0}
              onSubmit={(e) => {
                e.preventDefault()
                void go()
              }}
            >
              <table className="w-full border-separate border-spacing-y-3 text-[13px]">
                <tbody>
                  <tr>
                    <td colSpan={3}>
                      <input
                        type="radio"
                        name="nopass"
                        value="1"
                        id="nopass_1"
                        checked={nopass}
                        onChange={() => setNopass(true)}
                      />{' '}
                      <label htmlFor="nopass_1">No Password</label>
                    </td>
                  </tr>
                  <tr className="align-middle">
                    <td className="pe-3 whitespace-nowrap">
                      <input
                        type="radio"
                        name="nopass"
                        value="0"
                        id="nopass_0"
                        checked={!nopass}
                        onChange={() => setNopass(false)}
                      />{' '}
                      <label htmlFor="nopass_0">Password:&nbsp;</label>
                    </td>
                    <td>
                      <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
                        <span>Enter:</span>
                        <Input
                          ref={pwRef}
                          type="password"
                          name="pma_pw"
                          id="text_pma_change_pw"
                          spellCheck={false}
                          autoComplete="new-password"
                          value={pw}
                          onChange={(e) => {
                            setPw(e.target.value)
                            setNopass(false)
                            void strength(e.target.value)
                          }}
                        />
                        <span>Re-type:</span>
                        <Input
                          type="password"
                          name="pma_pw2"
                          id="text_pma_change_pw2"
                          spellCheck={false}
                          autoComplete="new-password"
                          value={pw2}
                          onChange={(e) => {
                            setPw2(e.target.value)
                            setNopass(false)
                          }}
                        />
                      </div>
                    </td>
                    <td className="ps-3">
                      <div className="flex items-center gap-1">
                        <span>Strength:</span>
                        <meter max={4} id="change_password_strength_meter" value={score ?? 0} />
                      </div>
                      <span id="change_password_strength">
                        {score === null ? '' : STRENGTH_LABELS[score]}
                      </span>
                    </td>
                  </tr>
                  {f.showHashing && (
                    <tr className="align-middle">
                      <td>
                        <label htmlFor="select_authentication_plugin_cp">Password Hashing:</label>
                      </td>
                      <td colSpan={2}>
                        <NativeSelect
                          name="authentication_plugin"
                          id="select_authentication_plugin_cp"
                          value={plugin}
                          onChange={(e) => setPlugin(e.target.value)}
                        >
                          {f.authPlugins.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.description}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                    </tr>
                  )}
                  <tr className="align-middle">
                    <td>Generate password</td>
                    <td colSpan={2}>
                      <div className="flex items-center gap-2">
                        <Button
                          id="button_generate_password"
                          onClick={() => {
                            const g = suggestPassword()
                            setGenerated(g)
                            setPw(g)
                            setPw2(g)
                            setNopass(false)
                            void strength(g)
                          }}
                        >
                          Generate
                        </Button>
                        <Input
                          name="generated_pw"
                          id="generated_pw"
                          value={generated}
                          onChange={(e) => setGenerated(e.target.value)}
                          className="max-w-60"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              {f.showSslNotice && plugin === 'sha256_password' && (
                <Alert variant="notice" id="ssl_reqd_warning_cp">
                  {SHA256_NOTICE.split("'").map((part, i) =>
                    i % 2 === 1 ? <em key={part}>'{part}'</em> : part,
                  )}{' '}
                  <MySqlDocLink link="sha256-authentication-plugin" />
                </Alert>
              )}
              <input type="hidden" name="change_pw" value="1" />
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          )}
        </DialogBody>
        <DialogFooter>
          <Button id="changePasswordGoButton" onClick={() => void go()} disabled={f === undefined}>
            Go
          </Button>
          <Button onClick={() => props.onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
