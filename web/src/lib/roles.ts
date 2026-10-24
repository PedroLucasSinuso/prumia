import type { Role } from '../api/types'

// Nomes na tela. Os papéis internos (admin/member/viewer) não mudam; só como aparecem.
export const roleLabel: Record<Role, string> = { admin: 'Responsável', member: 'Participante', viewer: 'Só leitura' }
export const roleHelp: Record<Role, string> = {
  admin: 'Cuida das finanças da casa: convida pessoas e mexe nos ajustes',
  member: 'Lança, edita e paga contas e receitas, mas não mexe nos ajustes',
  viewer: 'Só consulta, não altera nada',
}
