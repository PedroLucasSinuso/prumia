import { useState, type FormEvent } from 'react'

import { useSignupInviteActions, useSignupInvites } from '../../api/queries'
import { ApiError } from '../../api/errors'
import type { Me, SignupInviteCreated } from '../../api/types'
import { networkErrorMessage, problemMessage } from '../../auth/errors'
import { signupLink } from '../../lib/links'
import { Button } from '../ui/Button'
import { LinkBox } from '../LinkBox'
import { Notice } from '../ui/Notice'
import { useToast } from '../toastContext'
import { Card } from './ui'

const label = 'text-meta font-medium uppercase tracking-wider text-muted'
const select = 'h-11 rounded-md border border-line-strong bg-raised px-3 text-base text-ink md:h-9 md:text-sm'
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * Convites de cadastro (só o dono do sistema, a primeira conta): um link de uso único para alguém criar a PRÓPRIA conta e
 * a própria casa (não entra na sua). Gerar, ver os pendentes e revogar. O link aparece uma vez só (no banco fica o hash).
 */
export function SignupInvitesCard({ me }: { me: Me }) {
  const pending = useSignupInvites(me.isSystemOwner)
  const actions = useSignupInviteActions()
  const toast = useToast()
  const [hours, setHours] = useState(48)
  const [created, setCreated] = useState<SignupInviteCreated>()
  const [error, setError] = useState<string>()

  if (!me.isSystemOwner) return null

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    try {
      setCreated(await actions.create.mutateAsync(hours))
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      setError(api?.network ? networkErrorMessage : problemMessage(api?.problem))
    }
  }

  function revoke(id: string) {
    actions.revoke.mutate(id, {
      onSuccess: () => {
        if (created?.id === id) setCreated(undefined)
        toast({ message: 'Link de cadastro revogado.' })
      },
      onError: () => toast({ message: 'Não foi possível revogar. Tente de novo.' }),
    })
  }

  return (
    <Card label="Convites de cadastro" title="convites de cadastro">
      <p className="mt-1 text-sm text-muted">
        Para alguém criar a <strong>própria conta e a própria casa</strong> no prumia (não entra na sua). Só você, que criou a primeira
        conta, vê esta opção. Cada link funciona uma vez.
      </p>
      <form onSubmit={(e) => void onCreate(e)} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className={label}>vale por</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={select}>
            <option value={24}>1 dia</option>
            <option value={48}>2 dias</option>
            <option value={168}>7 dias</option>
          </select>
        </label>
        <Button type="submit" loading={actions.create.isPending} loadingLabel="Gerando…">
          Gerar link de cadastro
        </Button>
      </form>
      {error && <Notice className="mt-3">{error}</Notice>}
      {created && (
        <div className="mt-3">
          <LinkBox
            label="Link de cadastro"
            link={signupLink(created.token, me.publicUrl)}
            note={`Vale até ${when(created.expiresAt)} e só funciona uma vez. Ele não aparece de novo: copie agora.`}
          />
        </div>
      )}
      {pending.isError && <Notice className="mt-3" onRetry={() => void pending.refetch()}>Não foi possível carregar os links pendentes.</Notice>}
      {pending.isSuccess && pending.data.length > 0 && (
        <ul aria-label="Links de cadastro pendentes" className="mt-4 flex flex-col">
          {pending.data.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
              <span className="text-sm text-ink">
                pendente · vale até <span className="font-mono tabular-nums">{when(inv.expiresAt)}</span>
              </span>
              <Button variant="quiet" size="sm" onClick={() => revoke(inv.id)} aria-label={`Revogar link de cadastro que vale até ${when(inv.expiresAt)}`}>
                Revogar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
