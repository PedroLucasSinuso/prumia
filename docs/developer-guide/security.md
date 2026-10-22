# Segurança e desempenho

Responde: do que o prumia se protege, como, o que fica de fora e o que conferir antes de expor o app (Tailscale, VPS).
Detalhes de login e papéis: [authentication.md](authentication.md). Boleto: [boleto-extraction.md](boleto-extraction.md).

## Modelo de ameaças (simples)

O prumia é um app privado de poucas casas, exposto primeiro pelo Tailscale (fase 1) e depois numa VPS (fase 2).

| Quem | O que pode tentar | Defesa principal |
|---|---|---|
| Alguém sem conta que alcança a URL | adivinhar senha, cadastrar-se, explorar a API | cadastro só com convite; limite de tentativas por IP e por e-mail; argon2id; respostas que não revelam se o e-mail existe |
| Membro de **outra** casa (conta válida) | ler ou mexer em dados da sua casa trocando ids na URL | todo acesso passa pelo porteiro (membro ativo da casa da URL) e todo serviço filtra por `household_id`; FKs compostas no banco |
| `viewer` / `member` da sua casa | escrever sendo viewer; fazer operação de admin sendo member | papel conferido no middleware (viewer) e no serviço (admin); testes de varredura em todas as rotas |
| Site malicioso aberto no navegador de um membro | CSRF (POST com o cookie da sessão) | cookie `SameSite=Lax` + checagem de `Origin` em toda escrita |
| Quem lê logs ou um backup | colher tokens, senhas, linhas digitáveis | tokens e senhas só em hash; logs sem query string, sem corpo e sem valores de SQL |
| Membro que envia arquivo de boleto malicioso | derrubar o servidor (memória/CPU), executar comando | limite de 5 MB, checagem de dimensão antes de decodificar imagem, 2 leituras simultâneas, ferramentas sem shell e com `-dSAFER`, timeout |

**Fora do escopo** (aceitos conscientemente): quem já controla o servidor ou o Docker; quem tem a senha de um admin;
ataque de negação de serviço volumoso vindo da internet (o Tailscale já esconde o app; na VPS, use firewall/limites do provedor);
XSS por dependência comprometida no build do front (mitigado em parte pela CSP).

## O que é protegido e como

### Isolamento entre casas
- O `householdId` vem **só da URL**, nunca do corpo. O `auth.Middleware` exige membro ativo de casa não excluída; senão **404**
  (não revela que a casa existe).
- Cada serviço filtra `household_id` em toda consulta, inclusive nas atualizações em lote de séries e no job de horizonte.
- `api/internal/api/security_test.go` **varre todas as rotas registradas** no roteador: a casa B tenta cada uma pela URL
  da casa A (tem de dar 404) e pela própria URL com os ids da casa A (404), e uma "impressão digital" (md5 de todas as
  linhas da casa A em todas as tabelas) prova que nada mudou. Rota nova entra no teste sozinha.

### Papéis
- `viewer` nunca escreve: bloqueado no middleware (403 `read_only`), exceto sair da casa. A varredura cobre toda rota de escrita.
- Operações só de admin (renomear/excluir casa, mudar papel, remover outra pessoa, convites, link de nova senha) chamam
  `auth.RequireAdmin` no handler **e** conferem o papel no serviço (`household.Service.requireAdmin`, `lockMembers`,
  `auth.Service.CreateResetLink`). A varredura confirma 403 para `member` em todas elas.
- Pendência registrada: nas rotas de negócio (invoices, receitas, séries, categorias) o bloqueio do viewer está **só no
  middleware**, não dentro de cada serviço. Hoje toda rota passa pelo middleware (o teste garante), mas a regra do
  CLAUDE.md pede checagem no serviço; ver o PR de segurança para a decisão.

### Sessão, cookie e CSRF
- Token de 256 bits; no banco só o SHA-256. Cookie `prumia_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` com
  `APP_ENV=production`. Validade de 30 dias deslizante.
- **Login novo encerra a sessão anterior do mesmo navegador** (se havia cookie). Logout apaga a sessão no banco.
  Redefinição de senha apaga todas as sessões do usuário. Não há troca de senha logado (só por link de admin).
- CSRF: em POST/PUT/PATCH/DELETE, se o navegador manda `Origin`, o `host[:porta]` dele tem de ser igual ao `Host` que o
  nginx repassa (`$http_host`, com porta). Vale para `localhost:8080` e para `https://<máquina>.<tailnet>.ts.net`
  (o `tailscale serve` repassa o Host original; **confirmar no teste manual**: se todo POST der 403 `bad_origin` atrás dele,
  é porque o Host chegou trocado). O esquema (http/https) não entra na comparação: atrás de `tailscale serve` o nginx só
  vê HTTP. `Origin: null` e outra porta são recusados (403 `bad_origin`).

### IP real e limite de tentativas
- Limites (em memória, por instância): login 10/min por IP e 5/min por **e-mail normalizado** (minúsculas, sem espaços:
  variar a caixa não abre um balde novo); cadastro e redefinição 5/min por IP; leitura de boleto 10/min por usuário.
- O IP vem de `c.ClientIP()`, configurado assim (`platform/httpx/router.go`): só o cabeçalho **`X-Real-IP`**, e só quando a
  conexão vem de rede privada/loopback (o nginx na rede do Docker). O nginx **sobrescreve** `X-Real-IP` e `X-Forwarded-For`
  com o `$remote_addr` que ele viu.
- Antes: o Gin lia `X-Forwarded-For`, que o nginx **acrescentava** ao valor do cliente, e "pulava" IPs privados da direita para a
  esquerda. Um cliente com IP privado (LAN, o próprio host, `tailscale serve`) mandava um `X-Forwarded-For` diferente por
  tentativa e furava o limite por IP.
- Limitação conhecida: atrás de `tailscale serve` (ou do `docker-proxy` acessando por `127.0.0.1`), o nginx vê **o mesmo IP**
  para todo mundo (o gateway do Docker); o limite por IP vira um balde compartilhado da casa. O limite por e-mail continua
  individual. Se incomodar, publique a porta direto no IP do Tailscale (`WEB_BIND=100.x.y.z`), que preserva o IP de origem.

### Entrada
- Corpo JSON até **64 KB** (413 `body_too_large`, antes do argon2 do login); upload de boleto até 5 MB (o nginx aceita 6 MB só em `/api`).
- Strings com tamanho máximo no serviço (descrição 120, nome de categoria 60, observação 500, nome de casa 80, busca `q` 120,
  até 20 descontos); `limit` de paginação entre 1 e 200; valores entre 1 centavo e R$ 10 bilhões (sem estouro de `int64`).
- SQL sempre parametrizado (`?` do GORM ou `@nome`); nenhum `fmt.Sprintf` monta SQL com dado do usuário. A busca usa
  `ILIKE ... ESCAPE '\'` com `%` e `_` escapados (`invoice.EscapeLike`).
- Boleto: o tipo é detectado pelos bytes (não pela extensão); imagem acima de 40 megapixels é recusada **antes** de decodificar
  (um PNG de poucos KB declarando 60000x60000 pedia ~14 GB); no máximo 2 leituras simultâneas no servidor (503 `busy`);
  ferramentas externas sem shell, com timeout de 25 s e saída limitada.

### Segredos e logs
- Senhas: argon2id. Tokens de sessão, convite e redefinição: só SHA-256 no banco.
- Log de acesso da API: método, rota (o molde, ex. `/api/households/:householdId/invoices`), status e duração. Sem query, sem corpo.
- Log de SQL do GORM: **sem os valores** dos parâmetros (`ParameterizedQueries`, inclusive no caminho `Raw().Scan()`, que
  o GORM loga à parte) e sem "record not found". Antes, cada login com e-mail errado gravava o e-mail no log, e em desenvolvimento
  todo SQL saía com hashes, linhas digitáveis e valores. Teste: `platform/db/logger_test.go`.
- nginx: formato de log próprio **sem query string e sem Referer** (os links de convite e de nova senha levam o token na query).
- Erros 500 respondem só `internal_error`; pânico é recuperado sem stack trace na resposta (teste em `platform/httpx`).
- `.env.example` só tem valores de exemplo; `.env` está no `.gitignore`. A senha do Postgres é gerada por `make env`.

### Containers e cabeçalhos
- API roda como usuário sem privilégio (uid 10001), sem capacidades do kernel (`cap_drop: ALL`) e com `no-new-privileges`;
  `/tmp` em memória. Banco e API sem porta publicada; só o nginx, em `127.0.0.1` por padrão.
- Servidor HTTP da API com `ReadHeaderTimeout` 5 s, `ReadTimeout` 30 s, `WriteTimeout` 90 s, `IdleTimeout` 120 s, cabeçalhos até 64 KB.
- nginx: `server_tokens off`; timeouts de cabeçalho/corpo; corpo até 1 MB (6 MB em `/api`); `proxy_read_timeout` 75 s (OCR).
  Cabeçalhos: CSP (`default-src 'self'`, sem inline, `object-src 'none'`, `base-uri`, `form-action`, `frame-ancestors 'none'`),
  `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy no-referrer`, `Permissions-Policy` e `Cache-Control: no-store` nas respostas da API.
- **HSTS** está pronto e comentado no `default.conf`: ative só quando o HTTPS for definitivo (VPS com certbot ou `tailscale serve`).

## Checklist de produção

1. `make env` (senha do Postgres aleatória); conferir que o `.env` não está no git.
2. `OPEN_REGISTRATION=false` (o 1º usuário se cadastra; os demais por convite).
3. HTTPS: `tailscale serve --bg 8080` (fase 1) ou certbot (fase 2). Com HTTPS: `APP_ENV=production` (cookie `Secure`, Gin em
   modo release, sem log verboso de SQL) e descomentar o HSTS. **Sem HTTPS** (acesso por `http://100.x.y.z:8080` dentro do
   tailnet, já cifrado pelo WireGuard): mantenha `APP_ENV=development`, senão o navegador não envia o cookie `Secure` e o login não fica.
4. `WEB_BIND`: `127.0.0.1` com `tailscale serve`; ou o IP do Tailscale da máquina. Nunca `0.0.0.0` numa rede que não é sua.
5. Reconstruir as imagens (`make up` faz o build): pega o Go 1.27.x mais novo (correção do `crypto/x509`, ver abaixo) e o
   `nginx:alpine`/`alpine` atualizados.
6. Testar o login errado 11 vezes seguidas: a 11ª tem de dar 429.
7. `docker compose logs web | grep token` não pode trazer nada depois de abrir um link de convite.

## Dependências (verificado em 2026-10-21)

- `govulncheck ./...`: corrigidos `quic-go` 0.59.0 → 0.59.1 (via Gin) e `moby/go-archive` 0.2.0 → 0.3.0 (só testes, via
  testcontainers). Restante: `crypto/x509` da biblioteca padrão (GO-2026-6809), corrigido no **Go 1.27.3**: a imagem
  `golang:1.27-alpine` já traz a correção ao reconstruir; localmente, atualize o Go.
- `npm audit --omit=dev`: 0 vulnerabilidades (também 0 contando as de desenvolvimento).

## Desempenho (medido)

`PRUMIA_PERF=1 go test ./internal/api/ -run TestDesempenho -v` (`api/internal/api/perf_test.go`) semeia **10 casas com 5 mil
invoices cada** (50.820 linhas, 2 anos, 60% pagas, 5% excluídas, 10% com boleto) e, na casa medida, 40 compras de 12 parcelas,
10 recorrências desde 2025 e 3 fontes de receita. Mede cada listagem pela API inteira (sessão + porteiro incluídos), Postgres 16 em
container local:

| Rota | Mediana | Consultas SQL | Resposta |
|---|---|---|---|
| `invoices?month=…&limit=200` (tela do mês, ~200 itens) | 8,5 ms | 8 | 62 KB |
| `invoices?status=overdue&limit=200` | 7,8 ms | 7 | 46 KB |
| `invoices?q=…&limit=50` (busca em 5.500 linhas) | 7,3 ms | 7 | 15 KB |
| `summary?month=…` | 2,0 ms | 9 | 1 KB |
| `incomes?month=…` | 1,3 ms | 7 | 2 KB |
| `purchases`, `recurrences`, `income-sources`, `members`, `categories` | 0,9 a 1,5 ms | 5 a 7 | até 8 KB |

- **Sem N+1**: o número de consultas é fixo (não cresce com a lista); total de parcelas e boletos vêm numa consulta só por página.
  Das consultas, 4 são o custo fixo de toda requisição autenticada (sessão, usuário, membro, casa).
- `EXPLAIN (ANALYZE)`: lista do mês e resumo usam `invoices_competence_idx` (0,2 ms); atrasadas usam `invoices_pending_idx`
  (0,2 ms); busca por texto faz bitmap pela casa e filtra (3 ms para 5.500 linhas). Na lista, o tempo maior está em ler e
  converter as 200 linhas (~4 ms), não no plano.
- **Nenhum índice novo**: nada passou de 10 ms; um índice trigram para a busca economizaria ~3 ms e exigiria extensão (`pg_trgm`).
  Reavaliar se uma casa passar de ~50 mil invoices.
- Pool: até 10 conexões abertas, 5 ociosas, renovadas a cada 30 min (`platform/db`); com 2 leituras de boleto simultâneas no máximo, sobra folga.
- Front: `npm run build` gera 111 KB gzip de JS inicial (antes 121 KB); as telas além do mês e do login são baixadas sob demanda
  (7 pedaços de 1 a 24 KB). O grosso é React + roteador + React Query.
