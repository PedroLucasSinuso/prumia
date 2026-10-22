// Guarda a casa ativa no localStorage, por usuário. O acesso pode falhar (aba anônima, armazenamento bloqueado):
// nesse caso a escolha vale só até recarregar, e o app cai na 1ª casa.
const key = (userId: string) => `prumia.casaAtiva.${userId}`

export function readActiveHouse(userId: string): string | undefined {
  try {
    return localStorage.getItem(key(userId)) ?? undefined
  } catch {
    return undefined
  }
}

export function writeActiveHouse(userId: string, houseId: string) {
  try {
    localStorage.setItem(key(userId), houseId)
  } catch {
    // sem armazenamento: segue só na memória
  }
}
