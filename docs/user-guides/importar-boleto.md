# Importar contas (boleto, conta sem boleto, lista)

## Tela Importar (vários arquivos de uma vez)

Use quando chegaram várias contas juntas, ou uma foto de lista.

1. No computador, escolha **importar** na barra lateral. No celular, toque em **Importar** no alto do mês.
2. Solte os arquivos na área indicada (computador) ou escolha da câmera, da galeria ou dos arquivos (celular). Vale PDF, PNG ou JPG de até 5 MB cada.
3. Acompanhe o progresso (`[ ▪ ▪ ▫ ▫ ] LENDO 2 DE 4`). Se o servidor pedir uma pausa, a tela mostra **aguardando…** e segue sozinha.
4. Confira a tabela de revisão: uma linha por conta, com descrição, valor, vencimento, categoria sugerida e competência. O selo mostra a origem:
   **[ ▪ ] boleto**, **[ ▪ ] conta** (sem linha digitável) ou **[ ▪ ] lista**; **[ ✖ ] OCR: confira** pede atenção extra.
5. Corrija o que precisar, remova linhas que não quer e, nas marcadas como duplicadas, escolha **pular**.
6. Toque em **Criar N contas**. Ou todas entram, ou nenhuma (se algo falhar, a tela indica a linha).

Fotos de lista ("Gás R$ 157,82", "Mercado R$ 568,99", uma por linha) viram uma conta por linha. Contas de consumo sem código de barras
(só "total a pagar" e vencimento) viram uma conta sem linha digitável. Quando o documento traz o CNPJ, a linha oferece cadastrar o favorecido.

Sem arquivo? Toque em **Colar texto**, cole ou escreva as contas e toque em **Ler texto**: elas caem na mesma tabela de revisão
(o texto aparece como um "arquivo" `[ ▪ ] texto`). Vale até 20.000 caracteres.

No formulário de conta, o botão de importar também aceita conta sem boleto; se o arquivo for uma lista, aparece **Abrir em Importar**.

## Padrão para listas (foto ou texto)

**Uma conta por linha: `descrição: valor`.** Vale para print de lista, foto de caderno e texto colado.

Valores aceitos: `R$ 1.234,56`, `R$1234,56`, `R$150` (sem centavos), `1234,56`, `154,72`, `150` e `150,5` (= R$ 150,50).
Separador entre a descrição e o valor: `:`, `=` ou `-`; só um espaço também serve quando o valor tem `R$`.
A descrição precisa de ao menos uma letra e tem até uns 40 caracteres, sem número solto no meio ("Gás 2 botijões: 50" não vale; "Gás: 50" vale).

| Funciona | Por quê |
|---|---|
| `Gás: R$ 150,00` | com R$ |
| `Mercado: 310,25` | vírgula com 2 casas |
| `Gás - 98,40`, `• Mercado: 310,25` | marcador e hífen são aceitos |
| `Ração gatos R$24,99` | R$ dispensa o separador |
| `Gás: 98,40 / Luz: R$ 120` | várias contas na mesma linha, separadas por `/`, `;` ou `|` |
| `Teste: 567` **junto de 2 ou mais** linhas com R$ ou vírgula | número inteiro só vale dentro de uma lista |

| Não funciona | Por quê |
|---|---|
| `Teste: 567` sozinho (ou com só 1 linha com R$) | inteiro sem R$ é ambíguo (pode ser número de medidor ou de cliente): precisa de 2 contas "fortes" |
| `Gás 150` | sem R$ e sem separador |
| `Estava aparecendo westgroup 727` | número solto na descrição |
| Links, e-mails, horas (`22:45`), datas (`10/11/2026`), CNPJ/CPF | ignorados de propósito (por isso um print inteiro de conversa funciona) |
| `Total: R$ 926,80` | "total" e "saldo" não são contas |

Com **uma** só linha válida, vira uma conta comum (não lista). Sempre confira a tabela antes de criar.

## Importar boleto (no formulário de conta)

Como cadastrar uma conta a partir do PDF, da foto ou do print de um boleto, sem digitar a linha toda. Use quando a conta chegou como boleto.

O arquivo é lido na hora e **não fica guardado**. Você sempre confere os dados antes de salvar.

## Passo a passo

1. Toque no botão **+** (no computador, em **Nova conta**, no alto da tela).
2. Deixe o tipo em **avulsa** e toque em **Importar boleto**. No celular, você pode tirar uma foto, escolher da galeria ou pegar o PDF nos arquivos.
   Vale PDF, PNG ou JPG de até 5 MB.
3. Espere a mensagem **lendo o boleto…** sumir.
4. Se o PDF tiver senha, aparece o campo **Senha do PDF**. Digite a senha e toque em **Abrir PDF**. A senha serve só para abrir
   este arquivo e não fica guardada.
5. Confira o quadro **Conferir antes de salvar**: a linha digitável, o beneficiário e de onde ela foi lida. Se aparecer
   **lido por OCR: confira os números**, compare a linha com o papel com mais cuidado.
6. O **Valor**, o vencimento (nas contas de consumo, lido do texto da fatura), o mês de competência (em **Mais opções**) e **Descrição** (o nome do beneficiário, se o campo estava vazio) já vêm preenchidos. Corrija se precisar
   e escolha a **Categoria**.
7. Toque em **Adicionar conta**. A linha digitável fica salva junto com a conta.

## Copiar a linha digitável para pagar no banco

- Logo depois de importar, toque em **Copiar linha digitável** no quadro de conferência.
- Depois, abra a conta na lista (toque no nome dela) e use **Copiar linha digitável** nos detalhes.

Um aviso confirma a cópia. A linha é copiada só com os números, do jeito que o app do banco aceita colar.

## Conferência do nome pelo CNPJ

Quando o boleto traz o CNPJ, o prumia confere o nome de quem recebe no cadastro público de empresas (BrasilAPI). Se achar, usa o
nome do cadastro (mais seguro que o texto do boleto, que pode sair errado na leitura) e mostra **[ ▪ ] conferido pelo CNPJ**.
Se a consulta estiver fora do ar, tudo segue normal com o nome lido do boleto. Só o CNPJ, que é público, é consultado.

## Dar um nome a quem recebe (favorecido)

Quando o boleto traz o CNPJ de quem recebe, o quadro mostra **Como vocês chamam GASCO DISTRIBUIDORA S/A?**. Digite o seu nome ("Gás") e salve:
o prumia guarda esse favorecido e, **nos próximos boletos dessa empresa, já vem com o seu nome e a categoria preenchidos**.
É opcional: deixe em branco e nada é cadastrado. Se você já criou o favorecido à mão, abra **Mais opções**, escolha-o em
**Favorecido** e o CNPJ do boleto passa a valer para ele.

## E se...

- **Aparece "Já existe uma conta com este boleto".** Esse boleto já foi lançado. Toque em **Abrir a conta** para ver a conta que já
  existe, ou em **Fechar aviso** se quiser lançar assim mesmo.
- **Aparece "Não consegui ler este boleto".** Toque em **Tentar de novo** para escolher outro arquivo (o PDF original costuma
  funcionar melhor que uma foto) ou em **Preencher manualmente** para digitar você mesmo.
- **Aparece "Não encontrei contas neste texto".** Escreva uma conta por linha no formato `descrição: valor` (veja o padrão acima).
- **Aparece "Senha incorreta".** Confira a senha (muitos bancos usam parte do CPF) e toque em **Abrir PDF** de novo. Para desistir,
  toque em **Cancelar**.
- **Aparece "Este arquivo não é PDF, PNG ou JPG".** Escolha o PDF do boleto, uma foto ou um print.
- **Ao salvar, aparece "A linha digitável deste boleto é inválida".** Toque em **Importar outro boleto** para ler de novo, ou apague o boleto
  preenchendo manualmente: feche a tela e lance a conta sem importar.
- **Aparece "O arquivo passa de 5 MB".** Use o PDF do boleto ou uma foto/print menor.
- **Aparece "Muitas tentativas".** Espere um minuto e toque em **Tentar de novo**.
- **Importei o boleto errado.** No quadro de conferência, toque em **Importar outro boleto**.
- **Não vejo o botão Importar boleto.** Ele só aparece ao criar uma conta **avulsa** (não em parcelada nem fixa), e só para quem pode lançar contas (o papel de
  **visualização** não pode).
