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
- **Cores**: as cinco da marca, e só elas. Variações de tom vêm de **opacidade**, nunca de um hex novo.
  Marfim = fundo (≈60%); Petroleum e Grafite = estrutura e texto; Cobalto = dado ativo e links; Coral = só alerta.
- **Tokens semânticos**: o código não fala o nome da cor, fala o **papel**. `surface` (fundo), `ink` (texto e bordas por
  opacidade), `structure` (títulos, botão primário, painéis, barra lateral), `on-structure` (texto/ícone sobre `structure`),
  `accent` (dado ativo, links, seleção), `alert` (só alerta) e `line` (borda padrão, = `ink/15`).
- **Temas = troca de papel, nunca cor nova.** Só as cinco cores; cada tema decide qual cor faz qual papel:

  | Papel | Marfim (padrão) | Grafite (escuro) | Contraste |
  |---|---|---|---|
  | `surface` | marfim | grafite | marfim |
  | `ink` | grafite | marfim | grafite |
  | `structure` | petroleum | marfim | petroleum |
  | `on-structure` | marfim | petroleum | marfim |
  | `accent` (fundo/barra) | cobalto | cobalto | cobalto |
  | `accent` (texto) | cobalto | marfim (links já sublinhados) | petroleum |
  | `alert` | coral | coral | coral |
  | `line` | grafite 15% | marfim 15% | grafite 55% |

  No Grafite o petroleum sobre grafite some (1,05:1), por isso `structure` vira marfim (botão e painéis claros, texto
  petroleum) e o cobalto, que como texto dá 2,2:1, só aparece em fundos e barras. O Contraste também engrossa o foco (3 px).
  **Sistema** segue o modo claro/escuro do aparelho (Marfim ou Grafite).
  Contraste medido (WCAG): texto principal 10,3:1 em todos; títulos 9,8–10,3:1; texto sobre `structure` 9,8:1;
  links 4,8:1 (Marfim), 10,3:1 (Grafite), 9,8:1 (Contraste).
- **Contraste**: o coral `#F06B4F` sobre marfim **não** passa em 4,5:1 para texto. Por isso o coral aparece em marcas, nós e linhas;
  o texto de atraso fica em grafite (o estado já é dito pela marca e pelo texto "atrasada").
- **Estados do nó**: oco = a vencer; preenchido teal com marca interna = paga; preenchido coral = atrasada; losango coral = hoje.
- **Responsividade**: celular primeiro. Em `md` (≥768 px) entra a barra lateral teal, o conteúdo ganha largura e a lista passa a
  ter o detalhe ao lado (sem janela por cima). A navegação inferior do celular só aparece quando houver mais de um destino.

## Pendências de design (futuro)

- Substituir o símbolo aproximado pelo SVG oficial.
- Ícones do PWA (192/512 px) a partir do símbolo, junto com o HTTPS (Fase 4).
- Revisar contraste e foco com ferramenta automática e testar em celular real.
