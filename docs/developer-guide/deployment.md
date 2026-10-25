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
| `PUBLIC_URL` | `https://app.seudominio.com.br` (ou o endereço do `tailscale serve`) | endereço público, sem barra final; vai nos links de convite e de nova senha (a API o devolve em `/auth/me` como `publicUrl`). Sem ele, o link sai com o endereço do navegador de quem gera, e `localhost` não abre no celular de quem recebe |
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

## Cloudflare Tunnel (domínio próprio, app no seu computador)

Alternativa ao Tailscale quando a pessoa quer abrir o app por um endereço comum (`https://app.seudominio.com.br`) em qualquer aparelho,
sem instalar nada nele. O app continua rodando no seu computador; um container `cloudflared` faz uma conexão **de saída** para a
Cloudflare e a Cloudflare entrega as requisições por ela. Não abre porta no roteador e o IP de casa não aparece. O HTTPS é da Cloudflare.

```
navegador --HTTPS--> Cloudflare --túnel--> cloudflared --HTTP--> web:8081 (nginx) --> api --> db
```

O túnel é **gerenciado localmente** (credenciais em `.cloudflared/`, fora do Git): só precisa de conta gratuita e do domínio na Cloudflare.
Não precisa ativar o Zero Trust, que pede cartão ou PayPal mesmo no plano grátis.

### Passo a passo

1. **Domínio na Cloudflare**: crie conta, **Add a domain**, plano **Free**. Mantenha os registros que ela importar. Ela mostra dois nameservers.
2. **Registro do domínio**: troque os servidores DNS do domínio pelos dois da Cloudflare (no Registro.br: painel do domínio >
   "Alterar servidores DNS"). Se o DNSSEC estiver ativo no registro, desligue antes de trocar. A propagação leva de minutos a algumas
   horas; a Cloudflare manda um e-mail quando o domínio ficar **Active**. Espere isso antes do próximo passo.
3. **`.env`**: `TUNNEL_HOSTNAME=app.seudominio.com.br`, `APP_ENV=production` e `OPEN_REGISTRATION=false`.
4. **`make tunnel-setup`** (uma vez): abre um endereço da Cloudflare para você autorizar o domínio, cria o túnel `prumia`, cria o DNS
   do endereço e grava `.cloudflared/config.yml`. As credenciais ficam só nessa pasta (ela está no `.gitignore`).
5. **`make tunnel-up`**: liga o `cloudflared`. Para desligar: `make tunnel-down` (o app volta a ficar só em localhost).
6. Abra `https://app.seudominio.com.br` de outro aparelho (rede móvel). Deve aparecer o login do prumia.

**Proteção do app**: ele fica exposto só com o próprio login (argon2id, limite de tentativas por IP e por e-mail, cadastro fechado
a quem não tem convite). Não há camada extra na frente (decisão do dono: o app é usado por duas pessoas).

### Por que a porta 8081

O limite de tentativas de login usa o IP do cliente. Atrás do túnel o nginx só vê o container do `cloudflared`; o IP real vem no cabeçalho
`CF-Connecting-IP`, que a Cloudflare escreve. O nginx escuta em duas portas (`deploy/nginx/default.conf`): a **8080** (publicada em
`127.0.0.1`) usa o IP que ele viu; a **8081** (só dentro da rede do compose, **nunca publicada**) confia em `CF-Connecting-IP`.
Como só o túnel chega na 8081, o cabeçalho não pode ser forjado por quem acessa direto: forjá-lo na 8080 não adianta (testado: 14
tentativas com IPs diferentes forjados na 8080 foram limitadas como um cliente só; pela 8081 cada IP real tem o seu limite).

### Cuidados

- O app só funciona com o computador ligado e o Docker rodando. Os containers já usam `restart: unless-stopped`. Agende o `make backup`.
- A Cloudflare termina o HTTPS e portanto vê o tráfego. Para nenhum intermediário, use o Tailscale (seção acima).
- `WEB_BIND` fica em `127.0.0.1`: o túnel não precisa de porta publicada.
- Nunca publique a porta 8081 (`ports:`) e nunca commite `.cloudflared/` (contém o certificado e as credenciais do túnel).
- **Primeiro cadastro:** com `OPEN_REGISTRATION=false` só o primeiro usuário se cadastra sozinho. Se o banco já tem a casa, ninguém mais consegue; num
  banco novo, crie a sua conta antes de divulgar o endereço.

## Fase 2 (VPS)

Ainda não documentada: certbot/TLS no nginx (ou proxy TLS na frente mandando `X-Forwarded-Proto: https`), firewall e backup
fora da máquina.
