# Roadmap do prumia

O que falta fazer e o que está planejado. Responde: "o que vem depois do MVP e em que ordem?". O estado detalhado por fase fica no `plan.md` local; aqui vai só o que interessa a quem mantém o repositório.

Legenda de risco: **alto** = migration, auth, séries, boleto ou deploy (branch própria, testada, relato no PR); **baixo** = UI e docs.

## Estado atual

MVP completo no `main` (PRs #1–#28): cadastro e login, casas e convites, contas avulsas/parceladas/fixas, receitas, resumo mensal, categorias e ajustes, leitura de boleto (linha digitável, valor, vencimento, beneficiário e competência), backup/restore, CI, Tailscale com HTTPS, PWA e seletor de casa.

## Pendências do dono (testes que só rodam no mundo real)

- [ ] Uso no celular real, pelo Tailscale com HTTPS.
- [ ] Instalar o PWA (Android e iOS).
- [ ] Boletos reais: PDF, print e conta de consumo (48 dígitos). Reportar campo vazio ou errado.
- [ ] `make backup` e `make test-restore` na stack real.
- [ ] Trocar os ícones provisórios do PWA pelo símbolo oficial (`scripts/pwa-icons.py`).
- [ ] Cópia fora da máquina de `docs/product/` (não vai para o GitHub).

## Próximo: favorecidos (apelido + CNPJ)

Motivação: "Gasco" é "Gasco" ou "Gás" para a casa. Risco: **alto** (migration). Em 3 PRs, nesta ordem:

1. **Favorecidos** (feito, #29): tabela `payees` (`household_id`, `name` apelido, `cnpj` opcional único por casa, `legal_name`, `default_category_id`, `deleted_at`) e `invoices.payee_id` nullable, ambos com FK composta. Sem backfill. Endpoints no OpenAPI, bloco "Favorecidos" em Ajustes, testes de isolamento entre casas.
2. **Boleto reconhece o favorecido** (PR aberto): extrair e validar o CNPJ (dígitos verificadores; aceitar máscara torta) do texto; se já cadastrado, preencher "O que é" com o apelido e a categoria padrão; se novo, perguntar "lembrar como…?" depois de salvar.
3. **BrasilAPI** (PR aberto): consulta de CNPJ chamada pela API, para conferir o nome lido do boleto (OCR erra, a API não) e para o cadastro manual, chamada pela API (nunca pelo navegador), timeout curto, cache por CNPJ, falha silenciosa. Exige saída de rede para o container `api`.

Decisão aberta: favorecido opcional em toda invoice (sugerido) ou sempre perguntado na conta avulsa.

## Melhorias de curto prazo

- Sugerir categoria a partir do favorecido/nome do boleto (depende dos favorecidos).
- Mais ajustes na página de configurações (identidade da casa: categorias, favorecidos, preferências).
- Segurança: token de convite/reset no fragmento (`#`) em vez da query; limite de login atrás do Tailscale vira balde único (avaliar chave por usuário/e-mail).
- Boleto: mais layouts reais para calibrar as regras de beneficiário, vencimento e competência (cada boleto novo que falhar vira caso de teste).
- Nomes de favorecido/empresa: normalizar caixa ("GASCO DISTRIBUIDORA S/A" → "Gasco Distribuidora S/A") só na sugestão.

## Pós-MVP: investimentos e reserva de emergência

Já previsto desde o início; novas tabelas, sem backfill.

- Metas de reserva de emergência (meta em meses de despesa, progresso).
- Cadastro de investimentos e aportes por casa.
- **Taxas de referência pela BrasilAPI** (`/taxas`: CDI, Selic, IPCA): comparar rendimento com o CDI e mostrar inflação do período. Confirmar a documentação da API antes de desenhar.
- Cotação de ações e fundos: a BrasilAPI não cobre; escolher outra fonte quando a fase começar.
- Regras para qualquer API de terceiros: chamada só pelo servidor, cache, degradação graciosa (o app nunca depende dela) e nenhum dado pessoal na requisição.

## Fase 2 de infraestrutura

- VPS com certbot (hoje: Tailscale com `tailscale serve`).
- Revisar rate limit, cookies e HSTS para exposição pública antes de sair do Tailscale.
- Backup automático agendado e enviado para fora da máquina.

## Ideias sem prioridade

- Offline parcial no PWA (hoje: instalável, sem offline).
- Exportação (CSV) e importação de extratos.
- Notificação de vencimento próximo.
- Anexar o arquivo do boleto (hoje o arquivo nunca é salvo, por decisão de privacidade; mudar exigiria rever essa regra).
