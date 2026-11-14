# Avisos de vencimento por Web Push

Responde: como o prumia avisa do que vence sem o app aberto, o que é guardado, o que sai do servidor e como ligar.

## O que faz

Uma vez por dia, a partir das 9 h (`PUSH_DIGEST_HOUR`, fuso `APP_TIMEZONE`), cada pessoa que **ligou os avisos em algum
aparelho** recebe **um aviso por casa** de que participa, se houver conta pendente **atrasada, de hoje ou de amanhã**:

> prumia · 2 contas atrasadas (R$ 150,50) · 1 vence hoje (R$ 99,90) · 1 vence amanhã (R$ 200,00)

Só contagens e totais, sem descrição das contas. Quem está em mais de uma casa vê o nome da casa no título. É opcional em
dois níveis: o servidor só liga com chaves VAPID, e cada pessoa liga aparelho por aparelho em **Ajustes > Avisos**.

## Web Push em um parágrafo (para quem vem de PHP)

Não há fila própria nem serviço pago. O navegador entrega ao app uma **assinatura**: uma URL do serviço de push do
fabricante (Google/FCM, Mozilla, Apple, Microsoft) e duas chaves do aparelho. Para avisar, o servidor **cifra** a mensagem com
essas chaves (RFC 8291, `aes128gcm`) e faz um `POST` na URL, assinado com o par de chaves **VAPID** do servidor (RFC 8292),
que identifica quem está mandando. O fabricante só transporta o pacote cifrado e acorda o **service worker** do app
(`web/public/sw.js`), que mostra a notificação. Biblioteca: `github.com/SherClockHolmes/webpush-go`.

## Peças

| Onde | Papel |
|---|---|
| `api/migrations/00016_push.sql` | `push_subscriptions` (um aparelho por linha) e `push_digests` (um aviso por pessoa, casa e dia) |
| `api/internal/push/push.go` | `Service`: `Subscribe`, `Unsubscribe`, `SendTest`, `RunDue` (o aviso do dia) e `AllowedEndpoint` |
| `api/internal/push/webpush.go` | `WebPushSender` (envio de verdade) e `GenerateKeys`; `Sender` é interface para o teste trocar por um falso |
| `api/internal/api/push.go` | handlers de `/push/config`, `/push/subscriptions`, `/push/unsubscribe`, `/push/test` |
| `api/cmd/api/main.go` | `api push-keys` e a goroutine que chama `RunDue` a cada 10 minutos |
| `web/public/sw.js` | eventos `push` (mostra) e `notificationclick` (foca ou abre o app) |
| `web/src/lib/push.ts` | estado do aparelho, `enablePush`, `disablePush`, `dropLocalPush` (no logout) |
| `web/src/components/settings/NotificationsSection.tsx` | Ajustes > Avisos |

## Ligar no servidor

```bash
make push-keys            # imprime VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY: cole as duas linhas no .env
# no .env: VAPID_SUBJECT=mailto:voce@exemplo.com   (ou deixe vazio se PUBLIC_URL for https)
make backup && make up    # a 00016 sobe sozinha (AUTO_MIGRATE)
```

| Variável | Padrão | Uso |
|---|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | vazias | Par de chaves do servidor. Sem as duas, os avisos ficam **desligados**; só uma é erro na subida |
| `VAPID_SUBJECT` | `PUBLIC_URL` se https | Contato que o serviço de push pode usar (`mailto:` ou URL https). É o único dado seu que o fabricante recebe |
| `PUSH_DIGEST_HOUR` | `9` | A partir de que hora (0 a 23) o aviso do dia sai |

- A **chave privada é segredo** (fica só no `.env`, nunca em log nem no git). Trocar o par invalida todas as assinaturas: os
  aparelhos precisam ligar os avisos de novo.
- **HTTPS é obrigatório** (service worker e Push API só existem em contexto seguro): Cloudflare Tunnel ou `tailscale serve`.
- **iPhone/iPad:** só com o PWA **instalado na tela inicial** (iOS 16.4+). No Safari comum a `PushManager` não existe e a tela
  explica isso.

## Regras e decisões

- **Assinatura presa à sessão.** `push_subscriptions.session_hash` aponta para `sessions(token_hash)` com `ON DELETE CASCADE`,
  e todo envio exige `sessions.expires_at > agora`. Sair da conta, encerrar as outras sessões ou a sessão vencer **desliga o
  aparelho no servidor**, sem depender de o navegador cooperar. O front também desfaz a assinatura local no logout.
- **Um aviso por pessoa, casa e dia.** `RunDue` busca tudo numa consulta (sem N+1), envia e grava `push_digests`. Reiniciar a
  API ou rodar duas vezes não repete aviso. Se **nada** foi entregue por falha passageira (rede, 5xx, 429), o registro não é
  gravado e a rodada seguinte (10 min) tenta de novo.
- **Assinatura morta se limpa sozinha.** `404`/`410` do serviço de push (app desinstalado, permissão revogada) apaga a linha.
- **Isolamento por casa.** A consulta parte de `household_members` (com `left_at IS NULL`) e junta `invoices` pelo
  `household_id`: ninguém é avisado de casa de que não participa, e quem saiu deixa de ser. `viewer` também recebe (é leitura).
- **Estado derivado**, como no resto do app: pendente = `paid_at IS NULL` e `deleted_at IS NULL`; atrasada = `due_date < hoje`.
- **Limites:** 10 aparelhos por pessoa (o mais antigo sai); aviso de teste limitado a 1 a cada 20 s por pessoa (folga de 3).

## Segurança

- **SSRF.** O `endpoint` vem do navegador e o servidor faz `POST` nele. `AllowedEndpoint` só aceita `https`, porta padrão, sem
  usuário na URL e host de serviço de push conhecido (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`,
  `*.notify.windows.com`). O cliente HTTP **não segue redirecionamento** e tem prazo de 10 s. O schema repete o `https://`.
- **Privacidade.** A mensagem é cifrada de ponta a ponta: o fabricante vê só a URL do aparelho, o tamanho e o horário. Mesmo
  assim o texto traz só contagens e totais, porque a notificação aparece na tela bloqueada. Nada do aviso é guardado no aparelho.
- **Saída de rede nova.** Com os avisos ligados, a API passa a chamar os serviços de push dos navegadores (além da BrasilAPI).
  Sem chaves VAPID, nenhuma chamada sai.
- **Chaves do aparelho** (`p256dh`, `auth`) ficam no banco em claro: sozinhas não servem para nada sem a chave VAPID privada.
  Nunca vão para log.
- Ninguém apaga a assinatura de outra pessoa: `Unsubscribe` filtra por `user_id`.

## Testes

- `api/internal/push`: `AllowedEndpoint` (hosts falsos, http, porta, usuário), texto do aviso (singular/plural, várias casas) e
  o **envio real contra um servidor local** (confere `aes128gcm`, cabeçalho VAPID, TTL e que o texto não trafega em claro).
- `api/internal/api/push_test.go` (Postgres real): desligado sem chaves (503), exige sessão, recusa endpoint desconhecido,
  assinar/testar/desligar, aviso do dia (atrasadas, hoje, amanhã; pagas e futuras fora; antes da hora; sem repetir), isolamento
  por casa, logout desliga o aparelho, assinatura morta apagada, falha passageira tenta de novo, limite de aparelhos.
- `api/internal/platform/db/migrate_push_test.go`: 00016 Up/Down/Up com dados e as regras do schema.
- Front: `src/pwa.test.ts` (eventos `push` e `notificationclick` do service worker) e `src/pages/Notifications.test.tsx` (cada
  estado da tela).
- **Não dá para automatizar:** a entrega de verdade (depende do Google/Apple/Mozilla e de um aparelho). Teste manual abaixo.

## Teste manual (celular real)

1. `make push-keys`, cole no `.env`, `make backup && make up`.
2. No celular, abra o prumia instalado, **Ajustes > Avisos > Ligar avisos neste aparelho** e permita.
3. **Enviar aviso de teste**: a notificação chega em segundos, com o app aberto e com ele fechado.
4. Lance uma conta vencendo hoje. Para não esperar as 9 h do dia seguinte: `PUSH_DIGEST_HOUR=0` no `.env`, `make up`, e o aviso
   sai em até 10 minutos (uma vez só no dia). Volte o valor depois.
5. Toque no aviso: o prumia abre.
6. Saia da conta e confira em `make logs` que o próximo ciclo não envia nada para esse aparelho.
