import { useState } from 'react'

import type { Member, Role } from '../api/types'
import { roleHelp, roleLabel } from '../lib/roles'

type Props = {
  members: Member[]
  meId: string
  isAdmin: boolean
  busy: boolean
  onRole: (userId: string, role: Role) => void
  onRemove: (m: Member) => void
  onResetLink: (m: Member) => void
}

/** Pessoas da casa na linha de prumo: um nó por pessoa. Admin muda o papel, gera link de senha ou remove; qualquer um pode sair. */
export function MembersList({ members, meId, isAdmin, busy, onRole, onRemove, onResetLink }: Props) {
  const [confirming, setConfirming] = useState<string>()
  return (
    <ul className="relative flex flex-col">
      <span aria-hidden="true" className="absolute bottom-6 left-[11px] top-6 w-px bg-teal/40" />
      {members.map((m) => {
        const self = m.userId === meId
        return (
          <li key={m.userId} className="relative flex gap-3 py-3 pl-0">
            <span aria-hidden="true" className="z-10 mt-1 flex size-6 shrink-0 items-center justify-center border-2 border-teal bg-ivory font-mono text-xs font-semibold text-teal">
              {m.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {m.name} {self && <span className="text-xs font-normal text-graphite/70">(você)</span>}
              </p>
              <p className="truncate text-xs text-graphite/80">{m.email}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                {isAdmin ? (
                  <label className="flex items-center gap-2 text-xs text-graphite/80">
                    papel
                    <select
                      aria-label={`Papel de ${m.name}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => onRole(m.userId, e.target.value as Role)}
                      className="h-11 rounded-md border border-graphite/25 bg-white/40 px-2 text-sm text-graphite"
                    >
                      {(Object.keys(roleLabel) as Role[]).map((r) => (
                        <option key={r} value={r}>{roleLabel[r]} — {roleHelp[r]}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="text-xs text-graphite/80">{roleLabel[m.role]} · {roleHelp[m.role]}</span>
                )}
                {isAdmin && !self && (
                  <button onClick={() => onResetLink(m)} className="h-11 text-sm font-semibold text-cobalt underline underline-offset-4">
                    link de nova senha
                  </button>
                )}
                {(isAdmin || self) &&
                  (confirming === m.userId ? (
                    <span className="flex items-center gap-3">
                      <button onClick={() => { setConfirming(undefined); onRemove(m) }} className="h-11 text-sm font-semibold text-graphite underline underline-offset-4">
                        {self ? 'Confirmar saída' : `Confirmar remoção de ${m.name}`}
                      </button>
                      <button onClick={() => setConfirming(undefined)} className="h-11 text-sm text-graphite/80 underline underline-offset-4">cancelar</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirming(m.userId)} className="h-11 text-sm font-semibold text-graphite/80 underline underline-offset-4">
                      {self ? 'sair da casa' : 'remover'}
                    </button>
                  ))}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
