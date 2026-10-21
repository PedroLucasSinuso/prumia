# Frontend

Responde: como o front está montado, como fala com a API e como aplicar a marca.

## Stack

React 19 + Vite + TypeScript 5.9 + Tailwind 4. Lint com **oxlint**, testes com **Vitest** + Testing Library (jsdom).
Mobile-first: escreva o estilo para celular e use os breakpoints do Tailwind (`sm:`, `md:`, `lg:`) para expandir.

> TypeScript está fixado na linha 5.x porque `openapi-typescript` ainda não declara suporte ao 6. Ao subir de versão,
> confira esse peer antes.

## Estrutura (`web/`)

```
src/
├── api/
│   ├── schema.d.ts   tipos gerados do openapi.yaml (não editar; versionado)
│   └── client.ts     cliente HTTP tipado (openapi-fetch)
├── auth/             sessão: contexto (AuthContext), hook useAuth, proteção de rotas, mensagens de erro
├── components/       peças da marca (Logo, AppShell, UserMenu, Field, Button, FormError, AuthLayout, Sheet, Toast...)
├── pages/            telas (LoginPage, RegisterPage, HomePage)
├── lib/              utilitários puros (ex.: money.ts)
├── test/setup.ts     configuração dos testes
├── App.tsx           rotas (react-router)
└── index.css         Tailwind + tokens da marca
```

## Falando com a API

O cliente `api` é tipado pelo contrato: rotas, parâmetros e respostas são checados pelo TypeScript.

```ts
const { data, error, response } = await api.GET('/healthz')
```

Mudou o `openapi.yaml`? Rode `make generate` (regenera `schema.d.ts` e o código Go; `make web-types` regenera só o do front). Se o contrato mudar de um jeito que quebra o uso, o
`npm run typecheck` aponta o lugar. O cookie de sessão é httpOnly e vai junto sozinho porque o front e a API ficam na mesma
origem (`/api`): em desenvolvimento pelo proxy do Vite, em produção pelo nginx.

## Sessão e rotas

O `AuthProvider` pergunta `GET /auth/me` ao abrir o app: 200 = logado, 401 = anônimo (o cookie é httpOnly, o JavaScript
nunca o vê). `useAuth()` expõe `session`, `login`, `register` e `logout`. `RequireAuth` protege as rotas (sem sessão manda
para `/entrar`, lembrando o destino) e `RedirectIfAuthenticated` tira quem já entrou das telas de entrada.

Erros da API chegam como `problem+json` com um `code` estável; `auth/errors.ts` traduz os códigos para pt-BR. O front
**não** mostra mensagem crua do servidor em erros inesperados. Erros por campo (`fields`) aparecem no campo certo e somem
quando a pessoa volta a editá-lo.

O `tsconfig` usa `strict: true`: sem isso o TypeScript não estreita uniões como `ActionResult` (`ok: true | false`).

## Dados do servidor e telas do mês

`api/queries.ts` usa **TanStack Query**: `useCategories`, `useInvoices(casa, mês)` e `useInvoiceActions(casa)` (criar, editar,
excluir, restaurar, pagar, desfazer). Toda ação invalida `['invoices', casa]`, então a lista do mês se refaz sozinha. `unwrap`
converte a resposta do cliente tipado em promessa que rejeita com `ApiError` (que carrega o `problem` ou `network`).

- **Identidade da tela do mês** (ver `docs/brand/design-direction.md`): `Timeline` (a linha de prumo: cada conta é um nó que também
  é o botão de pagar; um losango marca "hoje" e o que está acima e não foi pago é atraso), `MonthRuler` (31 barras: altura = valor
  do dia, cor = estado, o prumo marca hoje; tem texto alternativo com o dia mais pesado), `PaidGauge` (medidor segmentado) e
  `InvoiceForm` (valor em destaque; vencimento e categoria como **botões**, "Mais opções" para competência e observação).
- **Celular x computador** (`useIsDesktop`, breakpoint `md` = 768 px): no celular o formulário sobe num painel (`InvoiceSheet`) e há
  um botão "+" flutuante; no computador o detalhe fica num **painel ao lado da lista** (sem janela por cima) e "Nova conta" fica no
  cabeçalho. Os blocos que só existem num dos modos são renderizados condicionalmente (não duplicados no DOM).
- **`pages/MonthPage`**: a visão do mês. O mês escolhido fica na URL (`?mes=2026-10`); sem parâmetro, vale o mês atual.
  Agrupa por `status` (derivado no servidor): atrasadas, a vencer, pagas. Totais: *a pagar* soma atrasadas e a vencer; *pago* soma
  o **valor efetivamente pago** (pode diferir do valor da conta).
- **Pagar com um toque**: `togglePaid` usa a carteira sugerida pela categoria (`defaultWallet`) ou a livre, mostra um aviso com
  **Desfazer** (`ToastProvider`/`useToast`) e não pergunta nada.
- **`InvoiceSheet`**: painel de criar/editar (`Sheet` acessível: `role="dialog"`, Esc e toque fora fecham). Erros por campo da API
  são mapeados para o campo certo (`amountCents` -> Valor). No PATCH, observação vazia vai como `null` para limpar.
- **`MoneyInput`**: o valor se forma da direita para a esquerda (digitar `9990` mostra `R$ 99,90`) e guarda **centavos inteiros**.
- **`lib/dates.ts`**: datas como string `AAAA-MM-DD`, sem `Date` do JavaScript (evita o dia "andar" por fuso).
- Usuário `viewer`: sem botão **+** e sem pagar (o servidor também bloqueia; aqui é só para a tela não prometer o que não pode).

Testes das telas simulam a API por rota com `test/utils.tsx` (`mockApi`, `renderAt`).

## Receitas, resumo e navegação

- **Navegação** (`AppShell`): mês, receitas, resumo e casa, na barra lateral (computador) e na barra inferior (celular). O mês escolhido
  (`?mes=`, `useMonthParam`) acompanha ao trocar de tela.
- **`pages/SummaryPage`**: "sobra ou falta?" por carteira (`WalletCard`: saldo, previsto, recebido, pago), pago x a pagar e total por
  categoria (barra pago + a pagar). Só lê `GET /summary`; o cálculo é do servidor (recebido − pago, por competência).
- **`pages/IncomesPage`**: receitas do mês numa linha de prumo de entradas (`IncomeList`: nó cobalto, oco = previsto, cheio = recebido;
  um toque recebe, com Desfazer), números do mês, e o bloco de **fontes** (o molde mensal do salário/VR).
  `IncomeForm` ajusta o mês (líquido ao vivo); `SourceForm` cria/edita a fonte, com **reaplicar aos meses previstos** (`applyFrom`) e o aviso
  de que ajustes manuais são sobrescritos. `DeductionsEditor` edita os descontos itemizados (INSS, IRRF, plano, coparticipação, outro).
- **`pages/HousePage`** (`/casa`): pessoas na linha de prumo (`MembersList`: papel, link de nova senha, remover/sair com confirmação
  em dois toques), convite (`LinkBox` mostra o link **uma vez**, o servidor não guarda o token), renomear e excluir a casa. O que é só de
  admin some para os demais (o servidor confere de novo). Sair da casa ou excluí-la encerra a sessão (ainda não há tela com várias casas).
- **Links públicos** `/convite?token=` (`InvitePage`: cadastro direto na casa de quem convidou) e `/redefinir-senha?token=`
  (`ResetPasswordPage`). Ficam fora de `RequireAuth`/`RedirectIfAuthenticated` porque valem com ou sem sessão. Quem já está logado
  e abre um convite é avisado, nunca consome o convite sem querer. `acceptInvite` (conta existente entrando em 2ª casa) fica para o seletor de casa.
- **Parcelas e contas fixas**: `InvoiceForm` ganhou o tipo (avulsa/parcelada/fixa) na criação. Parcelada chama `POST /purchases`
  (valor da parcela vira `installmentAmountCents` com total = parcela × N; "total da compra" deixa o servidor dividir). Fixa chama
  `POST /recurrences` com o dia do vencimento e o mês corrente. Ao editar uma invoice de série, "esta e as seguintes" manda
  `?scope=following` sem `dueDate`/`competenceMonth` (o servidor responde 400 com eles) e tira o sufixo ` (n/N)` da descrição.
  `pages/SeriesPage` (`/parcelas`) lista compras (busca `q` com espera de 300 ms) e contas fixas (`RecurrenceForm`). A lista de compras
  da API pode vir sem as parcelas; a tela só expande quando elas vêm. Excluir "esta e as seguintes" não tem Desfazer (restore é por invoice).
- **Líquido**: o front só mostra `bruto − descontos` enquanto a pessoa digita (`lib/income.ts`); a fonte da verdade é `netAmountCents` do servidor.
- **Aviso de VR**: ao pagar na carteira de benefício, `warnings: ["benefit_balance_insufficient"]` vira um aviso no toast (o pagamento não é bloqueado).
- Pagar, receber ou criar invalida as listas **e** o resumo (`['summary', casa]`), então os saldos se atualizam sozinhos.

## Importar boleto

Na criação de conta do tipo **avulsa**, o `InvoiceForm` mostra **Importar boleto** (`BoletoImport`; trocar para parcelada/fixa descarta a leitura): um `input type=file` escondido
(`accept="application/pdf,image/png,image/jpeg"`, sem `capture`, então o celular oferece câmera, galeria e arquivos) envia o arquivo
para `POST /boletos/extract` via `useExtractBoleto` (`api/queries.ts`). O corpo é `multipart/form-data`: o `bodySerializer` do
openapi-fetch monta o `FormData` e o navegador põe o boundary. Arquivo acima de 5 MB é barrado antes de enviar. Toda falha vira
`ApiError` com `problem.code` preenchido, mesmo quando a resposta não traz `code` (413 do nginx em HTML vira `file_too_large`, 422 vira
`boleto_not_found`, 429 `too_many_requests`); `boletoErrorMessage` (`auth/errors.ts`) traduz `file_too_large`, `unsupported_file`,
`boleto_not_found`, `password_required`, `wrong_password` e `too_many_requests` (desconhecido = "não consegui ler"). Estados: escolher →
"lendo o boleto…" → (`password_required`/`wrong_password`: campo **Senha do PDF**) → **Conferir antes de salvar**.
A senha **não** vai para estado do React: é lida do campo (ref) no envio e o campo é limpo; a mutação usa `gcTime: 0` e `reset()` para
não deixar arquivo/senha no cache do TanStack Query. O arquivo fica num ref só enquanto pode ser reenviado (senha, rede, 429).
O sucesso **pré-preenche** valor (`documentAmountCents`), vencimento (`documentDueDate`) e descrição (`beneficiaryName`, só se vazia), e o
quadro de revisão mostra a linha digitável, o beneficiário, o método de leitura (OCR pede conferência) e, se `duplicateOfInvoiceId` vier,
o aviso com **Abrir a conta** (busca o detalhe, vai ao mês dela e abre) e **Fechar aviso**. Ao salvar, `boleto` vai no `InvoiceInput` só com
`digitableLine` e `beneficiaryName` (o servidor recalcula valor/vencimento do documento pela linha); linha recusada volta 400 com
`fields["boleto.digitableLine"]`, mostrado junto ao quadro do boleto.
`BoletoBox` (linha digitável agrupada por `lib/boleto.ts` só na exibição + **Copiar linha digitável**, que copia só dígitos) também aparece
no detalhe de uma conta que já tem `boleto`. Testes: `components/BoletoImport.test.tsx` (rota `extract` do `mockApi` aceita função do corpo).

## Marca no código

Os tokens estão em `src/index.css` (`@theme`) e viram classes do Tailwind:

| Token | Classe | Uso |
|---|---|---|
| `#F3EBDD` ivory | `bg-ivory` | fundo (≈60%) |
| `#203D40` teal | `bg-teal` / `text-teal` | estrutura: topo, menus, painéis |
| `#313638` graphite | `text-graphite` | texto e bordas |
| `#416A91` cobalt | `text-cobalt` | acento: seleção, dados ativos |
| `#F06B4F` signal | `text-signal` | alertas (raro, nunca inundar) |

Regras (manual de identidade): sem gradientes nem `rounded-full`; raio de 4–6px (`rounded-sm`/`rounded-md`); bordas finas
`border-graphite/15`; números com `tabular-nums` (já global) e `font-mono` nos saldos; textos em pt-BR; marca sempre
minúscula. Status com os marcadores `[ ▪ ]`, `[ ▫ ]`, `[ ✖ ]`.

O `public/favicon.svg` é um **placeholder**; falta o símbolo oficial.

## Dinheiro e datas

Dinheiro chega e sai como **inteiro em centavos**, igual ao backend. Formate só na exibição (`lib/money.ts`). Datas de calendário
são strings `AAAA-MM-DD` (sem fuso); nunca converta para `Date` do JavaScript sem cuidado, porque o fuso pode mudar o dia.

## Comandos

| Comando | O que faz |
|---|---|
| `make web-install` | instala dependências (`npm ci`) |
| `make web-dev` | servidor de desenvolvimento, com proxy `/api` para `localhost:8080` (`API_URL` muda o destino) |
| `make web-test` | lint, typecheck e testes |
| `make web-build` | build de produção em `web/dist` |
| `make web-types` | regenera os tipos a partir do OpenAPI |
