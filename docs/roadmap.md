# Roadmap do prumia

O que falta fazer e o que está planejado. Responde: "o que vem depois do MVP e em que ordem?". O estado detalhado por fase fica no `plan.md` local; aqui vai só o que interessa a quem mantém o repositório.

**Plano detalhado das próximas etapas** (ordem, escopo, critérios de aceite e regras de processo): [plano-proximas-etapas.md](plano-proximas-etapas.md).

Legenda de risco: **alto** = migration, auth, séries, boleto ou deploy (branch própria, testada, relato no PR); **baixo** = UI e docs.

## Estado atual

MVP completo no `main` (PRs #1–#31): cadastro e login, casas e convites, contas avulsas/parceladas/fixas, receitas, resumo mensal, categorias e ajustes, leitura de boleto (linha digitável, valor, vencimento, beneficiário e competência), backup/restore, CI, Tailscale com HTTPS, PWA e seletor de casa.

Depois do MVP (até o #61): favorecidos, subcategorias e gráficos, 9 temas, Receitas v2, importação em massa (boleto, conta sem boleto, lista por foto ou texto), carteiras configuráveis com transferência, mês de início e **Conferir saldo** (#60), papéis com nomes claros, acesso por domínio (Cloudflare Tunnel), redesign "Instrumento calmo" (#58) e os ajustes de importação do PT-4 (#61). A ordem do que falta está no [plano das próximas etapas](plano-proximas-etapas.md).

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

## Feito: subcategorias e gráficos por categoria

Hierarquia de **dois níveis** (`categories.parent_id`, sem backfill), "Por categoria" no Resumo com o histórico de cada categoria (6 ou 12 meses), "Gasto por mês" da casa, criar categoria na hora de lançar e "Mover para…" em Ajustes > Categorias. Endpoint `GET /summary/categories` (competência), gráficos em SVG próprio.

## Feito: Receitas v2 e acabamento da interface

Receitas v2 (detalhes na seção "Feito: receitas v2" abaixo) e o acabamento da interface (DatePicker, combobox de categoria, tooltips, painéis com rodapé fixo, animações com `prefers-reduced-motion`), depois redesenhado na direção "Instrumento calmo" (#58).

## Anotado para o futuro

- [feito] **Importação em massa no computador** abre num modal grande sobre o Mês (`ImportModal`); no celular continua a página `/importar`. Falta o dono avaliar no uso real se ainda quer a revisão como segundo modal sobre o primeiro.
- **Foto de conta**: nome e CNPJ do cabeçalho colorido não são lidos (pré-processamento de imagem). Só vale fazer se melhorar em imagens sintéticas sem piorar os casos atuais; falta montar esse conjunto de imagens de teste.
- [feito no #61] Mais formatos de lista (ponto decimal "98.40" sem R$, quantidades "2x") e aviso do mês depois de importar (a pessoa fica no mês em que estava; o aviso diz onde as contas caíram, com "Ver").
- [feito] **Convite de cadastro** (PT-3): link de uso único para alguém criar a própria conta e casa, gerado pelo dono do sistema em Ajustes > Minha conta. Ponto em aberto: passar a condição de dono do sistema para outra pessoa (sem decisão, não implementado).

## Feito: carteiras configuráveis, transferência e Conferir saldo (#50, #54, #56, #60)

Tabela `wallets` (migration `00008` com backfill `free`/`benefit` → "Geral"/"Benefício"), Ajustes > Carteiras, `walletId` em receita, fonte, pagamento e categoria (`defaultWalletId`), resumo com um cartão por carteira e **saldo anterior transportado** entre meses, aviso `wallet_balance_insufficient`; **transferência** entre carteiras (#54); **mês de início** do saldo inicial (#56); **Conferir saldo** (#60, migration `00012`): o saldo real informado vira um ajuste no mês e os meses seguintes partem dele. Ver [incomes-and-wallets.md](developer-guide/incomes-and-wallets.md) e [carteiras.md](user-guides/carteiras.md).

Decisões que ficaram do desenho original: carteiras são **da casa** (todos veem); a padrão é criada automaticamente e recebe o que não tem carteira escolhida; o fluxo de pagar continua em um toque.

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
- Segurança: [feito] token de convite/reset no fragmento (`#`) em vez da query; limite de login atrás do Tailscale vira balde único (avaliar chave por usuário/e-mail).
- Boleto: mais layouts reais para calibrar as regras de nome, vencimento e competência (cada boleto novo que falhar vira caso de teste, sempre com dados sintéticos).
- [feito: tela Importar, lote e conta sem boleto/lista] Importação de vários boletos de uma vez (duplicidade pela linha digitável; aviso suave de "parece duplicada" para segunda via com outra linha: mesmo favorecido, competência e valor).
- Nomes de favorecido/empresa: normalizar caixa só na sugestão.
- CI mais rápido (dívida): o job `api` leva ~10 min; cache dos pacotes do sistema e testes de integração em paralelo (PT-6 do plano).

## Pós-MVP: investimentos e reserva de emergência

PT-5 do [plano](plano-proximas-etapas.md), em 3 PRs; cada um começa com uma proposta curta para o dono aprovar.

- Metas de reserva de emergência — **feito no PT-5a** (migration 00014): meta em meses de gasto essencial, carteiras que contam como reserva, progresso.
- Investimentos e aportes por casa — **feito no PT-5b** (migration 00015), como recomendado: investimento como **carteira especial** (tipo "investimento"), reaproveitando transferência (aporte e resgate), Conferir saldo (atualizar o valor / rendimento) e o saldo transportado; com tipo e instituição, fora do "saldo projetado" e fora da escolha de carteira ao pagar. Falta a taxa contratada por investimento.
- **Taxas de referência pela BrasilAPI** — **feito no PT-5c** (`/taxas`: CDI, Selic, IPCA em 12 meses; rendimento do mês comparado com o CDI).
- Cotação de ações e fundos: a BrasilAPI não cobre; escolher outra fonte quando a fase começar.
- Regras para qualquer API de terceiros: chamada só pelo servidor, cache, degradação graciosa (o app nunca depende dela) e nenhum dado pessoal na requisição.

## Feito: acesso por domínio com Cloudflare Tunnel (#51)

`make tunnel-setup` e `make tunnel-up` publicam o app por `https://app.<domínio>` a partir do computador, sem abrir porta e sem Zero Trust (túnel gerenciado localmente). O nginx tem uma porta interna (8081) só para o túnel, onde o IP do cliente vem de `CF-Connecting-IP`. O app fica exposto só com o login próprio (decisão do dono: sem Cloudflare Access). Guia: [deployment.md](developer-guide/deployment.md).

## Fase 2 de infraestrutura

- VPS com certbot (hoje: Tailscale com `tailscale serve`).
- Revisar rate limit, cookies e HSTS para exposição pública antes de sair do Tailscale.
- **Backup automático** agendado e enviado para fora da máquina (criptografado, com retenção e verificação por `make test-restore`). Adiado pelo dono (10/2026): fica aqui até ele escolher o destino; até lá, `make backup` manual.

## Ideias sem prioridade

- **Só se o prumia virar um produto comercial** (hoje são duas pessoas usando): **modo demo** (casa de exemplo, sem cadastro), **onboarding simplificado** e **disparo de e-mails** (boas-vindas, convite, nova senha, avisos). Isso traria decisões novas (provedor de e-mail, domínio e reputação de envio, LGPD, planos e cobrança, limites por casa) e **não deve ser antecipado** nas escolhas de hoje além de manter o cadastro e os convites desacoplados da tela.
- Offline parcial no PWA (hoje: instalável, sem offline).
- Exportação (CSV) e importação de extratos.
- Notificação de vencimento próximo.
- Anexar o arquivo do boleto (hoje o arquivo nunca é salvo, por decisão de privacidade; mudar exigiria rever essa regra).
