# Roadmap do prumia

O que falta fazer e o que está planejado. Responde: "o que vem depois do MVP e em que ordem?". O estado detalhado por fase fica no `plan.md` local; aqui vai só o que interessa a quem mantém o repositório.

**Plano detalhado das próximas etapas** (ordem, escopo, critérios de aceite e regras de processo): [plano-proximas-etapas.md](plano-proximas-etapas.md).

Legenda de risco: **alto** = migration, auth, séries, boleto ou deploy (branch própria, testada, relato no PR); **baixo** = UI e docs.

## Estado atual

MVP completo no `main` (PRs #1–#31): cadastro e login, casas e convites, contas avulsas/parceladas/fixas, receitas, resumo mensal, categorias e ajustes, leitura de boleto (linha digitável, valor, vencimento, beneficiário e competência), backup/restore, CI, Tailscale com HTTPS, PWA e seletor de casa.

## Pendências do dono (testes que só rodam no mundo real)

- [ ] Uso no celular real, pelo Tailscale com HTTPS.
- [ ] Instalar o PWA (Android e iOS).
- [ ] Boletos reais: PDF, print e conta de consumo (48 dígitos). Reportar campo vazio ou errado.
- [ ] `make backup` e `make test-restore` na stack real.
- [ ] Trocar os ícones provisórios do PWA pelo símbolo oficial (`scripts/pwa-icons.py`).
- [ ] Cópia fora da máquina de `docs/product/` (não vai para o GitHub).

## Princípio de produto

**O uso tem que ser simples**, hoje para um casal e amanhã para mais gente. Toda funcionalidade nova segue: (1) quem não usa não vê (progressivo: nada novo na tela até a pessoa pedir); (2) lançar e pagar continuam em poucos toques; (3) nenhuma regra que trave o fluxo ("não pode arquivar…") quando dá para desfazer; (4) sem configuração obrigatória para começar.

## Feito: favorecidos (apelido + CNPJ) (#29, #30, #31)

O favorecido é opcional e só serve para reconhecer boletos (CNPJ) e sugerir categoria; a **duplicidade** de boleto é pela linha digitável, não pelo CNPJ. Tem apelido (editável a qualquer hora) e nome oficial (razão social, informativo, vem da BrasilAPI). Rótulos: "Descrição" (texto livre da conta), "Apelido" e "Nome oficial".

## Próximo: subcategorias e gráficos por categoria

Quer ver o gasto de "Gás" **e** o de "Moradia" (que soma gás, luz, internet…). Hierarquia de **dois níveis**, não tag. Risco: **alto** (migration). Em PRs separados:

1. **Subcategorias**: `categories.parent_id` opcional (FK composta por casa; filha não tem filha; nome único por mãe). Aditiva, sem backfill: o que existe continua no topo. Fluxo: quem não usa não vê diferença; ao lançar, tocar numa mãe com filhas abre uma 2ª linha de botões (geral · Gás · Luz…). Arquivar a mãe esconde as filhas junto e restaurar a traz de volta. A soma da mãe é feita no front (o resumo continua por categoria folha).
2. ~~**Gráficos**~~ **feito** (PR `feat/resumo-graficos`): em "Por categoria" (resumo), cada categoria abre o histórico dela (6 ou 12 meses; mãe = filhas empilhadas; a pagar tracejado), "Gasto por mês" da casa no computador, saldo projetado como número principal e compromissos futuros. Endpoint `GET /summary/categories` (competência). SVG próprio com a paleta da marca, sem biblioteca.
3. Criar categoria na hora de lançar (sem ir a Ajustes) e "mover para dentro de…".

## Em andamento: Receitas v2

Decisões do dono (24/10/2026), a partir dos casos de uso reais dele e da noiva, abstraídos para servir a qualquer casa:
- **Recebimento automático**: a receita vira "recebida" na data, sem check. A exceção é "não caiu".
- **Valor**: fixo (padrão, "valor cheio") ou, como configuração à parte, **preço × quantidade** (ex.: R$ 65 × dias úteis do mês), com rótulo da unidade editável.
- **Data**: dia do mês, N-ésimo dia útil ou último dia útil. Nunca cai em sábado, domingo ou feriado nacional: **arredonda para a frente**. Feriados pela BrasilAPI, com cálculo offline de reserva.
- **Topo da tela**: "Recebido" em destaque, "A receber" pequeno, total por pessoa e "Sobra do mês". O bloco grande de "Previsto" some.
- **Editar e excluir** com escopo ("só este mês" / "este e os seguintes") e Desfazer, como nas contas; o formulário muda pessoa, tipo, mês e valor.
- **Descontos opcionais**, com sugestão de INSS e IRRF por **tabela versionada por ano** (não existe API oficial). Estimativa que o dono ajusta.

## Em andamento: acabamento da interface

DatePicker com calendário, categoria em combobox pesquisável (fim do "spam de botões"), tooltips, painéis com rodapé fixo, animações e feedback visual (tudo respeitando `prefers-reduced-motion`). Depois, aplicar nos formulários de Receitas.

## Anotado para o futuro

- [feito] **Importação em massa no computador** abre num modal grande sobre o Mês (`ImportModal`); no celular continua a página `/importar`. Falta o dono avaliar no uso real se ainda quer a revisão como segundo modal sobre o primeiro.
- **Foto de conta**: nome e CNPJ do cabeçalho colorido não são lidos (pré-processamento de imagem); padrão de lista (`descrição: valor`) e "colar texto" já cobrem listas e prints.
- Cobrir mais formatos de lista (ponto decimal "98.40" sem R$, quantidades "2x").
- **Convite de cadastro**: link de uso único e com validade para a pessoa criar a **própria conta e a própria casa** (hoje o convite só leva a uma casa existente e o cadastro sem convite vale só para o primeiro usuário). Mesmo mecanismo do convite atual (token só em hash, validade, uso único) com um tipo novo. Quem gera: só o "dono do sistema" (a primeira conta), com tela em Ajustes (gerar, pendentes, revogar) e teto de links pendentes. Útil para ter um usuário e uma casa de testes em produção. Ponto em aberto: passar a condição de dono do sistema para outra pessoa. Mudança de autenticação: branch separada e testada.
- **Aviso do mês depois de importar**: ao criar as contas, o app vai para a competência da primeira conta; pode ficar no mês que a pessoa estava olhando ou avisar para onde foi.

## Feito: carteiras configuráveis (#50); em andamento: transferência entre carteiras

**Pronto (#50)**: tabela `wallets` (migration `00008` com backfill `free`/`benefit` → "Geral"/"Benefício"), Ajustes > Carteiras (só o Responsável escreve), `walletId` em receita, fonte, pagamento e categoria (`defaultWalletId`), resumo com um cartão por carteira e **saldo anterior transportado** entre meses, aviso `wallet_balance_insufficient`. Ver [incomes-and-wallets.md](developer-guide/incomes-and-wallets.md) e [carteiras.md](user-guides/carteiras.md).

**Em andamento**: **transferência entre carteiras** (guardar na Reserva e tirar de lá): não é receita nem despesa, só move saldo; criar, excluir e desfazer; aviso de saldo na origem.

Registro do desenho original (o que estava em aberto na época):

Hoje são 2 valores fixos (`free`/`benefit`) e o saldo é "recebido − pago" **sem** carregar de um mês para o outro. A ideia é carteira = **conta** (ex.: bancos diferentes, benefício, dinheiro vivo), com saldo real. Risco: **muito alto** (migration **com migração de dados**: `paid_wallet`/`wallet` em texto viram referência a uma carteira).

Decidido:
- O saldo **continua de um mês para o outro** (conta de verdade), com algum feedback visual. Isso é a base para acompanhar o que sobra e para o pós-MVP de investimentos.

Em aberto (decidir antes de desenhar):
- Carteiras **da casa** (todos veem) ou também **pessoais** (só o dono vê o saldo)? Há quem prefira sigilo do próprio dinheiro; isso mexe em autorização e no resumo.
- Carteira **padrão** ao pagar (por pessoa? uma "carteira geral da casa" criada automaticamente na 1ª vez?): o app deve induzir uma carteira geral da casa sem exigir configuração.
- **Transferência** entre carteiras; saldo inicial; o que fazer com o histórico (backfill das duas carteiras atuais).
- Salário não unificado: receitas por pessoa caindo em carteiras diferentes.

Pontos de atenção: manter o fluxo de pagar em poucos toques; casas existentes migram sem ação do usuário.

## Feito: redesign de navegação, Ajustes, Mês e Importação (#34 a #39)

Tokens e 9 temas (Marfim, Solarized, Latte, Alto contraste, Dracula, Nord, Gruvbox, Rosé Pine, Sistema), Resumo com saldo projetado e gráficos, navegação Mês · Receitas · Resumo · Ajustes (+ Importar), painel de **Ajustes** unificado (Casa e pessoas, Categorias com arrastar, Favorecidos, Aparência com tema na conta, Minha conta com troca de senha, Dados com exportação CSV, Sobre), Mês redesenhado para computador e importação inteligente de documentos.

## Feito: receitas v2 (PR `feat/receitas-v2`)

Uma lista só (sem "fonte" x "lançamento" na tela), recebimento **automático** com a exceção "não caiu", regra de data (dia do mês, N-ésimo
ou último dia útil, com ajuste de fim de semana e feriados nacionais), valor cheio ou **por unidade** (preço x quantidade, com dias úteis
sugeridos), editar/excluir/restaurar com escopo (este mês ou este e os seguintes, com Desfazer), sugestão opcional de INSS e IRRF pelas
tabelas de 2026 e tela nova (recebido, a receber, por pessoa, sobra do mês). Calendário em `api/internal/calendar` (BrasilAPI com plano B
calculado), `HOLIDAYS_URL`. Pendente do dono: teste manual em `docs/user-guides/salario-e-previsao.md`; atualizar as tabelas de impostos
a cada janeiro (`api/internal/tax/tables.go`).

## Melhorias de curto prazo

- Ajustes: novas preferências da casa entram como novas seções (o painel já comporta).
- Segurança: token de convite/reset no fragmento (`#`) em vez da query; limite de login atrás do Tailscale vira balde único (avaliar chave por usuário/e-mail).
- Boleto: mais layouts reais para calibrar as regras de nome, vencimento e competência (cada boleto novo que falhar vira caso de teste, sempre com dados sintéticos).
- [feito: tela Importar, lote e conta sem boleto/lista] Importação de vários boletos de uma vez (duplicidade pela linha digitável; aviso suave de "parece duplicada" para segunda via com outra linha: mesmo favorecido, competência e valor).
- Nomes de favorecido/empresa: normalizar caixa só na sugestão.
- CI mais rápido (dívida): o job `api` leva ~10 min; cache dos pacotes do sistema e testes de integração em paralelo.

## Pós-MVP: investimentos e reserva de emergência

Já previsto desde o início; novas tabelas, sem backfill.

- Metas de reserva de emergência (meta em meses de despesa, progresso).
- Cadastro de investimentos e aportes por casa.
- **Taxas de referência pela BrasilAPI** (`/taxas`: CDI, Selic, IPCA): comparar rendimento com o CDI e mostrar inflação do período. Confirmar a documentação da API antes de desenhar.
- Cotação de ações e fundos: a BrasilAPI não cobre; escolher outra fonte quando a fase começar.
- Regras para qualquer API de terceiros: chamada só pelo servidor, cache, degradação graciosa (o app nunca depende dela) e nenhum dado pessoal na requisição.

## Feito: acesso por domínio com Cloudflare Tunnel (#51)

`make tunnel-setup` e `make tunnel-up` publicam o app por `https://app.<domínio>` a partir do computador, sem abrir porta e sem Zero Trust (túnel gerenciado localmente). O nginx tem uma porta interna (8081) só para o túnel, onde o IP do cliente vem de `CF-Connecting-IP`. O app fica exposto só com o login próprio (decisão do dono: sem Cloudflare Access). Guia: [deployment.md](developer-guide/deployment.md).

## Fase 2 de infraestrutura

- VPS com certbot (hoje: Tailscale com `tailscale serve`).
- Revisar rate limit, cookies e HSTS para exposição pública antes de sair do Tailscale.
- Backup automático agendado e enviado para fora da máquina.

## Ideias sem prioridade

- **Só se o prumia virar um produto comercial** (hoje são duas pessoas usando): **modo demo** (casa de exemplo, sem cadastro), **onboarding simplificado** e **disparo de e-mails** (boas-vindas, convite, nova senha, avisos). Isso traria decisões novas (provedor de e-mail, domínio e reputação de envio, LGPD, planos e cobrança, limites por casa) e **não deve ser antecipado** nas escolhas de hoje além de manter o cadastro e os convites desacoplados da tela.
- Offline parcial no PWA (hoje: instalável, sem offline).
- Exportação (CSV) e importação de extratos.
- Notificação de vencimento próximo.
- Anexar o arquivo do boleto (hoje o arquivo nunca é salvo, por decisão de privacidade; mudar exigiria rever essa regra).
