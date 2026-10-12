import type { LoginInformation } from '@bettermyadmin/contracts'
import {
  Alert,
  Hint,
  Input,
  MySqlDocLink,
  NativeSelect,
  Panel,
  PanelBody,
  buttonVariants,
} from '@bettermyadmin/ui'
import { type ReactNode, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { pgettext, t } from '../../../lib/i18n'
import { SHA256_NOTICE, STRENGTH_LABELS, passwordScore, suggestPassword } from '../../shell/home/password.ts'
import { InlineHtml } from '../../shell/inline-html.tsx'
import { hostnameForPreset, thisHostData } from './privileges.ts'

function Item(props: { label: ReactNode; htmlFor: string; children: ReactNode; id?: string }) {
  return (
    <div
      className="item grid grid-cols-[11rem_auto_1fr] items-center gap-2 py-1"
      {...(props.id !== undefined ? { id: props.id } : {})}
    >
      <label htmlFor={props.htmlFor}>{props.label}</label>
      {props.children}
    </div>
  )
}

/**
 * The login fields of "Add user account" and "Change login information / Copy user account":
 * user name / host / password presets with their text fields, strength meter, Generate password,
 * authentication plugin with the SHA256 notice, and the account-exists warning.
 * pma: templates/server/privileges/login_information_fields.twig,
 *      resources/js/modules/functions.ts::onloadChangePasswordEvents, displayPasswordGenerateButton,
 *      resources/js/server/privileges.ts (AddUserLoginCheckUsername, PasswordStrength, SwitchToUseTextField,
 *      ShowSha256PasswordNotice)
 */
export function LoginInformationFields({ server, login }: { server: number; login: LoginInformation }) {
  const [predUser, setPredUser] = useState<string>(login.predefinedUsername)
  const [username, setUsername] = useState(login.username ?? '')
  const [exists, setExists] = useState(false)
  const [predHost, setPredHost] = useState<string>(login.predefinedHostname)
  const [hostname, setHostname] = useState(login.hostname ?? '%')
  const [predPw, setPredPw] = useState<string>(
    login.isChange ? 'keep' : login.username !== null && !login.isChange ? 'none' : 'userdefined',
  )
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [generated, setGenerated] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const [plugin, setPlugin] = useState(
    login.authPlugins.some((p) => p.name === login.authPlugin)
      ? (login.authPlugin ?? '')
      : (login.authPlugins[0]?.name ?? ''),
  )
  // ShowSha256PasswordNotice: hidden unless the preselected plugin is sha256_password, then on change
  const [sha256, setSha256] = useState(login.authPlugin === 'sha256_password')
  // the value at focus: the text fields flip their preset on a real `change` only
  const atFocus = useRef('')
  const userRef = useRef<HTMLInputElement>(null)
  const hostRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)
  const thisHost = thisHostData(login.thisHost)
  const strength = async (value: string) => setScore(value === '' ? 0 : await passwordScore(value, username))
  const checkUsername = async (value: string) => {
    if (predUser === 'userdefined' && value !== '')
      setExists((await api.validateUsername(server, value)).userExists)
    else setExists(false)
  }
  return (
    <Panel id="fieldset_add_user_login" title={t('Login Information')}>
      <PanelBody>
        <Item label={t('User name:')} htmlFor="select_pred_username">
          <span className="options">
            <NativeSelect
              name="pred_username"
              id="select_pred_username"
              title={t('User name')}
              value={predUser}
              onChange={(e) => {
                setPredUser(e.target.value)
                if (e.target.value === 'any') {
                  setUsername('')
                  setExists(false)
                } else userRef.current?.focus()
              }}
            >
              <option value="any">{t('Any user')}</option>
              <option value="userdefined">{t('Use text field')}</option>
            </NativeSelect>
          </span>
          <Input
            ref={userRef}
            type="text"
            spellCheck={false}
            name="username"
            id="pma_username"
            className="autofocus max-w-72"
            maxLength={Number(login.usernameLength) || undefined}
            title={t('User name')}
            value={username}
            required={predUser === 'userdefined'}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            onFocus={(e) => {
              atFocus.current = e.target.value
            }}
            onBlur={(e) => {
              if (e.target.value === atFocus.current) return
              setPredUser('userdefined')
              void checkUsername(e.target.value)
            }}
          />
        </Item>
        {exists && (
          <div id="user_exists_warning">
            <Alert variant="notice">
              {t('An account already exists with the same username but possibly a different hostname.')}
            </Alert>
          </div>
        )}
        <Item label={t('Host name:')} htmlFor="select_pred_hostname">
          <span className="options">
            <NativeSelect
              name="pred_hostname"
              id="select_pred_hostname"
              title={t('Host name')}
              {...(thisHost !== null ? { 'data-thishost': thisHost } : {})}
              value={predHost}
              onChange={(e) => {
                setPredHost(e.target.value)
                setHostname((h) => hostnameForPreset(e.target.value, h, thisHost))
                if (e.target.value === 'userdefined') hostRef.current?.focus()
              }}
            >
              <option value="any">{t('Any host')}</option>
              <option value="localhost">{t('Local')}</option>
              {login.thisHost !== null && login.thisHost !== '' && (
                <option value="thishost">{t('This host')}</option>
              )}
              <option value="hosttable">{t('Use host table')}</option>
              <option value="userdefined">{t('Use text field')}</option>
            </NativeSelect>
          </span>
          <span className="flex items-center gap-1">
            <Input
              ref={hostRef}
              type="text"
              name="hostname"
              id="pma_hostname"
              className="max-w-72"
              maxLength={Number(login.hostnameLength) || undefined}
              value={hostname}
              title={t('Host name')}
              required={predHost === 'userdefined'}
              onChange={(e) => setHostname(e.target.value)}
              onFocus={(e) => {
                atFocus.current = e.target.value
              }}
              onBlur={(e) => {
                if (e.target.value !== atFocus.current) setPredHost('userdefined')
              }}
            />
            <Hint
              message={t(
                'When Host table is used, this field is ignored and values stored in Host table are used instead.',
              )}
            />
          </span>
        </Item>
        <Item label={t('Password:')} htmlFor="select_pred_password">
          <span className="options">
            <NativeSelect
              name="pred_password"
              id="select_pred_password"
              title={t('Password')}
              value={predPw}
              onChange={(e) => {
                setPredPw(e.target.value)
                if (e.target.value === 'none') {
                  setPw('')
                  setPw2('')
                } else if (e.target.value === 'userdefined') pwRef.current?.focus()
              }}
            >
              {login.isChange && <option value="keep">{t('Do not change the password')}</option>}
              <option value="none">{t('No password')}</option>
              <option value="userdefined">{t('Use text field')}</option>
            </NativeSelect>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Input
              ref={pwRef}
              type="password"
              spellCheck={false}
              id="text_pma_pw"
              name="pma_pw"
              className="max-w-72"
              title={t('Password')}
              required={predPw === 'userdefined'}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value)
                if (e.target.value !== '') setPredPw('userdefined')
                void strength(e.target.value)
              }}
            />
            <span>{pgettext('Password strength', 'Strength:')}</span>
            <meter max={4} id="password_strength_meter" value={score ?? 0} />
            <span id="password_strength">{score === null ? '' : t(STRENGTH_LABELS[score] ?? '')}</span>
          </span>
        </Item>
        <Item label={t('Re-type:')} htmlFor="text_pma_pw2" id="div_element_before_generate_password">
          <span className="options">&nbsp;</span>
          <Input
            type="password"
            spellCheck={false}
            name="pma_pw2"
            id="text_pma_pw2"
            className="max-w-72"
            title={t('Re-type')}
            required={predPw === 'userdefined'}
            value={pw2}
            onChange={(e) => {
              setPw2(e.target.value)
              setPredPw('userdefined')
            }}
          />
        </Item>
        <Item
          label={login.isNew ? t('Authentication plugin') : t('Password hashing method')}
          htmlFor="select_authentication_plugin"
          id="authentication_plugin_div"
        >
          <span className="options">&nbsp;</span>
          <NativeSelect
            name="authentication_plugin"
            id="select_authentication_plugin"
            value={plugin}
            onChange={(e) => {
              setPlugin(e.target.value)
              setSha256(e.target.value === 'sha256_password')
            }}
          >
            {login.authPlugins.map((p) => (
              <option key={p.name} value={p.name}>
                {p.description}
              </option>
            ))}
          </NativeSelect>
        </Item>
        {sha256 && (
          <div id="ssl_reqd_warning">
            <Alert variant="notice">
              <InlineHtml text={t(SHA256_NOTICE)} /> <MySqlDocLink link="sha256-authentication-plugin" />
            </Alert>
          </div>
        )}
        {/* displayPasswordGenerateButton appends this row at the end of the card */}
        <Item label={`${t('Generate password')}:`} htmlFor="button_generate_password">
          <span className="options">
            {/* displayPasswordGenerateButton: an <input type="button"> */}
            <input
              type="button"
              id="button_generate_password"
              className={buttonVariants()}
              value={t('Generate')}
              onClick={() => {
                const g = suggestPassword()
                setGenerated(g)
                setPw(g)
                setPw2(g)
                setPredPw('userdefined')
                void strength(g)
              }}
            />
          </span>
          <Input
            type="text"
            name="generated_pw"
            id="generated_pw"
            className="max-w-72"
            value={generated}
            onChange={(e) => setGenerated(e.target.value)}
          />
        </Item>
      </PanelBody>
    </Panel>
  )
}
