import { useState, type FormEvent } from 'react'

import { api } from '../../api/client'
import type { Me } from '../../api/types'
import { useAuth } from '../../auth/context'
import { networkErrorMessage, problemFields, problemMessage } from '../../auth/errors'
import { Button } from '../Button'
import { Field } from '../Field'
import { useToast } from '../toastContext'
import { Card, SectionHeader } from './ui'

const MIN_PASSWORD = 10 // igual ao cadastro (openapi: newPassword.minLength)

/**
 * Ajustes > Minha conta: nome, troca de senha e "sair dos outros aparelhos".
 * Trocar a senha encerra as OUTRAS sessões (a atual continua). Nenhuma senha vai para log ou para o estado global:
 * ela só vive nos campos enquanto o formulário está aberto e é limpa depois do envio.
 */
export function AccountSection({ me }: { me: Me }) {
  return (
    <div>
      <SectionHeader title="Minha conta" description={`Entrou como ${me.email}.`} />
      <div className="flex max-w-xl flex-col gap-4">
        <NameCard me={me} />
        <PasswordCard />
        <SessionsCard />
      </div>
    </div>
  )
}

function NameCard({ me }: { me: Me }) {
  const { refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(me.name)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const { error: problem } = await api.PATCH('/auth/me', { body: { name: name.trim() } })
      if (problem) setError(problemFields(problem).name ?? problemMessage(problem))
      else {
        await refresh()
        toast({ message: 'Nome atualizado.' })
      }
    } catch {
      setError(networkErrorMessage)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card label="Dados pessoais">
      <form onSubmit={save} className="flex flex-col gap-3" noValidate>
        <Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={error} />
        <div>
          <Button type="submit" disabled={busy || !name.trim() || name.trim() === me.name}>
            Salvar nome
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PasswordCard() {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [errors, setErrors] = useState<{ current?: string; next?: string; general?: string }>({})
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (next.length < MIN_PASSWORD) return setErrors({ next: `Use pelo menos ${MIN_PASSWORD} caracteres.` })
    setBusy(true)
    setErrors({})
    try {
      const { error } = await api.POST('/auth/password', { body: { currentPassword: current, newPassword: next } })
      if (error) {
        const f = problemFields(error)
        if (f.currentPassword || f.newPassword) setErrors({ current: f.currentPassword, next: f.newPassword })
        else setErrors({ general: problemMessage(error) })
      } else {
        setCurrent('')
        setNext('')
        toast({ message: 'Senha trocada. Os outros aparelhos foram desconectados.' })
      }
    } catch {
      setErrors({ general: networkErrorMessage })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card label="Senha" title="Trocar senha">
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3" noValidate>
        <Field label="Senha atual" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
        <Field label="Nova senha" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={errors.next} hint={`Pelo menos ${MIN_PASSWORD} caracteres.`} />
        {errors.general && (
          <p role="alert" className="text-sm">
            <span className="font-mono text-alert">[ ✖ ]</span> {errors.general}
          </p>
        )}
        <div>
          <Button type="submit" disabled={busy || !current || !next}>
            Trocar senha
          </Button>
        </div>
      </form>
    </Card>
  )
}

function SessionsCard() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function endOthers() {
    setBusy(true)
    try {
      const { data, error } = await api.DELETE('/auth/sessions/others')
      if (error || !data) throw new Error('falhou')
      toast({ message: data.ended > 0 ? `Desconectado de ${data.ended} ${data.ended === 1 ? 'outro aparelho' : 'outros aparelhos'}.` : 'Não havia outros aparelhos conectados.' })
    } catch {
      toast({ message: 'Não foi possível desconectar os outros aparelhos. Tente de novo.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card label="Aparelhos" title="Aparelhos conectados">
      <p className="mt-2 text-sm text-ink/80">Perdeu o celular ou entrou num computador emprestado? Saia de todos os outros aparelhos; este continua conectado.</p>
      <Button variant="ghost" className="mt-3" onClick={() => void endOthers()} disabled={busy}>
        Sair dos outros aparelhos
      </Button>
    </Card>
  )
}
