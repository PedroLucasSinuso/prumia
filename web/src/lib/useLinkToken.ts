import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** Lê o token de `#token=…` (formato atual) ou de `?token=…` (links gerados antes da mudança, ainda válidos). */
export function linkToken(hash: string, search: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? new URLSearchParams(search).get('token') ?? ''
}

/**
 * Token dos links de convite e de nova senha. Ele fica no FRAGMENTO (`/convite#token=…`): o que vem depois do `#` nunca
 * sai do navegador, então não aparece em logs do nginx, do túnel nem de nenhum proxy no caminho.
 * Link antigo (`?token=…`): a página funciona igual e a barra de endereço é reescrita para o formato com `#` (sem recarregar),
 * para que atualizar a página não mande o token ao servidor de novo.
 */
export function useLinkToken(): string {
  const { pathname, search, hash, state } = useLocation()
  const navigate = useNavigate()
  const token = linkToken(hash, search)
  const legacy = !new URLSearchParams(hash.replace(/^#/, '')).get('token') && new URLSearchParams(search).has('token')
  useEffect(() => {
    if (legacy && token) navigate(`${pathname}#token=${encodeURIComponent(token)}`, { replace: true, state })
  }, [legacy, token, pathname, state, navigate])
  return token
}
