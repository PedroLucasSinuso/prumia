import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/errors'
import { useCreateHousehold, useHouseActions, useMembers } from '../api/queries'
import type { InviteCreated, Me, Member, Role } from '../api/types'
import { useAuth } from '../auth/context'
import { useActiveHouse, type House } from '../auth/useActiveHouse'
import { problemMessage } from '../auth/errors'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { LinkBox } from '../components/LinkBox'
import { MembersList } from '../components/MembersList'
import { useToast } from '../components/toastContext'
import { inviteLink, resetLink } from '../lib/links'
import { roleLabel } from '../lib/roles'

const label = 'text-xs font-medium uppercase tracking-wider'

const errorText = (e: unknown) => (e instanceof ApiError ? (e.network ? 'Sem conexão com o servidor.' : problemMessage(e.problem)) : 'Algo deu errado.')
const expiry = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * A casa: quem mora nela, convites e (para admins) renomear/excluir. O convite é um link: o token só aparece uma vez,
 * então a tela o mostra na hora para copiar e mandar. A noiva (ou qualquer pessoa) entra abrindo o link.
 */
export default function HousePage() {
  const { session } = useAuth()
  const { house } = useActiveHouse()
  if (session.status !== 'authenticated' || !house) return null
  // key: trocar de casa remonta a tela (formulários e avisos não vazam de uma casa para a outra)
  return <HouseView key={house.id} me={session.me} house={house} />
}

function HouseView({ me, house }: { me: Me; house: House }) {
  const { refresh, logout } = useAuth()
  const { selectHouse } = useActiveHouse()
  const navigate = useNavigate()
  const toast = useToast()
  const houseId = house.id

  const members = useMembers(houseId)
  const actions = useHouseActions(houseId)

  const [name, setName] = useState(house?.name ?? '')
  const [role, setRole] = useState<Role>('member')
  const [hours, setHours] = useState(48)
  const [invite, setInvite] = useState<InviteCreated>()
  const [reset, setReset] = useState<{ member: Member; token: string; expiresAt: string }>()
  const [error, setError] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const createHouse = useCreateHousehold()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const isAdmin = house.role === 'admin'
  const fail = (e: unknown) => setError(errorText(e))

  function onRename(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    actions.rename.mutate(name.trim(), {
      onSuccess: async () => {
        await refresh()
        toast({ message: 'Casa renomeada.' })
      },
      onError: fail,
    })
  }

  function onInvite(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setInvite(undefined)
    actions.invite.mutate({ role, expiresInHours: hours }, { onSuccess: setInvite, onError: fail })
  }

  function onRole(userId: string, next: Role) {
    setError(undefined)
    actions.setRole.mutate({ userId, role: next }, {
      onSuccess: async () => {
        await refresh() // o papel da própria pessoa muda o que ela pode fazer
        toast({ message: `Papel alterado para ${roleLabel[next]}.` })
      },
      onError: fail,
    })
  }

  function onRemove(m: Member) {
    setError(undefined)
    actions.removeMember.mutate(m.userId, {
      onSuccess: async () => {
        if (m.userId === me.id) {
          await leftHouse(`Você saiu de ${house.name}.`)
          return
        }
        toast({ message: `${m.name} saiu da casa.` })
      },
      onError: fail,
    })
  }

  /**
   * Depois de sair ou excluir a casa ativa: se havia outra casa, troca para ela e volta ao mês;
   * se era a ÚLTIMA, a sessão fica sem destino e é encerrada.
   */
  async function leftHouse(message: string) {
    const fresh = await refresh()
    const next = (fresh ?? me).households.find((h) => h.id !== house.id)
    if (!next) {
      await logout()
      navigate('/entrar', { replace: true })
      return
    }
    selectHouse(next.id)
    toast({ message: `${message} Agora você está em ${next.name}.` })
    navigate('/', { replace: true })
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    createHouse.mutate(newName.trim(), {
      onSuccess: async (created) => {
        await refresh()
        selectHouse(created.id)
        toast({ message: `Casa ${created.name} criada. Agora você está nela.` })
      },
      onError: fail,
    })
  }

  function onResetLink(m: Member) {
    setError(undefined)
    setReset(undefined)
    actions.resetLink.mutate(m.userId, { onSuccess: (r) => setReset({ member: m, ...r }), onError: fail })
  }

  function onDelete() {
    setError(undefined)
    actions.remove.mutate(undefined, {
      onSuccess: () => leftHouse(`Casa ${house.name} excluída.`),
      onError: fail,
    })
  }

  const busy = actions.setRole.isPending || actions.removeMember.isPending

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-4 md:max-w-none md:px-10 md:pb-10 md:pt-8">
        <header>
          <h1 className="font-display text-[32px] font-bold leading-none text-teal font-stretch-condensed">{house.name}</h1>
          <p className="mt-1 text-sm text-graphite/80">Você é <strong>{roleLabel[house.role]}</strong> desta casa.</p>
        </header>

        {error && (
          <p role="alert" className="rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
            <span className="font-mono text-signal">[ ✖ ]</span> {error}
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          <section aria-label="Pessoas" className="rounded-md border border-graphite/20 p-4">
            <h2 className={`${label} text-graphite/80`}>pessoas da casa</h2>
            {members.isPending && <p role="status" className="mt-2 text-sm text-graphite/70">carregando…</p>}
            {members.isError && <p role="alert" className="mt-2 text-sm">Não foi possível carregar as pessoas.</p>}
            {members.isSuccess && (
              <MembersList members={members.data} meId={me.id} isAdmin={isAdmin} busy={busy} onRole={onRole} onRemove={onRemove} onResetLink={onResetLink} />
            )}
            {reset && (
              <div className="mt-3">
                <LinkBox
                  label={`Link de nova senha para ${reset.member.name}`}
                  link={resetLink(reset.token)}
                  note={`Vale até ${expiry(reset.expiresAt)}. Mande só para ${reset.member.name}: quem abrir o link define a senha.`}
                />
              </div>
            )}
          </section>

          <div className="flex flex-col gap-6">
            {isAdmin ? (
              <section aria-label="Convidar" className="rounded-md border border-graphite/20 p-4">
                <h2 className={`${label} text-graphite/80`}>convidar alguém</h2>
                <p className="mt-1 text-sm text-graphite/80">Gere um link e mande para a pessoa. Ela cria a conta (ou entra) e já cai na casa.</p>
                <form onSubmit={onInvite} className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className={`${label} text-graphite/70`}>papel</span>
                    <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-11 rounded-md border border-graphite/25 bg-white/40 px-3 text-base">
                      <option value="member">membro — lança e paga contas</option>
                      <option value="viewer">leitura — só vê</option>
                      <option value="admin">admin — gerencia a casa</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={`${label} text-graphite/70`}>vale por</span>
                    <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-11 rounded-md border border-graphite/25 bg-white/40 px-3 text-base">
                      <option value={24}>1 dia</option>
                      <option value={48}>2 dias</option>
                      <option value={168}>7 dias</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={actions.invite.isPending}>{actions.invite.isPending ? 'Gerando…' : 'Gerar link de convite'}</Button>
                </form>
                {invite && (
                  <div className="mt-3">
                    <LinkBox
                      label="Link do convite"
                      link={inviteLink(invite.token)}
                      note={`Entra como ${roleLabel[invite.role]}. Vale até ${expiry(invite.expiresAt)} e só funciona uma vez. Ele não aparece de novo: copie agora.`}
                    />
                  </div>
                )}
              </section>
            ) : (
              <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/75">Só quem administra a casa pode convidar pessoas.</p>
            )}

            {isAdmin && (
              <section aria-label="Nome da casa" className="rounded-md border border-graphite/20 p-4">
                <h2 className={`${label} text-graphite/80`}>nome da casa</h2>
                <form onSubmit={onRename} className="mt-2 flex flex-col gap-3">
                  <Field label="Nome" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                  <Button type="submit" variant="ghost" disabled={actions.rename.isPending || !name.trim() || name.trim() === house.name}>Salvar nome</Button>
                </form>
              </section>
            )}

            <section aria-label="Outra casa" className="rounded-md border border-graphite/20 p-4">
              <h2 className={`${label} text-graphite/80`}>outra casa</h2>
              <p className="mt-1 text-sm text-graphite/80">Uma casa separada, com contas e pessoas próprias. Você troca de casa pelo topo da tela.</p>
              {creating ? (
                <form onSubmit={onCreate} className="mt-3 flex flex-col gap-3">
                  <Field label="Nome da nova casa" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
                  <div className="flex items-center gap-3">
                    <Button type="submit" disabled={createHouse.isPending || !newName.trim()}>{createHouse.isPending ? 'Criando…' : 'Criar casa'}</Button>
                    <button type="button" onClick={() => setCreating(false)} className="h-11 text-sm underline underline-offset-4">cancelar</button>
                  </div>
                </form>
              ) : (
                <Button variant="ghost" className="mt-3" onClick={() => setCreating(true)}>Criar outra casa</Button>
              )}
            </section>

            {isAdmin && (
              <section aria-label="Excluir casa" className="rounded-md border border-signal/50 p-4">
                <h2 className={`${label} text-graphite/80`}>excluir a casa</h2>
                <p className="mt-1 text-sm text-graphite/80">Remove a casa e tira o acesso de todas as pessoas. Os dados ficam guardados no servidor, mas o app deixa de mostrá-los.</p>
                {confirmDelete ? (
                  <div className="mt-3 flex items-center gap-3">
                    <Button variant="ghost" onClick={onDelete} disabled={actions.remove.isPending}>Sim, excluir a casa</Button>
                    <button onClick={() => setConfirmDelete(false)} className="h-11 text-sm underline underline-offset-4">cancelar</button>
                  </div>
                ) : (
                  <Button variant="ghost" className="mt-3" onClick={() => setConfirmDelete(true)}>Excluir casa…</Button>
                )}
              </section>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  )
}
