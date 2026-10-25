# Plano: documentação bonita, onboarding, landing page e demo

Pedido do dono (10/2026): documentação **visualmente bonita e fácil de entender**, onboarding para **mais pessoas** usarem o
prumia e uma **landing page com demo**. Isto revoga a nota do roadmap ("modo demo e onboarding só se virar produto comercial"):
continua **sem** e-mail, cobrança ou planos; o foco é deixar o app fácil de conhecer, experimentar e começar a usar.

Status: **decidido em 10/2026** (seção 2). Próximo passo: F1.

## 1. Onde estamos

- `docs/` tem 3.800 linhas em Markdown: 13 guias de uso (`user-guides/`), 13 guias técnicos (`developer-guide/`), marca
  (`brand/`), roadmap e planos. O conteúdo é bom e atual, mas é texto corrido no GitHub: sem busca, sem imagens, sem navegação.
- Quem chega hoje precisa: receber um convite (de casa ou de cadastro, PT-3) **ou** subir a própria instância (`make up`).
- Não há página pública que explique o que é o prumia nem como ele é por dentro.
- O front já tem uma camada de API simulada nos testes (`web/src/test/utils.tsx`, `mockApi`): base para uma demo sem servidor.

## 2. Decisões

Decididas pelo dono: **D1 ambos**, **D2 Cloudflare Pages** e **D3 demo no navegador**. D4 e D5 seguem a recomendação.

| # | Pergunta | Recomendação do agente |
|---|---|---|
| D1 | **Quem são as "mais pessoas"?** (a) convidadas para a **sua** instância (link de cadastro do PT-3) ou (b) pessoas que vão **hospedar o próprio** prumia, ou ambas | **Ambas**, com prioridade para (a): é o caminho de poucos minutos. (b) entra como guia "Instalar no seu servidor" |
| D2 | **Onde publicar** o site (landing + docs + demo) | **Cloudflare Pages** (grátis, funciona com repositório privado; você já usa Cloudflare). GitHub Pages só é grátis com o repositório público |
| D3 | **Demo**: (a) **no navegador, sem servidor**, com dados fictícios que somem ao recarregar, ou (b) um servidor público com casa de exemplo | **(a)**: custo zero, sem risco de abuso nem de dados reais, sempre igual. (b) exige servidor, reset agendado, limites e moderação |
| D4 | **Ferramenta do site** | **Astro + Starlight**: Markdown (reaproveita os guias), busca embutida, pt-BR, modo escuro, páginas estáticas e uma landing feita no mesmo projeto. Alternativas: VitePress, MkDocs Material |
| D5 | O site fica **neste repositório** (`site/`) ou num repositório à parte | **Neste repositório**: os guias continuam numa fonte só e o CI confere links quebrados |

## 3. Princípios

1. **Uma fonte só**: os guias continuam em Markdown no repositório. O site **lê** esses arquivos (nada copiado à mão).
2. **Marca do manual**: tema Marfim (e escuro), Archivo + IBM Plex, tokens de `src/index.css`, marcadores `[ ▪ ]`, sem
   gradiente. A landing tem a mesma cara do app.
3. **Zero dado pessoal**: toda imagem vem da **demo** (dados sintéticos), gerada por script. Nunca print da casa real.
4. **Sem rastreamento**: nada de analytics, cookies de terceiros ou fontes externas carregadas em tempo de execução.
5. **Escrito para quem não é técnico**: tarefa por página ("Pagar uma conta"), passos numerados, uma imagem por passo
   importante, glossário para os termos do app (carteira, competência, projetado, molde).

## 4. Fases e PRs

### F1 · Site de documentação (2 a 3 PRs)

- `site/` com Astro + Starlight, tema da marca e build no CI (com conferência de links).
- Navegação nova, pensada por tarefa:
  - **Comece aqui**: o que é o prumia, primeiros 10 minutos, instalar no celular.
  - **No dia a dia**: contas, parcelas e fixas, boleto, receitas e salário, resumo do mês.
  - **Dinheiro da casa**: carteiras, transferências, conferir saldo, reserva, investimentos.
  - **Casa e pessoas**: convidar, papéis, nova senha, convite de cadastro.
  - **Perguntas frequentes** e **Glossário** (novos).
  - **Para quem hospeda**: instalar, acessar pelo celular, backup e atualização.
  - **Desenvolvimento**: os guias técnicos de hoje, sem mudança de conteúdo.
- Revisão de texto dos guias de uso: frases curtas, "você", um objetivo por página, "E se..." no fim.
- Capturas de tela automáticas (Playwright contra a demo da F2), em claro e escuro, celular e computador. Até a F2 chegar, o
  site sai sem imagens (ou com as primeiras feitas à mão a partir da demo).

### F2 · Demo no navegador (2 PRs)

- Build `demo` do próprio front (`VITE_DEMO=1`): troca o cliente da API por uma **API falsa em memória**, tipada pelo
  `openapi-typescript` (se o contrato mudar, a demo não compila).
- Casa de exemplo sintética, com datas relativas a hoje:
  - "Casa Exemplo", com Geral e Benefício;
  - salário com descontos, VR, contas fixas, uma compra parcelada e um investimento;
  - meta de reserva configurada.
- Tudo funciona (cadastrar, pagar, transferir, conferir saldo) e se perde ao recarregar. Uma faixa fixa avisa: "Demonstração:
  nada é salvo".
- Fora da demo: leitura de boleto (mostra um exemplo pronto), convites e senha. Esses botões explicam que só funcionam no app de verdade.
- Testes: a demo sobe, uma conta é paga e o resumo muda (vitest + uma passada do Playwright).

### F3 · Landing page (1 PR)

- `/` do site, em uma página:
  - **topo**: marca, "Clareza para construir o futuro." e dois botões, "Ver a demonstração" e "Como começar";
  - **4 blocos** do que o app faz: contas em poucos toques e pagas riscadas; boleto lido sozinho; salário previsto com dias
    úteis e descontos; carteiras, reserva e investimentos. Cada bloco com uma captura da demo;
  - **privacidade**: seus dados ficam no seu servidor, sem anúncio e sem rastreamento;
  - **como começar**: com um convite (2 minutos) ou instalando o seu (15 minutos);
  - **perguntas frequentes curtas**.
- Leve: HTML estático, imagens otimizadas, nota alta no Lighthouse (desempenho e acessibilidade).

### F4 · Onboarding dentro do app (2 PRs)

- **Boas-vindas** depois do primeiro cadastro: 3 telas curtas (o que é carteira, o que é projetado, onde ficam os ajustes),
  que dá para pular.
- **Lista "Primeiros passos"** no topo do Mês até ser concluída (ou dispensada):
  - conferir as carteiras;
  - cadastrar o salário;
  - lançar a primeira conta;
  - instalar no celular;
  - convidar alguém.

  A lista sabe o que já foi feito e some sozinha.
- **Estados vazios** com orientação e link para o guia certo; ícone "?" discreto em cada tela levando à página do site.
- Sem tabela nova se der: o progresso sai dos próprios dados; "dispensado" fica no aparelho.

### F5 · Instalar o seu (1 a 2 PRs)

- Guia "Instalar no seu servidor em 15 minutos": requisitos, `.env` comentado, `make up`, primeiro acesso, celular, backup.
- Avaliar **imagens prontas** no GitHub Container Registry (`docker compose pull` em vez de compilar) e um `scripts/instalar.sh`
  que confere o Docker, gera senhas e sobe tudo.

## 5. Ordem e esforço

```
F1 site (texto + navegação) ──► F2 demo ──► F1b capturas automáticas ──► F3 landing
                                   └──────────────────────────────────► F4 onboarding no app
F5 instalar o seu (independente)
```

| Fase | PRs | Risco |
|---|---|---|
| F1 | 2–3 | baixo (só docs e build do site) |
| F2 | 2 | médio (build novo do front; não toca no app real) |
| F3 | 1 | baixo |
| F4 | 2 | médio (mexe nas telas do app) |
| F5 | 1–2 | médio (deploy) |

## 6. Riscos e cuidados

- **Duas fontes de verdade**: evitado lendo os Markdown originais. O CI quebra com link interno inválido.
- **Demo desatualizada**: a API falsa usa os tipos gerados do contrato, e o teste da demo roda no CI.
- **Dado pessoal em imagem**: capturas só da demo e por script, nunca à mão a partir da casa real.
- **Promessa de produto**: a landing deixa claro que é um projeto pessoal, sem suporte nem garantia.

## 7. O que o dono precisa fazer

- Responder D1 a D5.
- Se for Cloudflare Pages: criar o projeto ligado a este repositório e escolher o domínio (ex.: `prumia.seudominio`).
- Revisar o texto da landing (é a voz da marca) e testar a demo no celular.
