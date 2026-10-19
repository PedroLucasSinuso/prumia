# Sistema de Identidade Visual & Design System — prumia (v1.0)
> **Instrução de Contexto para Modelos LLM (Claude):** Utilize este documento markdown como a única fonte de verdade técnica, semântica e estética ao gerar interfaces, códigos front-end (HTML/CSS/React), apresentações ou peças gráficas para a marca **prumia**.

---

## 1. Visão Geral da Marca & Direção Criativa

### 1.1 Contexto de Negócio
A **prumia** é uma plataforma de gestão financeira familiar de alto padrão. O ecossistema foi projetado para organizar finanças compartilhadas, gerenciar membros do núcleo familiar de forma descentralizada, rastrear contas fixas, gerenciar faturas e automatizar a captura de dados de documentos físicos e digitais por meio de leitura **OCR**. 
* **Propósito Central:** Substituir a fricção e o estresse da contabilidade doméstica por clareza visual, inteligência analítica e previsibilidade. Ajudar famílias a obter controle compartilhado e projetar o futuro com solidez financeira.
* **Público-Alvo:** Famílias contemporâneas, casais e núcleos domésticos que buscam uma ferramenta moderna, unificada e profissional — afastando-se do visual rígido do corporativismo bancário tradicional.

### 1.2 Direção Estética: Futuro Analógico
A identidade visual da **prumia** evita os clichês visuais do ecossistema das fintechs genéricas contemporâneas (como o uso massivo de gradientes vibrantes, cantos excessivamente arredondados e estilização em *glassmorphic*). A linguagem visual adota o conceito de **Futuro Analógico**, unindo a precisão das ferramentas digitais modernas à estética otimista, geométrica e editorial dos equipamentos industriais de engenharia e interfaces científicas do início dos anos 1980 e 1990.

#### Diretrizes Estéticas Críticas:
* **Sim:** Modularidade rígida, alinhamento por grades editoriais, micro-marcadores de status baseados em painéis analógicos, formas angulares puras, cantos levemente suavizados (não arredondados como pílulas), alto contraste, tipografia compacta e escaneável.
* **Não:** Gradientes de cores, efeitos de neon, elementos tridimensionais cromados ou brilhantes, imitação caricata de distorção VHS ou scanlines CRT, elementos infantis ou fofos, e referências explícitas a criptomoedas.

---

## 2. Elementos Centrais da Identidade Visual

### 2.1 O Símbolo e Logotipo
A marca gráfica da **prumia** é composta por um símbolo geométrico abstrato assimétrico e uma assinatura nominativa customizada.

```
       /      /       / /\     / /  \ \ 
   / /____\   / /______\   \/________\/
```

* **Construção do Símbolo:** O símbolo consiste em uma estrutura poligonal abstrata construída a partir de segmentos lineares deliberados com vértices ligeiramente suavizados. O desenho projeta a ideia de movimento progressivo, reestruturação interna e equilíbrio geométrico. Utiliza inteligentemente o espaço negativo para sugerir organização de dados complexos.
* **Assinatura Nominativa:** A palavra **"prumia"** é escrita obrigatoriamente de forma totalmente **minúscula**, utilizando uma tipografia sans-serif geométrica com espaçamento de caracteres (*kerning*) calibrado para alto desempenho em telas pequenas.
* **Restrições de Uso:** É proibida a inclusão de metáforas visuais literais, tais como: moedas, porquinhos, cifrões, silhuetas de casas ou famílias, setas literais e folhas.

### 2.2 Variações Permitidas da Marca
1. **Assinatura Horizontal Principal:** Símbolo posicionado à esquerda alinhado verticalmente ao centro com a palavra "prumia" à direita.
2. **Símbolo Standalone:** Uso exclusivo do símbolo em ícones de aplicativos, avatares de redes sociais e favicons de navegadores.
3. **Versão Monocromática Positiva:** Logotipo e símbolo em Graphite Charcoal (#313638) sobre superfícies claras (Warm Mineral Ivory).
4. **Versão Monocromática Negativa (Reversão):** Logotipo e símbolo em Warm Mineral Ivory (#F3EBDD) aplicados sobre painéis escuros (Deep Petroleum Teal ou Graphite Charcoal).

---

## 3. Sistema de Cores (Color Palette)

A paleta de cores foi selecionada para emular painéis de controle industriais clássicos e acabamentos de equipamentos de laboratório de alta precisão. **Todos os códigos hexadecimais devem ser seguidos à risca.**

| Nome do Matiz | Código HEX | Função no Sistema | Aplicação em Código |
| :--- | :--- | :--- | :--- |
| **Warm Mineral Ivory** | `#F3EBDD` | Cor de fundo primária do sistema e áreas de respiro. | `background-color` principal |
| **Deep Petroleum Teal**| `#203D40` | Tom estrutural de alta densidade para painéis e fontes em foco. | Cores de topo, menus e blocos heróis |
| **Graphite Charcoal** | `#313638` | Tom escuro neutro para textos corridos e componentes de controle. | `color` principal do texto e bordas |
| **Muted Cobalt Blue**  | `#416A91` | Cor de acento eletrônica e técnica. Indica seleção ou dados ativos. | Elementos de navegação e gráficos |
| **Controlled Signal**  | `#F06B4F` | Cor de aviso técnica. Pontos focais isolados e status críticos. | Alertas, micro-índices de erro ou conversão |

### Regra de Proporção e Composição (60-30-10):
* **60%** do layout deve manter o tom claro de respiro utilizando o `Warm Mineral Ivory`.
* **30%** é reservado para a estrutura lógica de dados e blocos de agrupamento através do `Deep Petroleum Teal` e `Graphite Charcoal`.
* **10% (ou menos)** é distribuído de forma restrita e intencional entre o `Muted Cobalt Blue` e o `Controlled Signal` para guiar a atenção do usuário. **Nunca** use o coral de forma inundada no layout.

---

## 4. Tipografia & Hierarquia de Dados

A tipografia deve garantir a máxima escaneabilidade de dados numéricos financeiros complexos, sem perder a sofisticação editorial.

* **Tipografia de Exibição & Títulos (Display e Headings):** Geometric Sans-Serif moderna de peso robusto e compacto. Altura de X proeminente e kerning ligeiramente fechado para headings de seções.
* **Tipografia de Interface & Valores Monetários (UI/Body/Numbers):** Neo-grotesque ou Sans-Serif geométrica altamente legível com numerais tabulares (*tnum*) para evitar desalinhamento vertical em tabelas.

### Tabela de Escala Tipográfica (Tailwind CSS Token Mapping)

| Elemento UI | Tamanho / Peso | Espaçamento | Token Equivalente | Uso Recomendado |
| :--- | :--- | :--- | :--- | :--- |
| **Display Heading** | `36px` / Bold (`700`) | `-0.02em` | `text-4xl font-bold` | Grandes títulos de seções e chamadas principais. |
| **Section Heading** | `20px` / Semibold (`600`)| `-0.01em` | `text-xl font-semibold` | Identificadores de cartões e blocos do dashboard. |
| **Body Standard**   | `14px` / Regular (`400`) | `0` | `text-sm font-normal` | Textos explicativos e dados de tabelas. |
| **UI Label / Status**| `11px` / Medium (`500`)  | `0.05em` (Caps) | `text-xs font-medium uppercase`| Rótulos menores e marcadores de estado técnico. |
| **Financial Figure** | `24px` / Bold (`700`) | `0` (Tabular) | `text-2xl font-bold font-mono`| Exibição de saldos monetários ativos. |

---

## 5. Linguagem Gráfica & Componentes de Interface

A estruturação gráfica baseia-se em **contêineres modulares e blocos industriais**.

### 5.1 Diretrizes de Layout e Grid
* As seções de dados devem ser organizadas em grades ortogonais estritas de **8px/16px**.
* Os contêineres de dados devem utilizar cantos levemente suavizados (`border-radius: 4px` ou `6px`). É expressamente proibido o uso de cantos completamente retos cortantes ou cantos ultra-arredondados estilo pílula (ex: `rounded-full`).
* Uso de linhas técnicas finas com opacidade reduzida (`border: 1px solid rgba(49, 54, 56, 0.15)`) para estruturar subseções sem poluição visual.

### 5.2 Micro-marcadores Analógicos
Para sinalizar status, o sistema utiliza pequenos glifos e marcadores geométricos preenchidos, inspirados em painéis de hardware clássico:
* `[ ▪ ]` Estado Ativo / Processado
* `[ ▫ ]` Estado Pendente / Aguardando
* `[ ✖ ]` Alerta ou Falha crítica de OCR

---

## 6. Telas de Aplicação do Produto (Protótipos de Referência)

Ao renderizar componentes com código para a **prumia**, siga os seguintes esquemas estruturais de interface:

### 6.1 Painel de Controle Desktop (Dashboard Principal)
* **Barra Lateral de Navegação (Fundo Deep Petroleum Teal #203D40):**
  * Símbolo standalone prumia no topo.
  * Links limpos em caixa baixa: `dashboard`, `membros`, `faturas`, `importar ocr`.
* **Área Central de Dados (Fundo Warm Mineral Ivory #F3EBDD):**
  * Cabeçalho com o título: **Finanças Claras**
  * Bloco de Saldo Atual com tipografia de numerais tabulares: `R$ 12.345,67`
  * Cartões Individuais (Despesas / Receitas) estruturados com bordas finas em Graphite Charcoal.
  * Gráfico de barras simples em blocos sólidos monocromáticos usando `Muted Cobalt Blue` para as despesas mensais.

### 6.2 Fluxo de Importação com OCR Inteligente
* Painel dividido em duas colunas idênticas:
  * **Coluna Esquerda:** Visualizador do documento carregado (simulação de fatura) com um retângulo técnico semitransparente destacando a leitura ativa da IA.
  * **Coluna Direita (Painel Técnico):**
    * Linha de progresso no estilo terminal de engenharia: `[ ▪ ▪ ▪ ▪ ▪ ▪ ▫ ▫ ] 75% PROCESSANDO`
    * Campos extraídos preenchidos de forma automática em inputs com tipografia monoespaçada: `Empresa: Eletrobrás`, `Valor: R$ 110,00`.

### 6.3 Site Corporativo (Hero Section)
* Composição de alta sofisticação editorial com ampla área de respiro.
* Alinhamento centralizado ou em bloco assimétrico para a esquerda.
* Marca nominativa centralizada: `prumia`.
* Slogan oficial da marca posicionado diretamente abaixo em caixa baixa ou alta regular:
  > **“Clareza para construir o futuro.”**

---

## 7. Diretrizes Críticas para Geração via IA

Ao atuar como o arquiteto ou engenheiro de front-end para a marca **prumia**, certifique-se de que cada linha de código atenda a estes parâmetros:

1. **Pureza de Cor:** Não adicione variáveis ou tons que fujam da paleta hexadecimal estipulada na Seção 3.
2. **Nomes de Componentes:** Todas as interações devem exibir dados e descrições na linguagem padrão do sistema (**Português do Brasil - pt-BR**), exceto pelo nome próprio da marca.
3. **Comportamento Responsivo:** Os componentes gerados devem se adaptar mantendo a rigidez modular tanto na resolução mobile de telas compactas quanto nas visualizações expandidas de desktop de alta densidade.
