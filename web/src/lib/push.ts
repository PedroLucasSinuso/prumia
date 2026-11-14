// Avisos de vencimento por Web Push, lado do navegador. O service worker (public/sw.js) mostra o aviso; aqui ligamos e
// desligamos a "assinatura" do aparelho e a entregamos à API (PUT /push/subscriptions). Guia: docs/developer-guide/push-notifications.md.
import { api } from '../api/client'
import { unwrap } from '../api/errors'

/**
 * - `unsupported`: o navegador não tem Web Push, ou o service worker não está registrado (em desenvolvimento, sem HTTPS, ou
 *   no iPhone com o prumia aberto no Safari em vez de instalado na tela inicial);
 * - `denied`: a pessoa bloqueou as notificações do site no navegador (só ela desfaz, nas configurações dele);
 * - `off` / `on`: avisos desligados ou ligados NESTE aparelho.
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return undefined
  // getRegistration (e não `ready`): `ready` nunca resolve quando não há service worker, e a tela ficaria esperando.
  return (await navigator.serviceWorker.getRegistration()) ?? undefined
}

export async function pushState(): Promise<PushState> {
  const reg = await registration()
  if (!reg) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

/** A chave pública VAPID chega em base64url; o navegador quer os bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/**
 * Liga os avisos neste aparelho: pede a permissão (precisa vir de um toque da pessoa), assina no serviço de push do
 * navegador e guarda a assinatura na API. Se a API recusar, desfaz a assinatura local para não ficar um estado pela metade.
 */
export async function enablePush(publicKey: string): Promise<PushState> {
  const reg = await registration()
  if (!reg) return 'unsupported'
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off'
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  const json = sub.toJSON()
  try {
    await unwrap(api.PUT('/push/subscriptions', { body: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } } }))
  } catch (err) {
    await sub.unsubscribe().catch(() => {})
    throw err
  }
  return 'on'
}

/** Desliga os avisos neste aparelho (no navegador e na API). */
export async function disablePush(): Promise<PushState> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (!reg || !sub) return reg ? 'off' : 'unsupported'
  await sub.unsubscribe()
  // Se a API estiver fora do ar a assinatura some do mesmo jeito: o servidor a apaga ao receber "assinatura morta".
  await unwrap(api.POST('/push/unsubscribe', { body: { endpoint: sub.endpoint } })).catch(() => {})
  return 'off'
}

/** Ao sair da conta: o aparelho para de receber avisos. O servidor já apaga a assinatura junto com a sessão. */
export async function dropLocalPush(): Promise<void> {
  try {
    const sub = await (await registration())?.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    // sem service worker ou sem permissão: nada a desfazer
  }
}
