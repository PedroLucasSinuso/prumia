# Plano das próximas etapas

Documento de trabalho para quem for implementar (pessoa ou agente). Complementa o [roadmap.md](roadmap.md): o roadmap diz **o quê** e **por quê**; aqui está **em que ordem**, com **escopo, critérios de aceite e armadilhas** de cada pacote de trabalho (PT).

Leia antes de começar: [CLAUDE.md](../CLAUDE.md) (regras inegociáveis), [developer-guide/architecture.md](developer-guide/architecture.md), [incomes-and-wallets.md](developer-guide/incomes-and-wallets.md) e [frontend.md](developer-guide/frontend.md).

## 1. Regras de processo (valem para todo PT)

1. **Tudo via Pull Request**, uma branch por PT (ou por parte, quando o PT diz). Nunca commitar em `main`, nunca mergear o próprio PR: **quem mergeia é o dono**.
2. **Commits de uma linha** `tag: descrição` (≤72 caracteres; `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`), **sem trailer** (nada de `Co-Authored-By` ou "Generated with"). Nunca `--force`, `rebase` ou `--no-verify`; para atualizar a branch use `git merge origin/main`.
3. **Dados pessoais do dono nunca entram no repositório** (commits, PR, comentários, testes, docs, nomes de arquivo): nada de boletos reais, empresas que a casa usa, CNPJ/CPF, valores ou datas reais. Fixtures **sintéticos** (CNPJs fictícios com dígitos válidos, empresas inventadas, linhas digitáveis geradas). Releia o diff e o corpo do PR antes de abrir.
4. **Contrato primeiro**: mudou endpoint ⇒ edite `openapi/openapi.yaml`, rode `make generate`, depois implemente. `make lint` precisa passar (inclui "código gerado em dia").
5. **Migrations**: só **novas** e numeradas, nunca editar as aplicadas. Próximo número livre: **00013**. Dois PRs com migration não podem correr em paralelo: o primeiro a ser mergeado fica com o número menor; o outro renumera depois de atualizar com a `main`. Testes de migration devem subir até a versão **exata** com `gooseTo(t, gdb, N)`; `db.Rollback` desfaz só a última, e `db.Migrate` sobe tudo (já quebrou testes de PRs vizinhos).
6. **Testes**: rodar `make lint`, `make test` (integração com testcontainers; Docker disponível), `tsc -b`, oxlint, build e a suíte **completa** do front (`npx vitest run`) antes de abrir o PR, e relatar o resultado no corpo. Depois de editar testes do front, rode `tsc -b` (a CI pega erro de tipo em teste).
7. **Não toque no stack em uso do dono** (porta 8080, banco real, túnel). Teste com testcontainers ou suba outra stack em outra porta/projeto. Se precisar de navegador, use um perfil/endereço separado (`127.0.0.1` em vez de `localhost` isola os cookies) e **nunca** use uma sessão já logada do dono.
8. **O que o agente não consegue testar** (celular real, PWA instalado, boleto real, domínio): escrever no PR um **guia de teste manual** (passos numerados, resultado esperado, o que reportar). PT que mexe no banco avisa "rode `make backup` antes de subir".
9. **Estilo**: só classes do Tailwind com os tokens semânticos (`bg-surface`, `text-ink`, `border-line`…), sem cor solta; textos em pt-BR; mobile primeiro; reuse as primitivas de `web/src/components/ui/` (Panel/SlideOver/Sheet, DatePicker, MonthPicker, Combobox, Segmented, Popover). Fluxos centrais (lançar e pagar) continuam em poucos toques; funcionalidade nova **não aparece** para quem não a usa.
10. **Documentação junto com o código**: `docs/developer-guide/` e `docs/user-guides/` (português claro, para quem não programa). Não edite `docs/product/` (é local e fora do Git) nem marque tarefas como concluídas no plano local.

## 2. Onde estamos (já feito, não refazer)

Favorecidos, subcategorias, gráficos, temas (9), Receitas v2 (recebimento automático, valor por unidade, dia útil, mês anterior, descontos com INSS/IRRF, escopo "este e os seguintes"), importação (boleto, conta sem boleto, lista por foto ou texto, vencimento na linha, modal no computador), **carteiras configuráveis** (saldo que continua entre os meses, mês de início do saldo, transferência entre carteiras), papéis com nomes claros (Responsável, Participante, Só leitura), acesso por domínio com Cloudflare Tunnel e `PUBLIC_URL` nos links, redesign "Instrumento calmo" (#58), **Conferir saldo** (PT-2, #60) e os ajustes de importação (PT-4, #61). Migrations aplicadas: 00001 a 00012.

## 3. Ordem e dependências

```
(PT-1, auditoria de interface: já feito)
PT-2 Conferir saldo (00012) ──► PT-5a Meta da reserva ──► PT-5b Investimentos ──► PT-5c Taxas (BrasilAPI)
PT-3 Convite de cadastro (00013, auth)    (independente; um PR com migration por vez)
PT-4 Importação: pequenos ajustes          (baixo risco)
PT-6 Segurança e infraestrutura            (itens independentes)
PT-7 Manutenção recorrente                 (baixo risco)
```

Regra prática: **um PR com migration aberto por vez**. PTs de baixo risco (4, 7, partes do 6) podem andar em paralelo, desde que não toquem os mesmos arquivos.

## 4. Pacotes de trabalho

### PT-1 · Correções da auditoria de interface — **feito pelo dono**

A auditoria de interface já foi feita e as correções já estão no código (feitas pelo dono). **Não executar este pacote.** Se uma tela ainda parecer errada, abra uma pergunta no PR em vez de refazer o trabalho.

### PT-2 · Conferir saldo (ajuste de saldo) — **feito (#60)**; teste manual do dono pendente

**Problema**: o saldo de uma carteira soma só o que está cadastrado. Se a pessoa lança a receita e esquece de lançar os gastos, sobra dinheiro falso nos meses seguintes. Já existe o "mês de início" (começar do saldo real), mas falta um jeito de **reconciliar com a realidade** a qualquer momento.

**Escopo**:
- Tabela `wallet_adjustments` (id, `household_id`, `wallet_id` com FK composta, `competence_month` (dia 1), `amount_cents` com sinal (a diferença), `note`, `created_by`, `created_at`, `deleted_at`). Exclusão lógica com Desfazer, como transferências.
- Ação **Conferir saldo** em cada carteira: a pessoa escolhe o mês (padrão: o atual), o app mostra o saldo calculado até o fim daquele mês, a pessoa digita o **saldo real**, e a diferença vira um ajuste naquele mês. O ajuste **não é receita nem despesa**: não entra em `byCategory`, totais, previsto/recebido/pago; só altera o saldo da carteira (some em `balanceCents`, `monthBalanceCents`, `projectedCents` e no saldo anterior dos meses seguintes).
- Rotas: `GET /households/{id}/wallet-adjustments?month=`, `POST`, `DELETE`, `POST …/restore`; `WalletBalance` ganha `adjustmentsCents` do mês. Permissões como as transferências (Responsável e Participante escrevem; Só leitura não).
- Respeitar o **mês de início** da carteira: ajuste anterior ao início não vale (400 com mensagem clara).
- Resumo e `OverdraftWarning` (aviso de saldo) usam a mesma regra de carry-over: **uma só implementação** em `internal/summary`.

**Aceite**: cenário "receita sem gastos em outubro; em 1º/11 a pessoa confere e digita o saldo real" ⇒ novembro começa com o saldo real; excluir o ajuste restaura o anterior; testes de unidade e de integração (meses acumulando, mês de início, isolamento entre casas, papéis, migration Up/Down/Up com dados); guia de usuário atualizado ([carteiras.md](user-guides/carteiras.md)).

### PT-3 · Convite de cadastro (conta e casa próprias) — risco alto (auth; migration 00013)

**Problema**: hoje o convite só leva a uma casa existente e o cadastro sem convite vale **só para o primeiro usuário**. Falta um link para alguém criar a **própria conta e a própria casa** (e para ter um usuário de testes em produção).

**Escopo**:
- Novo tipo de convite "de cadastro" (token **só em hash SHA-256**, validade de 1 a 7 dias, uso único, revogável), reaproveitando o mecanismo dos convites atuais. Na tela de cadastro o link libera o formulário sem exigir convite para uma casa.
- **Quem gera: só o "dono do sistema"** (a primeira conta criada). Marcar no banco (`users.is_system_owner` ou equivalente) com backfill para o primeiro usuário existente. Teto de convites pendentes. Em Ajustes (visível só ao dono do sistema): gerar, listar pendentes, revogar.
- O link usa `PUBLIC_URL` quando existir (veja `web/src/lib/links.ts`).
- **Decisão em aberto para o dono**: passar a condição de "dono do sistema" para outra pessoa. Se não vier resposta, **não implemente a transferência**; deixe anotado no PR.
- Segurança: rate limit no cadastro, mensagens que não revelam se um e-mail já existe, sessão como hoje. Branch separada e testada; revisão de segurança no corpo do PR (o que um link vazado permite).

**Aceite**: testes de integração (token inválido/expirado/usado/revogado, quem não é dono não gera, cadastro cria usuário + casa com carteiras e categorias padrão), varreduras de segurança com as rotas novas, documentação em [authentication.md](developer-guide/authentication.md) e guia de usuário.

### PT-4 · Importação: pequenos ajustes — **feito (#61)**, exceto o pré-processamento da foto de conta; teste manual do dono pendente

- **Aviso do mês depois de importar**: hoje o app salta para a competência da primeira conta criada. Opção preferida: ficar no mês em que a pessoa estava e mostrar no toast "N contas criadas em <mês(es)>" com ação "Ver". (Se o lote cair em vários meses, listar.)
- **Mais formatos de lista**: ponto decimal sem `R$` (`98.40`) e quantidade (`2x`), sempre com a regra de "item forte/fraco" de [boleto-extraction.md](developer-guide/boleto-extraction.md) e testes em tabela com texto sintético.
- **Foto de conta**: nome da empresa e CNPJ do cabeçalho colorido não são lidos; testar pré-processamento de imagem (escala de cinza, contraste, binarização) **só se melhorar** em imagens sintéticas sem piorar os casos atuais.
- Mais layouts de boleto: cada falha reportada vira caso de teste sintético.

### PT-5 · Reserva de emergência e investimentos — risco alto (migrations), em 3 PRs sequenciais

Depende do PT-2. Novas tabelas, sem backfill. **Antes de desenhar**, escreva no PR uma proposta curta (telas, tabelas, regras) para o dono aprovar: as decisões abaixo são dele.

- **PT-5a Meta da reserva**: meta em **meses de gasto essencial** (`categories.is_essential` já existe), carteira(s) que contam como reserva, progresso (saldo da carteira ÷ gasto essencial mensal médio). Aparece só para quem configurar.
- **PT-5b Investimentos e aportes**: cadastro por casa (nome, tipo, instituição opcional, saldo/valor atual informado à mão), aportes e resgates como lançamentos próprios (não são receita nem despesa); relação com as carteiras (aporte tira de uma carteira). Decisão do dono: o que é "investimento" no modelo (carteira especial ou entidade à parte).
- **PT-5c Taxas de referência**: BrasilAPI `/taxas` (CDI, Selic, IPCA) para comparar rendimento e mostrar inflação do período. **Confirmar a documentação atual da API antes de desenhar.** Regras de qualquer API de terceiros: só o servidor chama, com **cache**, degradação graciosa (o app nunca depende dela), nenhum dado pessoal na requisição, URL configurável por variável (como `HOLIDAYS_URL`).
- Cotação de ações e fundos: **fora de escopo** até o dono escolher uma fonte (a BrasilAPI não cobre).

### PT-6 · Segurança e infraestrutura — risco alto (cada item é um PR)

- **Token no fragmento**: links de convite e de nova senha levam o token na query (`?token=`); mover para o fragmento (`#`), que não vai ao servidor nem aos logs de proxy. Ajustar front, `lib/links.ts`, testes e guias.
- **Exposição pública**: revisar rate limit, cookies e HSTS agora que o app está na internet; limite de login por IP **e** por e-mail já existe: avaliar bloqueio progressivo.
- **CI mais rápido**: o job `api` leva ~10 min (cache dos pacotes do sistema, testes de integração em paralelo).
- **Coleção Postman** ([developer-guide/postman](developer-guide/postman)): atualizar com carteiras, transferências, convites e `income-dates` (já defasada).

### Fora de escopo por enquanto

- **Cloudflare Access / Zero Trust**: descartado pelo dono. Não propor nem preparar guia.
- **Backup automático para fora da máquina**: adiado pelo dono (10/2026); está no [roadmap.md](roadmap.md), "Fase 2 de infraestrutura".
- **Modo demo, onboarding simplificado e disparo de e-mails**: só fariam sentido se o prumia virasse um produto comercial; hoje são duas pessoas usando. Não implementar nem antecipar (ver [roadmap.md](roadmap.md), "Ideias sem prioridade"). O PT-3 (convite de cadastro) continua valendo, mas **sem e-mail**: o link é copiado e enviado pela própria pessoa.

### PT-7 · Manutenção recorrente — risco baixo

- **Tabela de INSS e IRRF** (`api/internal/tax/tables.go`): atualizar **todo janeiro** (faixas, teto, redutor da Lei 15.270), com fonte e data de conferência.
- **Feriados**: nacionais já vêm da BrasilAPI com cálculo de reserva; avaliar feriados estaduais/municipais configuráveis por casa (afetam dias úteis de receita).
- **PWA**: trocar os ícones provisórios pelo símbolo oficial (`scripts/pwa-icons.py`).
- Atualizar o roadmap: vários itens dele estão marcados "em andamento" mas já foram feitos.

## 5. Modelo de PR (corpo)

1. **O que muda** (3 a 6 linhas) e **por quê**.
2. **Contrato** (rotas e campos novos/removidos), se houver.
3. **Banco**: migration, backfill, e o aviso "rode `make backup` antes de subir".
4. **Testes que rodou** (comandos e resultado).
5. **Guia de teste manual** para o dono (passos, esperado, o que reportar).
6. **Pendências**.

## 6. Armadilhas já encontradas

- Gerar código (`make generate`) em dois PRs que tocam o OpenAPI: ao atualizar a branch, rode `make lint` de novo (o texto mescla, o código gerado pode divergir).
- `Updates(struct)` do GORM ignora zero-values; use `map[string]any` quando zerar for válido.
- RE2 (regex do Go) não tem lookahead/lookbehind.
- `window.location.origin` não serve para link enviado a outra pessoa: use `me.publicUrl`.
- Campos nativos `type="date"`/`type="month"` aceitam ano com 5 dígitos e ficam incompletos no celular: use `DatePicker`/`MonthPicker`.
- Popover medido antes de ficar `fixed` ia para a borda da tela (corrigido); componentes novos que usem `Popover` devem ser vistos dentro de modal.
- Em `web`, depois de mexer em testes, rode `tsc -b`; na API, depois de mudar migration, rode a suíte de migrations inteira.
