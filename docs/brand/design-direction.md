# Direção de design

Complementa o [manual de identidade](manual-identidade-prumia.md). O manual diz **como a marca parece**; este documento diz
**como as telas se comportam** e por quê. Aprovada pelo dono em 20/10/2026 a partir de mockups (pranchas "celular · mês",
"celular · nova conta", "desktop · mês" e "sistema visual").

## Conceito: o prumo

"Prumia" vem de *prumo*: a linha de prumo, o que dá aprumo, "estar no prumo". A interface usa essa ideia como eixo, em vez de
gráficos genéricos de fintech (rosca, pizza, cartão de crédito):

- **Linha do tempo do mês.** Uma linha vertical sustenta a lista; cada conta é um **nó** nela. O nó é também o botão de pagar.
  Um losango **"hoje"** corta a linha: o que está acima e não foi pago é atraso, sem precisar de rótulo.
- **Régua do mês.** 31 barras, uma por dia: altura = valor do dia, cor = estado. O prumo marca hoje. Mostra de relance onde o
  "peso" das contas cai.
- **Medidor segmentado** `[ ▪ ▪ ▪ ▫ ▫ ]` (do manual): quanto do mês já foi pago.
- **Números em mono tabular**, que dão ar de instrumento e alinham colunas.

O símbolo (um polígono facetado) tem uma aresta vertical central: é o mesmo prumo, na marca e na interface.
O arquivo atual é uma **aproximação vetorial** do original (`web/src/components/Logo.tsx`, `web/public/favicon.svg`);
trocar quando houver o SVG final.

## Direção A · "Instrumento calmo" (aprovada em 10/2026)

Mantém a identidade (marfim, petróleo, cobalto, grafite e coral; a barra lateral do Dracula continua roxa) e muda **de onde
vem a hierarquia**: do **tom de superfície** e da **tipografia**, não de bordas. Regras:

- **Um destaque por tela, e ele muda com o estado.** No mês, o bloco `raised` do topo (≈ 2/3 da largura) é:
  - com atrasadas: "pede atenção agora", "N conta(s) atrasada(s)", `[ ✖ ]`, o valor em `alert-text` e a lista acionável
    (atrasadas + vencimentos dos próximos 7 dias), cada linha com "Pagar";
  - sem atraso e com vencimento na semana: "próximos 7 dias";
  - nada pendente: "mês quitado", "Tudo pago em <mês>", o total em `muted` (nunca um R$ 0,00 gigante).
  Em Receitas, a sobra negativa vira o destaque; sem nada recebido, o destaque é o que falta receber. No Resumo, o saldo
  projetado.
- **Contexto sem caixa.** Os números de apoio (a pagar, pago com o medidor, total) ficam ao lado, separados por filetes de
  1 px. Saem os cartões iguais lado a lado.
- **Seções tipográficas** (`SectionRule`): rótulo + contagem + filete + total. "Atrasadas" em `alert-text`.
- **Hover e seleção em `raised`**, não em tinta de marca. Pagas riscadas em `muted`.
- **O tom da estrutura (petróleo/roxo) não se repete em tudo**: fica na barra lateral (`nav`), no botão primário e em raros
  blocos sólidos. Medidor e seleção usam `accent`; o que já foi resolvido usa `done`.
- **Movimento** sempre atrás de `motion-safe`. **Alvos** de 44 px no celular (36 px no computador).

Primitivas em `web/src/components/ui/`: `Surface` (raised · flat · sunken · structure, só tom), `Stat`, `Eyebrow`,
`SectionTitle`, `SectionRule`, `Button`/`ButtonLink` (primary · secondary · quiet · danger · icon; md · sm), `FilterChips`
(grupo sobre `sunken`, ativo em `raised`, `aria-pressed`), `Notice` (erro + "Tentar de novo", `role="alert"`), `EmptyState`,
`ListSkeleton` e `Tag`.

## Leis de UX aplicadas

| Lei | Decisão |
|---|---|
| **Fitts** | Alvos de toque de no mínimo 44 px; "+" e a ação principal ficam na zona do polegar; botões grandes para ações frequentes. |
| **Hick** | Cadastro de conta com poucos campos visíveis (valor, nome, vencimento, categoria); o resto em "Mais opções". Vencimento e categoria são **botões visíveis**, não menus suspensos. |
| **Jakob** | Lista de contas, botão "+", navegação inferior no celular e barra lateral no computador seguem convenções conhecidas; a originalidade está na linha e na régua, não em quebrar o básico. |
| **Miller** | Poucos blocos por tela; o mês agrupado por data. |
| **Proximidade e continuidade (Gestalt)** | Os nós alinhados sobre a linha leem como uma sequência; cada conta agrupa descrição, categoria e valor. |
| **Von Restorff** | O coral aparece **só** em atraso e em "hoje": o que é importante se destaca porque o resto é calmo. |
| **Doherty** | Pagar atualiza na hora, com aviso e **Desfazer** (nada de confirmação bloqueante para ação reversível). |
| **Estética-usabilidade** | Grade de 8/16 px, raios de 4 a 6 px, sem gradientes, sem sombras decorativas; hierarquia por tamanho e peso. |

## Sistema

- **Tipografia** (self-hosted com `@fontsource`; a CSP só aceita `'self'`): **Archivo** (variável, condensada via `font-stretch`) nos
  títulos e no mês; **IBM Plex Sans** (400/500/600) na interface; **IBM Plex Mono** (400/500/600) nos valores, dias e marcadores.
  Rótulos: 11 px, caixa alta, espaçamento aberto; nenhum texto abaixo de 11 px.
  **Escala** (`@theme`, classes `text-*`; nada de `text-[Npx]`): caption 11 · meta 12 · ui 13 · body 15 · title 22 ·
  section 28 · page 40 (page-sm 36 no celular) · figure 34 · figure-lg 44 (valores em mono).
- **Cores**: a identidade (tema **Marfim**, o padrão) usa as cinco cores da marca, e só elas; variações de tom vêm de
  **opacidade**, nunca de um hex novo. Marfim = fundo (≈60%); Petroleum e Grafite = estrutura e texto; Cobalto = dado ativo
  e links; Coral = só alerta. Os **outros temas** são paletas completas que o dono escolheu (abaixo): servem para
  personalizar, não substituem a identidade.
- **Tokens semânticos**: o código não fala o nome da cor, fala o **papel**: `surface` (fundo), `raised` (cartões e campos),
  `ink` (texto e bordas por opacidade), `heading` (títulos), `structure` / `on-structure` (barra lateral, botão primário,
  destaques sólidos e o texto sobre eles), `accent` (dado ativo; `text-accent` quando é texto), `alert` (só alerta) e `line`
  (borda padrão). Papéis da direção A:

  | Papel | Uso | Marfim | Dracula |
  |---|---|---|---|
  | `muted` | texto secundário em cor **sólida** (≥ 4,5:1 sobre `surface` e `raised`); substitui `text-ink/55..85` | `#5E6261` | `#C2C3CC` |
  | `alert-text` | erro e atraso em **texto** (≥ 4,5:1 sobre `surface` e `raised`; evite sobre `sunken`, que no Marfim dá 4,2:1); `text-alert` fica só para marcas, nós, linhas e ícones | `#C53011` | `#FF8F8F` |
  | `sunken` | um tom abaixo do fundo: trilho de filtro, vazio, avisos, blocos de apoio em formulários | `#EAE0CE` | `#21222C` |
  | `line-strong` | borda de campo e controle (substitui `border-ink/25..50`) | ink 32% | ink 36% |
  | `done` | o que já foi resolvido (barra paga da régua, nó pago), discreto | ink 26% | ink 30% |
  | `nav` / `on-nav` | barra lateral, separada de `structure` | `#203D40` | `#7656BD` |

  No Dracula, `raised` passou a `#343746` (cartões calmos sobre o `#282A36`). Por que `heading` separado de `structure`: no Marfim os dois são petroleum, mas num tema escuro o título
  precisa ser claro e o painel, um tom de cor.
- **Temas = paletas completas** (`web/src/index.css`, um bloco `[data-theme='...']` por tema, todos definem todos os papéis):

  | Tema | Tom | Base | Observação |
  |---|---|---|---|
  | Marfim (padrão) | claro | marfim, petroleum, cobalto | a identidade da marca |
  | Solarized | claro | Ethan Schoonover | `accent-text` escurecido para passar 4,5:1 |
  | Latte | claro | Catppuccin Latte | texto e azul escurecidos |
  | Alto contraste | claro | preto e branco | bordas 60% e foco de 3 px |
  | Dracula | escuro | Dracula | painel em roxo derivado (`#7656bd`) para o texto claro passar 4,5:1 |
  | Nord | escuro | Nord | painel e alerta derivados |
  | Gruvbox | escuro | Gruvbox | painel âmbar derivado |
  | Rosé Pine | escuro | Rosé Pine | texto escuro sobre o painel malva |
  | Sistema | auto | Marfim de dia, Dracula no escuro | segue `prefers-color-scheme` |

  Cores "derivadas" são tons das paletas originais ajustados só até o texto passar em WCAG AA (4,5:1). Para conferir
  qualquer paleta (ou uma nova): `python3 scripts/contraste-temas.py` (lê o `index.css`; falha se algum par de **texto**
  ficar abaixo de 4,5:1; confere também `ink`, `muted` e `alert-text` sobre `surface`, `raised` e `sunken`, e `on-nav` sobre
  `nav`). Resultado atual: texto 8,4–21:1, texto secundário 4,7–13,6:1, erro em texto 4,7–7,6:1, títulos 5,0–21:1, texto sobre
  painel e barra lateral 4,7–21:1, links 4,8–10,0:1.
- **Contraste**: o coral `#F06B4F` sobre marfim **não** passa em 4,5:1 para texto. Por isso o coral (`alert`) aparece só em marcas,
  nós e linhas; quando o erro ou o atraso precisa ser **texto** (valor atrasado, aviso de erro, "Atrasadas"), usa `alert-text`.
- **Estados do nó**: oco = a vencer; preenchido em `done` com marca interna = paga; preenchido coral = atrasada; losango coral = hoje.
- **Régua**: 96 px no computador e 48 px no celular, sem caixa; paga em `done`, a vencer em `accent`, atrasada em `alert`.
  "Por categoria" saiu do mês e fica no Resumo.
- **Responsividade**: celular primeiro. Em `md` (≥768 px) entra a barra lateral (`nav`), o conteúdo ganha largura e a lista passa a
  ter o detalhe ao lado (sem janela por cima). A navegação inferior do celular só aparece quando houver mais de um destino.

## Pendências de design (futuro)

- Substituir o símbolo aproximado pelo SVG oficial.
- Ícones do PWA (192/512 px) a partir do símbolo, junto com o HTTPS (Fase 4).
- Revisar contraste e foco com ferramenta automática e testar em celular real.
