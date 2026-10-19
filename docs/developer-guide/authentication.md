# Autenticação, sessões e autorização

Responde: como o login funciona, onde ficam as regras de acesso e como testá-las.

## Visão geral

- **Senha**: argon2id (64 MiB, 3 passadas, 2 threads), em formato PHC (`$argon2id$v=19$m=...`). Os parâmetros ficam dentro
  do hash, então podem ser aumentados no futuro sem invalidar senhas antigas. Tamanho: 10 a 128 caracteres.
- **Sessão**: token aleatório de 256 bits no cookie `prumia_session` (`HttpOnly`, `SameSite=Lax`, `Secure` em produção,
  validade de 30 dias **deslizante**: o uso renova, gravando no máximo 1 vez por hora). O banco guarda **só o SHA-256**
  do token; um vazamento do banco não entrega sessões.
- **Login**: e-mail desconhecido e senha errada dão a **mesma resposta e levam o mesmo tempo** (verificamos contra um hash
  descartável), para não revelar quais e-mails existem. Limite de tentativas: 10/min por IP e 5/min por e-mail (429).
- **CSRF**: cookie `SameSite=Lax` + checagem de `Origin` em toda escrita (POST/PUT/PATCH/DELETE): se o navegador informar
  uma origem diferente do `Host`, 403 `bad_origin`. Clientes sem `Origin` (Postman, curl) passam.

## Cadastro

`POST /api/auth/register` cria o usuário e uma casa (ele vira admin, com as 10 categorias padrão), numa única transação.

- **Só o primeiro usuário do sistema** pode se cadastrar sem convite. Depois disso, 403 `registration_closed`.
  (Uma trava de aplicação no Postgres impede dois "primeiros usuários" simultâneos.)
- `OPEN_REGISTRATION=true` no `.env` libera cadastro sem convite para qualquer um. Mantenha `false`.
- Convites (`inviteToken`) ainda respondem 501; chegam no próximo PR da Fase 1.

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
  controlado), isolamento entre casas, `viewer`, CSRF, rate limit, cookie `Secure`.
- **Postman**: importe `docs/developer-guide/postman/prumia.postman_collection.json` (14 requisições com asserções).
  Variável `base_url` = `http://localhost:8080`. Rode as pastas em ordem; o Postman guarda o cookie sozinho. Em linha de
  comando: `npx newman run docs/developer-guide/postman/prumia.postman_collection.json`.

## Armadilhas já encontradas

- **nginx e a porta do `Host`**: o proxy precisa repassar `Host $http_host` (com a porta). Com `$host` a porta some, o `Origin`
  do navegador (`localhost:8080`) não bate com o `Host` visto pela API e todo POST legítimo toma 403.
- **GORM e valores zero**: `time.Time` zerado é gravado como `0001-01-01`, sobrescrevendo o `DEFAULT now()` do banco.
  Use `gorm:"autoCreateTime"` nas colunas de data de criação que não são o `created_at` padrão.
- **E-mail no gerador**: o tipo `Email` do oapi-codegen rejeita e-mail inválido já ao ler o JSON (erro genérico).
  Mapeamos `format: email` para `string` e validamos no serviço, que devolve erro por campo.
