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
- **Mês no computador** (`MonthPage`): destaques, régua + "por categoria", lista e painel fixo (`xl`, `useHasSidePanel`). Abaixo de `xl`,
  o detalhe usa `SlideOver` (painel lateral de altura total, foco preso, Esc/clique fora fecham), como "Nova conta" em qualquer
  computador (decisão: o formulário precisa de altura total; o painel fixo fica para leitura). `MonthSections` (seções recolhíveis;
  estado em `localStorage` via `lib/storage.usePref`, protegido por try/catch), `InvoiceDetail` (leitura), `ShortcutsHelp`.
  Regras puras de filtro/seções/próximos vencimentos em `lib/monthList.ts` (testadas à parte). Atalhos: um único ouvinte em
  `document`, ignorado ao digitar ou com `role="dialog"` aberto. Seleção múltipla paga uma a uma; o Desfazer reverte as que passaram.
- **`InvoiceSheet`**: painel de criar/editar (`Sheet` acessível: `role="dialog"`, Esc e toque fora fecham). Erros por campo da API
  são mapeados para o campo certo (`amountCents` -> Valor). No PATCH, observação vazia vai como `null` para limpar.
- **`MoneyInput`**: o valor se forma da direita para a esquerda (digitar `9990` mostra `R$ 99,90`) e guarda **centavos inteiros**.
- **`lib/dates.ts`**: datas como string `AAAA-MM-DD`, sem `Date` do JavaScript (evita o dia "andar" por fuso).
- Usuário `viewer`: sem botão **+** e sem pagar (o servidor também bloqueia; aqui é só para a tela não prometer o que não pode).

Testes das telas simulam a API por rota com `test/utils.tsx` (`mockApi`, `renderAt`).

## Receitas, resumo e navegação

- **Navegação** (`AppShell`, destinos em `lib/navigation.ts` → `NAV_ITEMS`): Mês, Receitas, Resumo e Ajustes (para acrescentar um destino, inclua um item na lista; `mobile: false` o deixa só na barra lateral). Barra lateral `structure` no computador (só ícones em `md`, ícone + rótulo em `lg`; casa e `UserMenu` no rodapé) e barra inferior no celular (ícones lucide, alvos ≥ 44 px, o conteúdo ganha `pb-36`). `/parcelas` fica fora da lista (aberta pelo Mês/Resumo; tem botões próprios que reaproveitam `InvoiceForm` via `initialKind`). Telas lazy: `LoggedInSuspense` (App.tsx) mostra o `AppShell` + `PageSkeleton` na hora. `UserMenu` = avatar com troca de casa, Minha conta, Aparência e Sair. O mês escolhido
  (`?mes=`, `useMonthParam`) acompanha ao trocar de tela.
- **`pages/SummaryPage`**: destaques (saldo projetado da casa, a pagar, atrasado com quantidade, pago), carteiras (`WalletCard`:
  **saldo projetado** como número principal e o realizado "hoje" embaixo; coral só se o projetado for negativo), "para onde vai o
  dinheiro" (`CategoryBreakdown` com `onSelect`: cada categoria/filha abre o histórico) e "Compromissos futuros" (soma de
  `seriesCents` dos 3 meses seguintes, link para `/parcelas`; some quando é zero). Lê `GET /summary` e `GET /summary/categories`
  (`useCategoryHistory`, sob a chave `['summary', casa]`: tudo que invalida o resumo atualiza os gráficos). Computador
  (`useIsDesktop`): grade com "Gasto por mês" (casa) ao lado das carteiras e o histórico da categoria num painel ao lado da lista
  (sem modal; padrão = a categoria que mais pesa). Celular: o histórico abre no `Sheet`.
- **Gráficos** (`components/BarChart`, `components/HistoryPanel`, `lib/history.ts`): SVG próprio, sem biblioteca. Barras por mês
  (6 ou 12), mãe = filhas empilhadas (até 4 fatias + "outras"; cor por POSIÇÃO, fixa, só tokens com opacidade via `fill-*`/`stroke-*`:
  `accent`, `structure`, `accent/45`, `ink/45`, `ink/20`; nunca `text-accent`, que no Grafite vira marfim), **pago sólido e a pagar tracejado** (`<pattern>` a 45° + contorno, mesma cor da fatia). Eixo em mono com valor curto (`R$ 1,5 mil`), rótulo `out/26`, largura medida por `ResizeObserver`. Acessível:
  `role="img"` com resumo dos valores, grupo focável (setas/Home/End mostram o valor exato numa dica `aria-live`) e tabela `sr-only`.
  Média do período e variação do último mês contra o anterior em números simples. As funções de `lib/history.ts` são puras e testadas.
- **`pages/IncomesPage`**: receitas do mês numa linha de prumo de entradas (`IncomeList`: nó cobalto, oco = previsto, cheio = recebido;
  um toque recebe, com Desfazer), números do mês, e o bloco de **fontes** (o molde mensal do salário/VR).
  `IncomeForm` ajusta o mês (líquido ao vivo); `SourceForm` cria/edita a fonte, com **reaplicar aos meses previstos** (`applyFrom`) e o aviso
  de que ajustes manuais são sobrescritos. `DeductionsEditor` edita os descontos itemizados (INSS, IRRF, plano, coparticipação, outro).
- **`pages/SettingsPage`** (`/ajustes/:secao`; `/casa` -> `/ajustes/casa` e `/configuracoes` -> `/ajustes` por `<Navigate>`): painel único.
  Seções em `components/settings/`: `HouseSection` (pessoas na linha de prumo com `MembersList`, convite com `LinkBox` que mostra o
  link **uma vez**, renomear, criar outra casa, zona de perigo; o próprio papel não se troca; `household_limit` vira aviso; sair/excluir
  a casa troca para outra e só encerra a sessão se era a **última**), `CategoriesSection`, `PayeesSection`, `AppearanceSection`,
  `AccountSection`, `DataSection`, `AboutSection`. Computador (`useIsDesktop`): sub-navegação à esquerda e detalhe em `DetailPanel`
  (lateral, não modal; no celular vira `Sheet`); celular: `/ajustes` é o menu de seções e cada seção tem "voltar". A tela usa
  `key={casa}`: trocar de casa a remonta, sem painel aberto vazando de uma casa para outra. Tema: `AuthProvider` aplica `me.theme`
  ao entrar (o `localStorage` é só cache); `AppearanceSection` aplica na hora e grava `PATCH /auth/me`. `AccountSection` usa
  `PATCH /auth/me`, `POST /auth/password` (encerra as outras sessões) e `DELETE /auth/sessions/others`. `DataSection` baixa
  `GET /households/{id}/export/invoices.csv` com `fetch` (resposta é arquivo, não JSON). `Sobre` lê `__APP_VERSION__` (Vite `define`, do package.json).
  Categorias: `useCategories` lê `?includeArchived=true`; conta antiga de categoria arquivada continua mostrando o nome. Reordenar:
  computador arrasta pela alça (HTML5 drag, sem biblioteca; teclado ↑/↓ na alça, com `aria-live`), celular usa o modo **Reordenar**; não
  há endpoint em lote, então `reorder` grava `sortOrder = posição` só nas que mudaram, um PATCH por vez. Ações por linha no `ActionMenu` (⋯).
  Não há excluir: categoria em uso é arquivada. Testes: `pages/Ajustes.test.tsx`, `SettingsPage.test.tsx`, `SettingsHouse.test.tsx`
  (para simular computador, `matchMedia` falso com `min-width`).
- **Links públicos** `/convite?token=` (`InvitePage`: cadastro direto na casa de quem convidou) e `/redefinir-senha?token=`
  (`ResetPasswordPage`). Ficam fora de `RequireAuth`/`RedirectIfAuthenticated` porque valem com ou sem sessão. Quem já está logado
  e abre um convite vê **Entrar na casa** (`useAcceptInvite` → `POST /invites/accept`, relê `/auth/me` e ativa a casa nova); nada é
  consumido sem o toque. Sem sessão, além do cadastro há **Entrar e aceitar o convite**: vai a `/entrar` com
  `state.from = /convite?token=…` e, logado, `RedirectIfAuthenticated` volta para o convite (o `from` vem do estado da navegação, nunca da URL).
- **Casa ativa** (`auth/useActiveHouse.ts`): toda tela usa `useActiveHouse().house` (nunca `me.households[0]`). A escolha fica no
  `AuthProvider` e no `localStorage` (`prumia.casaAtiva.<userId>`, por usuário; falha de armazenamento é ignorada). Casa guardada
  que não está mais em `me.households` (saiu, removido, excluída) cai na 1ª. `selectHouse` grava a escolha e faz `queryClient.clear()`:
  nenhum dado da casa anterior aparece na nova. `HouseSwitcher` (no topo do celular e na barra lateral) só vira botão com 2+ casas:
  abre um `Sheet` com as casas e o papel em cada uma (alvos de 56px, marcador `[ ▪ ]` na ativa); um toque troca.
- **Parcelas e contas fixas**: `InvoiceForm` ganhou o tipo (avulsa/parcelada/fixa) na criação. Parcelada chama `POST /purchases`
  (valor da parcela vira `installmentAmountCents` com total = parcela × N; "total da compra" deixa o servidor dividir). Fixa chama
  `POST /recurrences` com o dia do vencimento e o mês corrente. Ao editar uma invoice de série, "esta e as seguintes" manda
  `?scope=following` sem `dueDate`/`competenceMonth` (o servidor responde 400 com eles) e tira o sufixo ` (n/N)` da descrição.
  `pages/SeriesPage` (`/parcelas`) lista compras (busca `q` com espera de 300 ms) e contas fixas (`RecurrenceForm`). A listagem de
  compras já traz as parcelas (não excluídas, em ordem), então "n de N pagas" e a lista expansível aparecem sempre, sem consulta por compra.
  Excluir "esta e as seguintes" mostra o toast com **Desfazer**, que chama `restore` com `scope=following` (`actions.restore.mutate({ id, scope })`);
  se o servidor recusar (409), o toast avisa para restaurar uma a uma.
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

As cores são **tokens semânticos** (papel, não nome de cor) em `src/index.css` (`@theme inline`) e viram classes do Tailwind.
Nunca use as classes antigas `ivory`/`teal`/`graphite`/`cobalt`/`signal` (não existem mais).

| Token | Classe | Uso | Marfim |
|---|---|---|---|
| `surface` | `bg-surface` | fundo da página, folhas, menus | ivory |
| `ink` | `text-ink`, `border-ink/25`, `bg-ink/5` | texto e bordas (tons por opacidade) | graphite |
| `line` | `border-line` | borda padrão (= `ink/15`; mais forte no tema Contraste) | graphite 15% |
| `structure` | `bg-structure` / `text-structure` | títulos, valores em destaque, botão primário, painéis, barra lateral | teal |
| `on-structure` | `text-on-structure` | texto/ícone sobre `bg-structure` | ivory |
| `accent` | `text-accent` / `bg-accent` | dado ativo, links, seleção | cobalt |
| `alert` | `text-alert` / `bg-alert` | só alerta (atraso, hoje, erro; ≤10%) | signal |

**Como funciona.** Cada token aponta para uma variável `--prumia-*` (`@theme inline { --color-ink: var(--prumia-ink) }`), e
o tema troca essas variáveis pelo atributo `data-theme` do `<html>` (`marfim`, `grafite`, `contraste`, `sistema`). Como o
Tailwind escreve `var(--prumia-ink)` direto na classe, opacidade funciona em qualquer tema (`bg-ink/15` vira
`color-mix(in oklab, var(--prumia-ink) 15%, transparent)`). `text-accent` tem variável própria (`--prumia-accent-text`)
porque no Grafite o cobalto não passa 4,5:1 como texto; `bg-accent`/`border-accent` seguem cobalto. Em valor arbitrário,
use a variável do token (`shadow-[0_2px_0_var(--color-ink)]`). Pares que sempre funcionam: `bg-surface text-ink`,
`bg-structure text-on-structure`, `bg-ink text-surface` (avisos invertidos).

**Tema no código.** `src/lib/theme.ts`:
- `useTheme()` → `{ theme, resolved, setTheme }` (compartilhado entre componentes; `resolved` diz se `sistema` está claro ou escuro);
- `THEMES` (id, rótulo e descrição em pt-BR, para a tela de escolha), `DEFAULT_THEME` (`marfim`), `THEME_STORAGE_KEY`;
- preferência por aparelho em `localStorage` (`prumia.theme`, com try/catch); `setTheme` aplica `data-theme` e a
  `<meta name="theme-color">`.

`public/theme-init.js` aplica o tema salvo **antes** do bundle (sem piscar); é arquivo externo porque a CSP só aceita
scripts de `'self'`. Mantenha-o em sincronia com `theme.ts` (há teste que confere). `main.tsx` chama `startThemeSync()`, que
atualiza a cor da barra quando o aparelho troca de modo no tema `sistema`. Ao criar um tema novo: só as 5 cores, defina o
bloco `:root[data-theme='...']` em `index.css`, acrescente em `THEMES`/`THEME_COLOR` e no `theme-init.js`, e meça o contraste.

Regras (manual de identidade): sem gradientes nem `rounded-full`; raio de 4–6px (`rounded-sm`/`rounded-md`); bordas finas
`border-line`; números com `tabular-nums` (já global) e `font-mono` nos saldos; textos em pt-BR; marca sempre
minúscula. Status com os marcadores `[ ▪ ]`, `[ ▫ ]`, `[ ✖ ]`.

O `public/favicon.svg` é um **placeholder**; falta o símbolo oficial (os ícones do PWA também; ver a seção PWA).

## PWA (instalar no celular)

**O que é:** o mínimo para o navegador oferecer "Instalar app"/"Adicionar à tela inicial": abre em tela cheia
(`display: standalone`), com ícone e barra na cor da marca. **O que não é:** modo offline. O prumia mostra dados
financeiros que vêm da API; abrir com dados guardados no aparelho mostraria contas velhas como se fossem atuais. Por isso
nada do app nem de `/api/` é cacheado pelo service worker.

| Arquivo | Papel |
|---|---|
| `public/manifest.webmanifest` | nome, `start_url`/`scope` `/`, `standalone`, `theme_color` teal, `background_color` ivory, ícones |
| `public/icons/*.png` | `icon-192`, `icon-512` (`any`), `maskable-512` (símbolo dentro do círculo seguro de 80%), `apple-touch-icon` (180) |
| `index.html` | `<link rel="manifest">`, `theme-color`, `apple-touch-icon` e metas do iOS (`apple-mobile-web-app-*`) |
| `public/sw.js` | service worker: navegação vai **sempre à rede**; sem rede, mostra uma página "Sem conexão". Não intercepta `/api/` nem JS/CSS/imagens |
| `src/lib/pwa.ts` | `registerServiceWorker()`, chamado no `main.tsx`: só em **produção**, só em **contexto seguro** (HTTPS ou `localhost`) |

- **Atualização:** o nginx serve `sw.js` com `Cache-Control: no-cache` e o registro usa `updateViaCache: 'none'`, então
  o navegador confere a versão a cada abertura. Como o SW não guarda o app, a versão nova assume na hora (`skipWaiting`) sem
  recarregar a tela; o JS novo vale no próximo carregamento. Mudou `sw.js`? Suba `CACHE_VERSION` (o `activate` apaga os caches antigos).
- **HTTPS é obrigatório** para instalar (exceto `localhost`). Pelo IP da rede local ou `http://` via Tailscale o app funciona,
  mas não instala; ver `docs/user-guides/acessar-pelo-celular.md` (HTTPS pelo Tailscale).
- **nginx:** `location = /sw.js` (sem cache imutável) e `location = /manifest.webmanifest` (`application/manifest+json`).
- **Testes:** `src/lib/pwa.test.ts` (quando registra) e `src/pwa.test.ts` (manifesto válido, ícones existem com o tamanho
  declarado, e o `sw.js` rodado com `self`/`caches`/`fetch` falsos: ignora `/api/`, network-first, página offline, limpeza).
- **Conferir no navegador:** `npm run build && npx vite preview --port <porta alta>`, abrir em `http://localhost:<porta>` e ver
  DevTools → Application → Manifest / Service workers (a seção "Installability" deve vir sem erros).

**Ícones provisórios.** Os PNGs são gerados de uma aproximação vetorial do símbolo (a mesma do `favicon.svg` e do `Logo.tsx`,
na variação `inverse`: fundo teal, símbolo ivory). Quando houver o SVG oficial da marca: atualize os polígonos em
`scripts/pwa-icons.py` (ou troque o desenho por uma renderização do SVG oficial), rode `python3 scripts/pwa-icons.py`
(precisa do Pillow) e confira os PNGs abrindo-os. Os testes validam que os tamanhos batem com o manifesto. Ao trocar o ícone,
quem já instalou pode precisar remover e instalar de novo para ver o novo.

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
