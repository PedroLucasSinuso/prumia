# Leitura de boleto

Como o app transforma um PDF ou print de boleto em uma conta pronta para revisar. Código em `api/internal/boleto/`; rota em `api/internal/api/boletos.go`.

## Regras que não mudam

- **O arquivo nunca é salvo.** Fica na memória durante a requisição e some. Só os dados lidos (linha digitável, código de barras, valor, vencimento, beneficiário) vão para o banco, e só quando a pessoa confirma a invoice.
- **Nada sai do servidor.** Tudo roda com ferramentas locais no container da API. Não há serviço externo de OCR.
- **Nada sensível em log.** Nem arquivo, nem senha de PDF, nem os números lidos: o log da leitura traz só o método (`pdf_text`, `barcode_image`, `ocr`).
- **A pessoa sempre revisa.** A rota só lê (`POST /households/{id}/boletos/extract`) e devolve campos; criar a invoice é outra chamada.

## A cascata

1. **Texto do PDF** (`pdftotext`, do poppler). Rápido e exato quando o PDF tem camada de texto (boletos de banco, em geral).
2. **Código de barras na imagem**: o PDF vira PNG (Ghostscript, 200 dpi, até 2 páginas) ou o arquivo já é imagem; a biblioteca `gozxing` lê o código ITF. Dá a linha digitável pelo cálculo, sem depender de reconhecer números.
3. **OCR** (Tesseract, português): último recurso para print ruim. É o método que mais pede atenção na revisão; a tela avisa quando foi OCR.

Cada etapa só vale se o resultado **passar nos dígitos verificadores**. Número lido errado vira "não encontrei", nunca um boleto falso.

## Validação da linha digitável

`line.go`, com testes de tabela:

- **Cobrança bancária (47 dígitos)**: três campos com dígito módulo 10 e um dígito geral módulo 11 sobre o código de barras. O código de barras (44) é remontado da linha. Valor = 10 últimos dígitos (centavos; 0 = valor aberto). Vencimento = fator de 4 dígitos desde 07/10/1997; **em 22/02/2025 o fator voltou a 1000**, então o mesmo número pode ser duas datas: vale a mais próxima de "hoje".
- **Arrecadação/convênio (48 dígitos, começa com 8)**: quatro blocos de 11 + dígito (módulo 10 se o 3º dígito é 6 ou 7, módulo 11 se 8 ou 9) e um dígito geral. Só os tipos 6 e 8 trazem o valor em reais; o vencimento é livre por empresa e não é extraído.
- O teste usa a linha de exemplo da documentação da Febraban (`00190.50095 40144.816069 06809.350314 3 37370000000100`) como vetor independente, e um teste de mutação confirma que **trocar qualquer um dos 47 dígitos faz a validação falhar**.

## Contrato e erros

`POST /households/{householdId}/boletos/extract`, `multipart/form-data` com `file` (PDF/PNG/JPG, até 5 MB) e `password` opcional. O tipo é detectado pelo conteúdo, não pelo nome.

| Situação | Status | `code` |
|---|---|---|
| Lido | 200 | (`method`, `boleto`, `duplicateOfInvoiceId`) |
| PDF com senha, sem informar | 422 | `password_required` |
| Senha informada errada | 422 | `wrong_password` |
| Não é PDF/PNG/JPG | 422 | `unsupported_file` |
| Nenhum boleto válido no arquivo | 422 | `boleto_not_found` |
| Maior que 5 MB | 413 | `file_too_large` |
| Sem arquivo / multipart inválido | 400 | `bad_request` |
| Muitas leituras seguidas (10, depois 1 a cada 6 s, por usuário) | 429 | `too_many_requests` |
| Já há 2 leituras rodando no servidor e a vez não chegou em 60 s | 503 | `busy` |
| Imagem (ou página desenhada do PDF) acima de 40 megapixels: recusada antes de decodificar | 422 | `boleto_not_found` |
| Papel `viewer` | 403 | `forbidden` |

O upload é lido **parte a parte direto para a memória** (`MultipartReader`); `ParseMultipartForm` gravaria o excedente em arquivo temporário e por isso não é usado. O nginx também mantém o corpo em memória (`client_body_buffer_size`), e o container da API tem `/tmp` em `tmpfs`.

## Duplicidade e persistência

- Ao ler, a resposta traz `duplicateOfInvoiceId` se a casa já tem uma invoice **não excluída** com a mesma linha digitável. Excluir a invoice libera o boleto.
- `POST /invoices` aceita `boleto` com a linha. O servidor **valida os dígitos de novo** e calcula código de barras, valor e vencimento a partir da linha (o que o cliente mandar nesses campos é ignorado). Linha inválida = `400 validation_error` com o campo `boleto.digitableLine`, e nada é gravado (invoice e boleto entram na mesma transação).
- As invoices (lista e detalhe) devolvem o `boleto` (uma consulta para a lista toda, sem N+1).

## Senha de PDF

Vai no campo `password`, é usada só na memória e passada como argumento ao `pdftotext`/`gs` (visível apenas dentro do container, que só roda o processo da API). Não entra em log, em mensagem de erro nem na resposta; os erros das ferramentas são descartados.

## Testes

- `internal/boleto`: validação (tabela, mutação, fator de vencimento), busca em texto com ruído, cascata com dublês, leitura real de código de barras (gera um ITF e relê) e, se `pdftotext` e `gs` existirem, PDFs de verdade com e sem senha.
- `internal/api/boletos_test.go`: ponta a ponta com Postgres real: leitura, duplicidade (e que não vaza entre casas), linha inválida, senha, tamanho, papéis, limite de requisições.
- Não coberto por teste automático: **Tesseract** (é preciso a imagem Docker) e boletos reais de bancos diferentes; ver o guia de teste manual do PR.

## Limitações conhecidas

- Beneficiário vem de heurística sobre o texto, nesta ordem: "Razão social:", "Beneficiário:"/"Cedente" e, sem rótulo, a primeira razão social do documento (nome em maiúsculas terminado em S/A, LTDA etc.). Pode vir vazio ou errado, por isso é só sugestão na revisão.
- Vencimento: o do código de barras prevalece. Conta de consumo (48 dígitos) não o traz, então se lê "Vencimento: dd/mm/aaaa" do texto (datas impossíveis são ignoradas).
- CNPJ (`beneficiaryCnpj`): primeiro CNPJ válido (dígitos verificadores; aceita máscaras fora do padrão, como `11.222-333/0001-81`) a partir do rótulo "Razão social/Beneficiário/Cedente", para não pegar o do pagador. Exige a barra, então CPF nunca entra.
- Conferência pela BrasilAPI (`internal/brasilapi`): com o CNPJ achado, a extração consulta `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`. Se a empresa existe, o nome de quem recebe vira a **razão social do cadastro** (o texto/OCR pode errar o nome, o cadastro não) e a resposta traz `beneficiaryVerified: true`. Falha da API (fora do ar, prazo de 4 s, resposta estranha) é ignorada: segue o nome do documento. Se a API diz que o CNPJ **não existe** e a leitura foi por **OCR**, o CNPJ é descartado (número lido errado que ainda passou nos dígitos verificadores) e a tela não oferece cadastrar.
- Favorecido: com o CNPJ, a resposta traz `payee` (favorecido **não arquivado** da casa com esse CNPJ, ou `null`). Ao salvar a conta: `newPayee {name}` cria o favorecido **na mesma transação** (CNPJ e razão social vêm do boleto, categoria sugerida = a da conta; nome repetido = 409 e a conta não é gravada); `payeeId` de um favorecido sem CNPJ recebe o CNPJ do boleto (`AdoptCNPJ`, nunca rouba CNPJ de outro favorecido). Não combinam entre si. Contas sem CNPJ continuam sem favorecido, que é o caso comum.
- Competência (`documentCompetenceMonth`, dia 1): lida de "Referência:", "Mês:" ou "Competência:" (`10/2026`, `OUT/2026`). Só texto de PDF/OCR; o código de barras não a informa.
- Boleto de arrecadação não tem vencimento extraído.
- Foto torta, amassada ou com reflexo pode falhar em todas as etapas; a resposta é explícita (`boleto_not_found`) e a tela oferece preencher manualmente.

## Documentos: conta sem boleto, lista e lote

`POST /households/{id}/documents/extract` (mesmos limites, limiter e semáforo do boleto; `/boletos/extract` continua igual) devolve
`DocumentExtraction {method, kind, items[]}`. Código em `internal/boleto/document.go` e `table.go`; rota em `internal/api/documents.go`.

Ordem de decisão (a primeira que valer): 1) `boleto`: linha digitável válida pela cascata de sempre, 1 item com tudo; 2) `list`: 2 ou mais linhas
"descrição [:|-] R$ valor"; 3) `bill`: sem linha digitável, mas com valor (rótulos "total a pagar", "valor a pagar", "valor do documento", "total", ou um "R$ x" proeminente),
de preferência com vencimento; 4) nada disso: 422 `boleto_not_found`. Leituras de tabela tratam cabeçalho com vários rótulos + linha seguinte
com os valores; razão social aceita SA/S.A/Ltda/ME/EIRELI em qualquer caixa e o rótulo "Nome / Razão Social".

`POST /households/{id}/invoices/batch {items: InvoiceInput[]}` (1 a 50) cria tudo numa só transação (tudo ou nada); erros de validação
vêm por índice (`items.3.amountCents`); aceita `boleto`/`newPayee`/`payeeId` por item; linha digitável repetida dentro do lote é recusada. Viewer = 403.
No front, `pages/ImportPage.tsx` lê os arquivos em sequência (backoff em 429) e `lib/importing.ts` sugere categoria e monta o lote.

## Padrão de lista (foto ou texto) e `parse-text`

Código em `internal/boleto/list.go` (parser) e `documents.go` (rota). **Uma conta por linha: `descrição: valor`.**

Por linha, `parseListLine`: tira a hora do fim (`14:32 ✓✓`); descarta a linha com `://`, `www.`, `@`, `token=`, hora no meio, data `dd/mm/aaaa`
ou CPF/CNPJ; casa `listLineRe` (descrição preguiçosa, separador `:`/`=`/`-`/`–`, `R$` opcional, número, até 3 "palavras" de lixo curto no fim).
O número passa por `parseMoney` (`150` = 15000, `150,5` = 15050, `R$150`, `1.234,56`; ponto decimal só com `R$`, erro comum de OCR).
Sem `R$` a regra é mais dura: separador obrigatório, descrição de até 40 caracteres, sem número solto e que não termine em dígito, `/` ou `.`.

| Tipo | Condição |
|---|---|
| **Forte** | tem `R$` (com ou sem centavos) **ou** vírgula com 2 casas (`154,72`) com separador |
| **Fraco** | inteiro (ou vírgula com 1 casa) sem `R$`, com separador; teto R$ 100.000 |

`findListItems` só devolve os fracos se o texto tem **2 ou mais itens fortes** (contexto de lista). Assim "Medidor: 3789363" ou "Cliente: 46198"
de uma fatura nunca viram conta. Várias contas na mesma linha (`/`, `;`, `|`) só são divididas se ao menos 2 partes forem itens. A ordem de
decisão de `analyze` não mudou (bill por rótulo forte/vencimento, depois lista, depois 1 item = conta). Testes em tabela: `list_test.go`.

`POST /households/{id}/documents/parse-text {text}` (até 20.000 caracteres; 413 `text_too_large`, 400 sem texto, 422 `boleto_not_found`):
`Extractor.ExtractText` tenta `FindInText` (linha digitável = boleto) e senão `analyze`; resposta `DocumentExtraction` com `method: "text"`.
Sem OCR, sem disco, sem log do conteúdo (só tipo, método e quantidade). Compartilha o limiter por usuário do `/documents/extract`
(429), não usa o semáforo (não sobe processos externos); viewer = 403 pelo middleware. Está nas varreduras de segurança
(`security_test.go`: isolamento por casa e viewer). No front, "Colar texto" em `ImportPage.tsx` põe o texto na mesma fila dos arquivos.
