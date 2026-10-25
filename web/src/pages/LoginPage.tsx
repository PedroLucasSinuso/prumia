import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Field } from '../components/Field'
import { FormError } from '../components/FormError'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    const result = await login(email.trim(), password)
    setBusy(false)
    if (result.ok) {
      navigate(from, { replace: true })
      return
    }
    setError(result.network ? networkErrorMessage : problemMessage(result.problem))
    setFields(problemFields(result.problem))
  }

  return (
    <AuthLayout title="Entrar">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            edited('password')
          }}
          error={fields.password}
        />
        <Button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Primeiro acesso?{' '}
        <Link to="/cadastro" className="font-semibold text-accent underline underline-offset-2">
          Criar conta
        </Link>
      </p>
    </AuthLayout>
  )
}
