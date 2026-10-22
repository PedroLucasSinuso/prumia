# Deployment: Tailscale com HTTPS (fase 1)

Responde: como o prumia fica acessível pelo celular **só para os seus aparelhos**, com HTTPS, sem abrir nada para a
internet; quais variáveis do `.env` importam; e como diagnosticar quando algo dá errado. Guia para leigos:
[acessar-pelo-celular.md](../user-guides/acessar-pelo-celular.md). Segurança em geral: [security.md](security.md).

## Arquitetura de acesso

```
celular (app Tailscale)
   │  WireGuard (cifrado), só aparelhos do seu tailnet
   ▼
PC: tailscaled ── tailscale serve --https=443 ──► http://127.0.0.1:8080  (TLS termina aqui; certificado *.ts.net)
                                                     │  Host: pc.tailXXXX.ts.net (preservado)
                                                     │  X-Forwarded-Proto: https
                                                     ▼
                                     container web (nginx sem root, escuta 8080) ── /api ──► container api ──► db
```

- O compose publica **só** o `web`, e só em `127.0.0.1:${WEB_PORT}` (`WEB_BIND=127.0.0.1`). Ninguém da rede local alcança
  o app diretamente; quem entra é o `tailscale serve`, que roda no próprio PC.
- `tailscale serve` (não confundir com `funnel`) atende **somente** dentro do tailnet. O endereço é
  `https://<máquina>.<tailnet>.ts.net`, com certificado válido emitido pelo Tailscale (Let's Encrypt).
- Pré-requisitos no painel do Tailscale (<https://login.tailscale.com/admin/dns>): **MagicDNS** ligado e **HTTPS
  Certificates** habilitado. Sem isso o `serve --https` falha ou o nome não resolve.

Comandos (na raiz do repo):

| Comando | O que faz |
|---|---|
| `make tailscale-up` | roda `scripts/tailscale-serve.sh up`: `tailscale serve --bg --https=443 http://127.0.0.1:$WEB_PORT` (idempotente) e mostra o endereço; avisa se `APP_ENV` não for `production` |
| `make tailscale-status` | `tailscale serve status` + endereço |
| `scripts/tailscale-serve.sh off` | desliga o HTTPS na 443 |

O script não instala nada: sem o comando `tailscale`, só imprime o que rodaria. `--bg` grava a regra no `tailscaled`,
que a reaplica sozinho depois de reiniciar o PC.

## Produção x desenvolvimento

| | Uso real (Tailscale + HTTPS) | Desenvolvimento local |
|---|---|---|
| `APP_ENV` | `production` | `development` (padrão do `.env.example`) |
| Endereço | `https://<máquina>.<tailnet>.ts.net` | `http://localhost:8080` |
| Cookie de sessão | `HttpOnly; Secure; SameSite=Lax` | sem `Secure` |
| Gin | modo release | debug |
| HSTS | enviado (a requisição chega com `X-Forwarded-Proto: https`) | não enviado |

Por que `APP_ENV=production` liga o cookie `Secure`: com `Secure`, o navegador **só** devolve o cookie de sessão por HTTPS,
então ele nunca vaza num acesso http por engano. A contrapartida: com `production`, acessar por `http://` (sem o
`tailscale serve` na frente) **não mantém o login** (o navegador recebe o cookie, mas não o devolve; Chrome e Firefox abrem
exceção para `http://localhost`, outros navegadores não). Por isso o desenvolvimento local continua em `development`.

Para trocar de modo: edite `APP_ENV` no `.env` e rode `make up` (recria a API com a nova variável).

## HSTS condicional

O nginx recebe HTTP puro do `tailscale serve`; HTTPS só existe entre o celular e o `tailscaled`. Um HSTS fixo seria
enviado também no acesso `http://localhost`, então ele é condicional (`deploy/nginx/default.conf`):

```nginx
map $http_x_forwarded_proto $prumia_hsts {
    default "";
    https   "max-age=31536000";
}
add_header Strict-Transport-Security $prumia_hsts always;   # valor vazio = cabeçalho não sai
```

O `add_header` está no `server` e repetido em cada `location` que tem `add_header` próprio (no nginx, um `add_header` dentro
de um location apaga os herdados). Forjar `X-Forwarded-Proto: https` num acesso HTTP não tem efeito: o navegador ignora
HSTS recebido fora de HTTPS. Sem `includeSubDomains` e sem `preload`: o nome `*.ts.net` não é nosso.

Conferir (o `tailscale serve` manda `X-Forwarded-Proto: https`; **confirme no teste manual**):

```bash
curl -sI https://<máquina>.<tailnet>.ts.net/ | grep -i strict-transport   # deve aparecer max-age=31536000
curl -sI http://127.0.0.1:8080/ | grep -i strict-transport                # não deve aparecer nada
```

Se o primeiro não mostrar o cabeçalho, a versão do Tailscale não manda `X-Forwarded-Proto`; nada quebra (só fica sem HSTS).

## Host preservado e o 403 `bad_origin`

A API recusa toda escrita (POST/PUT/PATCH/DELETE) cujo `Origin` não bate com o `Host` (anti-CSRF; ver
[security.md](security.md)). Isso só funciona porque a cadeia inteira preserva o Host que o navegador usou:

- o `tailscale serve` repassa `Host: <máquina>.<tailnet>.ts.net`;
- o nginx repassa `proxy_set_header Host $http_host` (com porta, se houver);
- o esquema (http/https) não entra na comparação, porque o nginx só vê HTTP.

**Sintoma**: a página abre, mas entrar/salvar qualquer coisa dá erro e a API responde 403 com `"code":"bad_origin"`.

Diagnóstico:

```bash
# 1) Simula o navegador direto no nginx: Host e Origin iguais -> 200 (ou 401 com senha errada), nunca 403.
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: pc.tail1234.ts.net' -H 'Origin: https://pc.tail1234.ts.net' \
  -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"errada12345"}' http://127.0.0.1:8080/api/auth/login
# 2) Host diferente do Origin -> 403 bad_origin (é o que acontece se o proxy da frente trocar o Host).
curl -s -H 'Host: 127.0.0.1:8080' -H 'Origin: https://pc.tail1234.ts.net' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8080/api/auth/login
# 3) Pelo tailnet de verdade, a partir de outro aparelho do tailnet:
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://<máquina>.<tailnet>.ts.net' \
  -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"errada12345"}' https://<máquina>.<tailnet>.ts.net/api/auth/login
```

Se (1) passa e (3) dá 403, o Host está sendo trocado antes do nginx: confira `tailscale serve status` (o destino tem de ser
`http://127.0.0.1:<WEB_PORT>`, sem outro proxy no meio) e, se preciso, registre temporariamente `$http_host` no log do nginx
para ver o que chega. Não "conserte" afrouxando a checagem na API. Alternativa sem `serve`: `WEB_BIND=<IP 100.x do
Tailscale>` e acesso por `http://100.x.y.z:8080` (cifrado pelo WireGuard, mas sem HTTPS: use `APP_ENV=development`).

## Variáveis do `.env`

| Variável | Uso real (Tailscale) | Observação |
|---|---|---|
| `APP_ENV` | `production` | cookie `Secure`, Gin release; `development` para http local |
| `APP_TIMEZONE` | `America/Sao_Paulo` | |
| `OPEN_REGISTRATION` | `false` | só o 1º usuário se cadastra sozinho; o resto por convite |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | gerados por `make env` | senha só com letras e números |
| `WEB_PORT` | `8080` | porta local que o `tailscale serve` aponta |
| `WEB_BIND` | `127.0.0.1` | nunca `0.0.0.0` |
| `DB_PORT` | `5433` | só com `make db-expose` (DBeaver), sempre em 127.0.0.1 |

## Containers

- `web`: imagem `nginxinc/nginx-unprivileged:alpine` (uid 101, sem root), escuta 8080 dentro do container; `read_only`,
  `/tmp` em `tmpfs` (pid e buffers), `cap_drop: ALL`, `no-new-privileges`.
- `api`: uid 10001, `cap_drop: ALL`, `no-new-privileges`, `/tmp` em memória.
- `db`: sem porta publicada; `deploy/compose.dbeaver.yaml` publica em `127.0.0.1:${DB_PORT}` sob demanda
  ([getting-started.md](getting-started.md#acessar-o-banco-pelo-dbeaver)).

## Fase 2 (VPS)

Ainda não documentada: certbot/TLS no nginx (ou proxy TLS na frente mandando `X-Forwarded-Proto: https`), firewall e backup
fora da máquina.
