import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Field } from '../components/Field'
import { FormError } from '../components/FormError'
import { useLinkToken } from '../lib/useLinkToken'

/** Destino do link de nova senha gerado por um admin (/redefinir-senha#token=…; o formato antigo ?token=… ainda vale). Ao concluir, as sessões antigas caem e a pessoa entra de novo. */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const token = useLinkToken()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      const { error: problem, response } = await api.POST('/auth/password-reset', { body: { token, newPassword: password } })
      if (response.ok) {
        navigate('/entrar', { replace: true })
        return
      }
      setError(problem?.code === 'validation_error' ? problemMessage(problem) : 'Este link é inválido ou expirou. Peça um novo a quem administra a casa.')
      setFields(problemFields(problem))
    } catch {
      setError(networkErrorMessage)
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Nova senha">
        <p className="text-sm text-muted">Este link está incompleto. Peça a quem administra a casa para gerar um novo.</p>
        <Link to="/entrar" className="text-sm font-semibold text-accent underline underline-offset-2">Ir para o login</Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Nova senha">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field
          label="Nova senha" type="password" name="password" autoComplete="new-password" required hint="Mínimo de 10 caracteres."
          value={password} onChange={(e) => { setPassword(e.target.value); setError(undefined) }} error={fields.newPassword}
        />
        <Button type="submit" disabled={busy || password.length === 0}>{busy ? 'Salvando…' : 'Salvar nova senha'}</Button>
      </form>
    </AuthLayout>
  )
}
