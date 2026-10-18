import { Loading, MessageBox, Panel, PanelBody, buttonVariants } from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useCallback, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { TwoFactorFields } from './TwoFactorForm.tsx'

/**
 * The login step after the password: the configured backend's challenge.
 * pma: src/Plugins/AuthenticationPlugin.php::checkTwoFactor, resources/templates/login/twofactor.twig
 */
export function TwoFactorLogin() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.twoFactorChallenge, queryFn: api.twoFactorChallenge, staleTime: 0 })
  const [fields, setFields] = useState<Record<string, string>>({})
  const verify = useMutation({
    mutationFn: (f: Record<string, string>) => api.verifyTwoFactor({ fields: f }),
    onSuccess: async (r) => {
      setFields({})
      if (r.ok) {
        // exact: the challenge (['auth', 'two-factor']) would refetch and fail once verified
        await qc.invalidateQueries({ queryKey: qk.auth, exact: true })
        return
      }
      if (r.challenge !== undefined) qc.setQueryData(qk.twoFactorChallenge, r.challenge)
    },
  })
  const auto = useCallback((f: Record<string, string>) => verify.mutate(f), [verify.mutate])
  const challenge = q.data
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <MessageBox
        type="notice"
        text={t('You have enabled two factor authentication, please confirm your login.')}
      />
      {q.isPending && <Loading />}
      {q.isError && <MessageBox {...errorMessage(q.error)} />}
      {verify.isError && <MessageBox {...errorMessage(verify.error)} />}
      {challenge !== undefined && (
        <form
          method="post"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            verify.mutate(fields)
          }}
        >
          <Panel
            footer={
              challenge.showSubmit ? (
                <input className={buttonVariants({ variant: 'primary' })} type="submit" value={t('Verify')} />
              ) : undefined
            }
          >
            <PanelBody>
              {challenge.error !== null && <MessageBox type="error" text={challenge.error} />}
              <TwoFactorFields
                form={challenge.form}
                values={fields}
                onChange={setFields}
                onAutoSubmit={auto}
              />
            </PanelBody>
          </Panel>
        </form>
      )}
    </div>
  )
}
