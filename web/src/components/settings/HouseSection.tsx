import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../../api/errors'
import { useCreateHousehold, useHouseActions, useMembers } from '../../api/queries'
import type { InviteCreated, Me, Member, Role } from '../../api/types'
import { useAuth } from '../../auth/context'
import { problemMessage } from '../../auth/errors'
import { useActiveHouse, type House } from '../../auth/useActiveHouse'
import { inviteLink, resetLink } from '../../lib/links'
import { roleHelp, roleLabel } from '../../lib/roles'
import { Button } from '../Button'
import { Field } from '../Field'
import { LinkBox } from '../LinkBox'
import { MembersList } from '../MembersList'
import { useToast } from '../toastContext'
import { Card, SectionHeader } from './ui'

const label = 'text-xs font-medium uppercase tracking-wider text-ink/75'
const select = 'h-11 rounded-md border border-ink/25 bg-raised/40 px-3 text-base md:h-9 md:text-sm'

const errorText = (e: unknown) => (e instanceof ApiError ? (e.network ? 'Sem conexão com o servidor.' : problemMessage(e.problem)) : 'Algo deu errado.')
const expiry = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Ajustes > Casa e pessoas: nome da casa, quem mora nela, convites, outra casa e (admin) a zona de perigo.
 * O convite é um link: o token só aparece uma vez, então a tela o mostra na hora para copiar e mandar.
 */
export function HouseSection({ me, house }: { me: Me; house: House }) {
  const { refresh, logout } = useAuth()
  const { selectHouse } = useActiveHouse()
  const navigate = useNavigate()
  const toast = useToast()
  const houseId = house.id

  const members = useMembers(houseId)
  const actions = useHouseActions(houseId)

  const [name, setName] = useState(house.name)
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
  const count = members.data?.length

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Casa e pessoas"
        description={
          <>
            Quem mora em <strong>{house.name}</strong> e o que cada pessoa pode fazer. Você é <strong>{roleLabel[house.role]}</strong> desta casa.
          </>
        }
      />

      {error && (
        <p role="alert" className="rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm">
          <span className="font-mono text-alert">[ ✖ ]</span> {error}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
        <div className="flex flex-col gap-4">
          <Card label="Casa">
            <h3 className="font-display text-[22px] font-bold leading-tight text-heading font-stretch-condensed">{house.name}</h3>
            {isAdmin ? (
              <form onSubmit={onRename} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field label="Nome da casa" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                </div>
                <Button type="submit" variant="ghost" disabled={actions.rename.isPending || !name.trim() || name.trim() === house.name}>
                  Salvar nome
                </Button>
              </form>
            ) : (
              <p className="mt-1 text-sm text-ink/75">Só quem administra pode renomear a casa.</p>
            )}
          </Card>

          <Card label="Pessoas" title={count !== undefined ? `pessoas da casa (${count})` : 'pessoas da casa'}>
            {members.isPending && <p role="status" className="mt-2 text-sm text-ink/70">carregando…</p>}
            {members.isError && <p role="alert" className="mt-2 text-sm">Não foi possível carregar as pessoas.</p>}
            {members.isSuccess && (
              <MembersList members={members.data} meId={me.id} isAdmin={isAdmin} busy={busy} onRole={onRole} onRemove={onRemove} onResetLink={onResetLink} />
            )}
            {reset && (
              <div className="mt-3">
                <LinkBox
                  label={`Link de nova senha para ${reset.member.name}`}
                  link={resetLink(reset.token, me.publicUrl)}
                  note={`Vale até ${expiry(reset.expiresAt)}. Mande só para ${reset.member.name}: quem abrir o link define a senha.`}
                />
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {isAdmin ? (
            <Card label="Convidar" title="convidar alguém">
              <p className="mt-1 text-sm text-ink/80">Gere um link e mande para a pessoa. Ela cria a conta (ou entra) e já cai na casa.</p>
              <form onSubmit={onInvite} className="mt-3 flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className={label}>papel</span>
                    <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={select}>
                      <option value="member">{roleLabel.member} — {roleHelp.member}</option>
                      <option value="viewer">{roleLabel.viewer} — {roleHelp.viewer}</option>
                      <option value="admin">{roleLabel.admin} — {roleHelp.admin}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={label}>vale por</span>
                    <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={select}>
                      <option value={24}>1 dia</option>
                      <option value={48}>2 dias</option>
                      <option value={168}>7 dias</option>
                    </select>
                  </label>
                </div>
                <Button type="submit" disabled={actions.invite.isPending}>{actions.invite.isPending ? 'Gerando…' : 'Gerar link de convite'}</Button>
              </form>
              {invite && (
                <div className="mt-3">
                  <LinkBox
                    label="Link do convite"
                    link={inviteLink(invite.token, me.publicUrl)}
                    note={`Entra como ${roleLabel[invite.role]}. Vale até ${expiry(invite.expiresAt)} e só funciona uma vez. Ele não aparece de novo: copie agora.`}
                  />
                </div>
              )}
            </Card>
          ) : (
            <p className="rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/75">Só quem administra a casa pode convidar pessoas.</p>
          )}

          <Card label="Outra casa" title="outra casa">
            <p className="mt-1 text-sm text-ink/80">Uma casa separada, com contas e pessoas próprias. Você troca de casa pelo topo da tela ou pelo menu da sua conta.</p>
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
          </Card>

          {isAdmin && (
            <Card label="Zona de perigo" title="zona de perigo" tone="danger">
              <p className="mt-1 text-sm text-ink/80">
                Excluir remove a casa e tira o acesso de todas as pessoas. Os dados ficam guardados no servidor, mas o app deixa de mostrá-los.
              </p>
              {confirmDelete ? (
                <div className="mt-3 flex items-center gap-3">
                  <Button variant="ghost" onClick={onDelete} disabled={actions.remove.isPending}>Sim, excluir a casa</Button>
                  <button onClick={() => setConfirmDelete(false)} className="h-11 text-sm underline underline-offset-4">cancelar</button>
                </div>
              ) : (
                <Button variant="ghost" className="mt-3" onClick={() => setConfirmDelete(true)}>Excluir casa…</Button>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
