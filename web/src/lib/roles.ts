import type { Role } from '../api/types'

export const roleLabel: Record<Role, string> = { admin: 'admin', member: 'membro', viewer: 'leitura' }
export const roleHelp: Record<Role, string> = {
  admin: 'Gerencia a casa e as pessoas',
  member: 'Lança e paga contas',
  viewer: 'Só vê',
}
