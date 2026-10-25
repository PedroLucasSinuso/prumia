# Autenticação, sessões e autorização

Responde: como o login funciona, onde ficam as regras de acesso e como testá-las.

## Visão geral

- **Senha**: argon2id (64 MiB, 3 passadas, 2 threads), em formato PHC (`$argon2id$v=19$m=...`). Os parâmetros ficam dentro
  do hash, então podem ser aumentados no futuro sem invalidar senhas antigas. Tamanho: 10 a 128 caracteres.
- **Sessão**: token aleatório de 256 bits no cookie `prumia_session` (`HttpOnly`, `SameSite=Lax`, `Secure` em produção,
  validade de 30 dias **deslizante**: o uso renova, gravando no máximo 1 vez por hora). O banco guarda **só o SHA-256**
  do token; um vazamento do banco não entrega sessões. Além disso há uma **validade absoluta** (ver
  [Validade absoluta da sessão](#validade-absoluta-da-sessão)).
- **Login**: e-mail desconhecido e senha errada dão a **mesma resposta e levam o mesmo tempo** (verificamos contra um hash
  descartável), para não revelar quais e-mails existem. Limite de tentativas: 10/min por IP e 5/min por e-mail normalizado
  (429). O IP vem só do `X-Real-IP` que o nginx sobrescreve (ver [security.md](security.md#ip-real-e-limite-de-tentativas)).
  Entrar de novo no mesmo navegador encerra a sessão anterior dele.
- **CSRF**: cookie `SameSite=Lax` + checagem de `Origin` em toda escrita (POST/PUT/PATCH/DELETE): se o navegador informar
  uma origem diferente do `Host`, 403 `bad_origin`. Clientes sem `Origin` (Postman, curl) passam.

## Cadastro

`POST /api/auth/register` cria o usuário e uma casa (ele vira admin, com as 10 categorias padrão), numa única transação.

- **Só o primeiro usuário do sistema** pode se cadastrar sem convite. Depois disso, 403 `registration_closed`.
  (Uma trava de aplicação no Postgres impede dois "primeiros usuários" simultâneos.)
- `PUBLIC_URL` (opcional) define o endereço que vai nos links de convite e de nova senha; sem ele o front usa o endereço do navegador de quem gera o link.
- `OPEN_REGISTRATION=true` no `.env` libera cadastro sem convite para qualquer um. Mantenha `false`.
- Com `inviteToken` o cadastro **não cria casa**: o usuário entra na casa do convite, com o papel do convite (ver [Convites](#convites)). Nesse caso o cadastro funciona mesmo com o cadastro livre fechado.
- Com `signupToken` (convite de **cadastro**, abaixo) o cadastro funciona com o cadastro livre fechado e **cria casa própria**, como o do primeiro usuário. `inviteToken` e `signupToken` juntos = 400 em `signupToken`.
- O primeiro usuário vira o **dono do sistema** (`users.is_system_owner`, migration `00013`, no máximo um por índice único parcial; o backfill marcou a conta mais antiga). `GET /auth/me` devolve `isSystemOwner`.

## Convite de cadastro (conta e casa próprias)

Para alguém criar a **própria conta e a própria casa** (e para ter um usuário de testes em produção) sem abrir o cadastro livre.
Código em `internal/auth/signup.go`; tabela `signup_invites` (migration `00013`, ver [schema.md](schema.md)).

| Regra | Detalhe |
|---|---|
| Quem gera | **Só o dono do sistema** (a primeira conta). A checagem é no serviço (`requireSystemOwner`), não só na tela. Outros usuários: 403 `forbidden`. |
| Rotas | `GET /auth/signup-invites` (pendentes), `POST /auth/signup-invites {expiresInHours?}` (201 com o token **uma vez**), `DELETE /auth/signup-invites/{id}` (revogar; idempotente; usado ou de outra pessoa = 404). |
| Token | Aleatório, guardado só em hash SHA-256 (`platform/token`), como os convites de casa e os links de nova senha. Vai no link `/cadastro#token=…` (fragmento: não chega ao servidor ao abrir o link). |
| Validade | De 1 a 168 horas (padrão 48); fora disso, 400 em `expiresInHours`. |
| Teto | No máximo **5 pendentes** (não usados, não revogados, não vencidos). O 6º: 409 `signup_invite_limit`. A contagem e a gravação ficam numa transação com trava de aplicação (`pg_advisory_xact_lock(7102)`). |
| Uso único | No cadastro, um `UPDATE … WHERE pendente` consome o token **na mesma transação** que cria usuário e casa. Token inválido, vencido, usado ou revogado = 400 `invalid_signup_invite` e nada é gravado; cadastro que falha por outro motivo (e-mail repetido) não consome o token. |
| Limites | O cadastro continua com o limite por IP (5 seguidas, depois 1 a cada 12 s). |

**O que um link vazado permite**: criar **uma** conta com uma casa própria e vazia (carteiras e categorias padrão), dentro da validade e antes de alguém usar o link. **Não** dá acesso a nenhuma casa existente, a dados de ninguém nem a outros convites. O dono do sistema revoga um link pendente a qualquer momento (Ajustes > Minha conta).
**Enumeração de e-mail**: com um link válido, um e-mail já cadastrado responde 409 `email_taken` (o link não é consumido). Sem envio de e-mail não há como confirmar a posse do endereço, então a mensagem continua dizendo que o e-mail existe; o risco fica limitado a quem tem um link válido e ao limite por IP do cadastro.
**Em aberto (decisão do dono)**: passar a condição de dono do sistema para outra pessoa. Não implementado: hoje só por SQL (`UPDATE users SET is_system_owner = …`, um de cada vez, por causa do índice único).

## Validade absoluta da sessão

Decisão de segurança: a renovação por uso, sozinha, deixaria um cookie roubado vivo para sempre se o ladrão o usasse
de tempos em tempos. Por isso a sessão **morre `SESSION_MAX_AGE_DAYS` dias depois do login** (padrão **90**), mesmo em uso.

- Ao renovar, `expires_at` vira `min(agora + 30 dias, created_at + máximo)`: a renovação nunca passa do teto.
- `Authenticate` também confere `created_at + máximo` (cobre sessões gravadas antes da regra); vencida, a linha é apagada.
- Sessão vencida ou desconhecida responde **401 `unauthenticated`** e o middleware **apaga o cookie** (`Max-Age=-1`)
  quando a requisição trouxe um. Sem cookie, o 401 não manda `Set-Cookie`.
- Configuração: `auth.Config.SessionMaxAge`, lida de `SESSION_MAX_AGE_DAYS` (inteiro > 0; inválido impede a API de subir).
- Teste: `limites_test.go` (relógio injetável: uso a cada 20 dias, cai exatamente aos 90; sessão antiga com `expires_at` longo).

## Limite de casas por usuário

Decisão de segurança: cada casa custa linhas (membro, 10 categorias); sem limite, uma conta poderia criar casas sem fim.

- `POST /households` aceita no máximo **`MAX_HOUSEHOLDS_PER_USER` casas ativas criadas pelo usuário** (padrão **5**).
  Passou: **409 `household_limit`**.
- Contam só casas com `created_by` = o usuário e `deleted_at` nulo: excluir uma casa libera a vaga; casas em que a pessoa só
  entrou por convite não contam para ela. A casa criada no cadastro conta.
- Corrida: uma trava de aplicação por usuário (`pg_advisory_xact_lock(7102, hashtext(user_id))`) serializa a contagem e a
  criação; 6 criações simultâneas com limite 2 dão 1 criada e 5 conflitos (teste em `limites_test.go`).
- Configuração: `household.Service.MaxPerUser`, lida de `MAX_HOUSEHOLDS_PER_USER` (inteiro > 0).

As duas variáveis são lidas pela API; o `deploy/compose.yaml` as repassa do `.env` (comentadas no `.env.example`, com os padrões).

## Convites

O admin gera um convite por link/código; não há e-mail (spec, seção 3).

- `POST /households/{id}/invites` (admin): corpo `{role, expiresInHours}`. Validade padrão **48 h**, de 1 a **168 h**
  (7 dias); fora disso, 400 `validation_error`. Devolve o **token uma única vez**; no banco fica só o SHA-256
  (`household_invites.token_hash`). Quem perder o token gera outro.
- `DELETE /households/{id}/invites/{inviteId}` (admin): revoga (`revoked_at`). Revogar duas vezes é sucesso;
  convite já usado dá 409 `invite_used`; convite de outra casa dá 404 (o filtro por `household_id` vale também aqui).
- `POST /invites/accept` (logado): o usuário entra na casa do convite. A casa vem **do convite**, nunca do corpo.
- `POST /auth/register` com `inviteToken`: cria o usuário e o coloca na casa do convite, **sem criar casa nova**
  (o `householdName` é ignorado), tudo numa transação: e-mail repetido ou convite inválido não deixam nada gravado.
- **Uso único e atômico.** Um único `UPDATE ... WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  AND casa não excluída ... RETURNING` marca `used_at/used_by`. Com duas requisições simultâneas o Postgres serializa o
  UPDATE e só uma enxerga a linha pendente (teste com 8 aceites em paralelo: 1 sucesso, 7 `400`).
- **Erro estável**: token inexistente, expirado, usado, revogado ou de casa excluída respondem todos
  `400 invalid_invite`, sem dizer o motivo (não ajuda quem tenta adivinhar).
- Quem já é membro ativo recebe `409 already_member`, e o convite **não é consumido** (a transação é desfeita).
  O papel atual não muda (aceitar um convite `viewer` não rebaixa um admin).
- Convites pendentes de quem deixa de ser admin (saiu, foi removido ou rebaixado) são revogados na hora.

## Membros e papéis

- `PATCH /households/{id}/members/{userId}` (admin) muda o papel. `DELETE` remove (admin) ou é a **saída** do
  próprio usuário (qualquer papel, inclusive `viewer`). Remover outra pessoa exige admin.
- **Sempre há pelo menos 1 admin ativo**: rebaixar, remover ou sair sendo o último admin dá `409 last_admin`. As linhas
  dos membros ativos são travadas (`SELECT ... FOR UPDATE`) durante a checagem, então dois admins se rebaixando ao
  mesmo tempo não zeram os admins (um dos dois toma 409).
- Sair **nunca apaga a linha**: define `left_at`. Quem saiu perde o acesso na hora (404, como não-membro) e some
  da listagem, mas invoices antigas que o citam continuam válidas.
- **Reentrada** (decisão): a chave primária é `(household_id, user_id)`, então quem saiu e aceita um novo convite
  **reativa a mesma linha**: `left_at` volta a ser nulo, o papel passa a ser o do novo convite e `joined_at` é renovado.
- Última pessoa da casa que queira sair: exclua a casa (`DELETE /households/{id}`, admin, exclusão lógica com `deleted_at`).
  `PATCH /households/{id}` (admin) renomeia (1 a 80 caracteres).
- As regras de papel estão **no serviço** (`household.Service`), não só no handler: cada operação confere o papel de
  quem pede na própria transação. Os handlers admin ainda chamam `auth.RequireAdmin(c)` logo no início.

## Redefinição de senha (sem e-mail)

Um admin gera um link e o entrega por fora (WhatsApp, pessoalmente). Fase 2 troca isso por e-mail.

- `POST /households/{id}/members/{userId}/password-reset-link` (admin): devolve `{token, expiresAt}`; validade **1 h**
  (`Config.ResetTTL`), token só em hash em `password_reset_tokens`. Gerar um novo link apaga os pendentes do mesmo usuário.
- **Regra de segurança**: só é permitido se o solicitante é **admin ativo de TODAS as casas ativas do alvo**. Sem isso,
  um admin poderia tomar a conta de quem também participa de casas que ele não administra e ler os dados delas. Violação:
  `403 reset_not_allowed`. O alvo precisa ser membro ativo da casa da URL (senão 404).
- `POST /auth/password-reset` (pública, limitada a 5 seguidas + 5/min por IP): `{token, newPassword}`. A senha é
  validada **antes** de gastar o token (10 a 128 caracteres). Token inexistente, expirado ou usado: `400 invalid_reset_token`.
- Ao concluir, **todas as sessões do usuário são apagadas** (quem tinha a senha antiga ou uma sessão roubada é
  desconectado) e os demais links pendentes dele caem. Uso único pelo mesmo `UPDATE` condicional dos convites.
- No uso, a regra do escopo é **conferida de novo**: se o alvo entrou numa casa que o solicitante não administra
  depois de o link ser gerado, o link vira inválido (transação desfeita, senha intacta).

## Onde ficam as regras de acesso

Tudo passa pelo `auth.Middleware`, registrado em todas as rotas do contrato (`api.Mount`):

1. **Origem** (CSRF) em escritas.
2. **Sessão**: exigida em toda rota, exceto as `PublicRoutes` (`healthz`, `register`, `login`, `password-reset`).
   Um teste compara essa lista com as operações `security: []` do `openapi.yaml`: **contrato e código não podem divergir**.
3. **Casa** (rotas com `{householdId}`): o usuário precisa ser membro ativo (`left_at IS NULL`) de uma casa não excluída;
   senão **404** (não revelamos que a casa existe).
4. **Papel**: `viewer` não escreve (403 `read_only`). Exceção: sair da casa (`DELETE .../members/{o-próprio-id}`).
   Operações só de admin chamam `auth.RequireAdmin(c)` no início do handler.

O handler recebe o usuário com `auth.CurrentUser(c)` e o papel com `auth.CurrentRole(c)`. **Nunca** leia `household_id`
do corpo da requisição: ele vem da rota autorizada. O banco reforça o isolamento com FKs compostas (ver
[schema.md](schema.md)), mas a primeira linha de defesa é este middleware.

## Como testar

- `make test`: testes de ponta a ponta contra Postgres real (`internal/api/*_test.go`): cadastro, sessão (com relógio
  controlado), isolamento entre casas, `viewer`, CSRF, rate limit, cookie `Secure`. `convites_test.go` cobre convites
  (hash no banco, uso único e corrida, expiração, revogação), papéis, último admin, saída/reentrada, casa e redefinição
  de senha (escopo multi-casa, sessões encerradas). `signup_invites_test.go` cobre o convite de cadastro (dono do sistema,
  hash no banco, uso único, vencido, revogado, teto de 5, validações, nada gravado quando falha).
- **Postman**: importe `docs/developer-guide/postman/prumia.postman_collection.json` (13 pastas, ~170 asserções; atualizada em 10/2026
  com carteiras, receitas v2, transferências, conferir saldo, reserva, investimentos, taxas e convites de cadastro). Variável `base_url` =
  `http://localhost:8080`. Use um **banco novo** (o primeiro cadastro vira o dono do sistema) e rode as pastas em ordem; o Postman guarda o
  cookie sozinho (as pastas 9 e 9c trocam de usuário por login). A pasta **9b** (boleto) precisa de arquivos reais: rode à mão. O
  cadastro tem limite de 5 por IP e o login de 5 seguidas por e-mail: em execuções repetidas, espere um minuto (ou recrie o banco). Em
  linha de comando, sem a 9b: `npx newman run docs/developer-guide/postman/prumia.postman_collection.json --folder "1. Sistema" ...`
  (uma `--folder` por pasta).

## Armadilhas já encontradas

- **nginx e a porta do `Host`**: o proxy precisa repassar `Host $http_host` (com a porta). Com `$host` a porta some, o `Origin`
  do navegador (`localhost:8080`) não bate com o `Host` visto pela API e todo POST legítimo toma 403.
- **GORM e valores zero**: `time.Time` zerado é gravado como `0001-01-01`, sobrescrevendo o `DEFAULT now()` do banco.
  Use `gorm:"autoCreateTime"` nas colunas de data de criação que não são o `created_at` padrão.
- **E-mail no gerador**: o tipo `Email` do oapi-codegen rejeita e-mail inválido já ao ler o JSON (erro genérico).
  Mapeamos `format: email` para `string` e validamos no serviço, que devolve erro por campo.
