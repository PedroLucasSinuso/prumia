import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Field } from '../components/Field'
import { FormError } from '../components/FormError'
import { useLinkToken } from '../lib/useLinkToken'

/**
 * Cadastro. Sem convite, só vale para a primeira conta do sistema (depois o servidor responde `registration_closed`).
 * Com o link de **convite de cadastro** (`/cadastro#token=…`, gerado pelo dono do sistema em Ajustes > Minha conta), a
 * pessoa cria a própria conta e a própria casa; o token vai como `signupToken` e é de uso único.
 */
export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const signupToken = useLinkToken()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [householdName, setHouseholdName] = useState('')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // Editar um campo apaga o aviso dele (e o aviso geral): evita erro velho na tela.
  function edited(field: string) {
    setFields(({ [field]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    setFields({})
    const result = await register({
      name: name.trim(), email: email.trim(), password, householdName: householdName.trim(),
      ...(signupToken ? { signupToken } : {}),
    })
    setBusy(false)
    if (result.ok) {
      navigate('/', { replace: true })
      return
    }
    setError(result.network ? networkErrorMessage : problemMessage(result.problem))
    setFields(problemFields(result.problem))
  }

  return (
    <AuthLayout title="Criar conta">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {signupToken && (
          <p className="rounded-md bg-sunken px-3 py-2 text-sm text-ink">
            <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span> Você recebeu um convite: crie a sua conta e a sua casa.
          </p>
        )}
        <FormError message={error} />
        <Field label="Seu nome" name="name" autoComplete="name" required value={name} onChange={(e) => {
            setName(e.target.value)
            edited('name')
          }} error={fields.name} />
        <Field
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            edited('email')
          }}
          error={fields.email}
        />
        <Field
          label="Senha"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            edited('password')
          }}
          hint="Mínimo de 10 caracteres."
          error={fields.password}
        />
        <Field
          label="Nome da casa"
          name="householdName"
          required
          value={householdName}
          onChange={(e) => {
            setHouseholdName(e.target.value)
            edited('householdName')
          }}
          hint="Opcional. Ex.: Casa do Pedro e da Ana. Você poderá convidar quem mora com você depois."
          error={fields.householdName}
        />
        <Button type="submit" disabled={busy || !name || !email || !password}>
          {busy ? 'Criando…' : 'Criar conta'}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Já tem conta?{' '}
        <Link to="/entrar" className="font-semibold text-accent underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  )
}
