import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '../api/errors'
import { useAcceptInvite } from '../api/queries'
import { useAuth } from '../auth/context'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Field } from '../components/Field'
import { FormError } from '../components/FormError'

/**
 * Destino do link de convite (/convite?token=…). Pública: quem recebe o link pode ainda não ter conta.
 * - Sem conta: cadastrar com o token coloca a pessoa direto na casa de quem convidou (sem criar uma casa nova).
 * - Com conta e logada: "Entrar na casa" aceita o convite (POST /invites/accept) e já ativa a casa nova.
 * - Com conta e deslogada: "entrar e aceitar" leva ao login e volta para cá com o mesmo token.
 */
export default function InvitePage() {
  const { session, register, refresh, selectHouse } = useAuth()
  const navigate = useNavigate()
  const token = useSearchParams()[0].get('token') ?? ''
  const accept = useAcceptInvite()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  function edited(field: string) {
    setFields(({ [field]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    setFields({})
    const result = await register({ name: name.trim(), email: email.trim(), password, inviteToken: token })
    setBusy(false)
    if (result.ok) {
      navigate('/', { replace: true })
      return
    }
    setError(result.network ? networkErrorMessage : problemMessage(result.problem))
    setFields(problemFields(result.problem))
  }

  function onAccept() {
    setError(undefined)
    accept.mutate(token, {
      onSuccess: async (house) => {
        await refresh()
        selectHouse(house.id)
        navigate('/', { replace: true })
      },
      onError: (e) => setError(e instanceof ApiError && e.network ? networkErrorMessage : problemMessage(e instanceof ApiError ? e.problem : undefined)),
    })
  }

  if (session.status === 'loading') return <p role="status" className="p-6 text-sm text-muted">carregando…</p>

  if (!token) {
    return (
      <AuthLayout title="Convite">
        <p className="text-sm text-muted">Este link está incompleto. Peça a quem administra a casa para gerar um novo convite.</p>
        <Link to="/entrar" className="text-sm font-semibold text-accent underline underline-offset-2">Ir para o login</Link>
      </AuthLayout>
    )
  }

  if (session.status === 'authenticated') {
    return (
      <AuthLayout title="Convite">
        <p className="text-sm text-muted">
          Você está logado como <strong>{session.me.name}</strong>. Aceite para entrar na casa de quem convidou; as suas outras casas
          continuam com você, e você troca de casa pelo topo da tela.
        </p>
        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={onAccept} disabled={accept.isPending}>{accept.isPending ? 'Entrando…' : 'Entrar na casa'}</Button>
          <Link to="/" className="text-sm font-semibold text-accent underline underline-offset-2">Voltar ao app</Link>
        </div>
        <p className="text-sm text-muted">O convite é para outra pessoa? Saia da sua conta antes de abrir o link.</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Você foi convidado">
      <p className="text-sm text-muted">Crie a sua conta para entrar na casa. Suas contas e receitas ficam junto com as de quem convidou.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="Seu nome" name="name" autoComplete="name" required value={name} onChange={(e) => { setName(e.target.value); edited('name') }} error={fields.name} />
        <Field
          label="E-mail" type="email" name="email" autoComplete="email" inputMode="email" autoCapitalize="none" required
          value={email} onChange={(e) => { setEmail(e.target.value); edited('email') }} error={fields.email}
        />
        <Field
          label="Senha" type="password" name="password" autoComplete="new-password" required hint="Mínimo de 10 caracteres."
          value={password} onChange={(e) => { setPassword(e.target.value); edited('password') }} error={fields.password}
        />
        <Button type="submit" disabled={busy || !name || !email || !password}>{busy ? 'Entrando…' : 'Criar conta e entrar'}</Button>
      </form>
      <p className="text-sm text-muted">
        Já tem conta?{' '}
        <Link
          to="/entrar"
          state={{ from: `/convite?token=${encodeURIComponent(token)}` }}
          className="font-semibold text-accent underline underline-offset-2"
        >
          Entrar e aceitar o convite
        </Link>
      </p>
    </AuthLayout>
  )
}
