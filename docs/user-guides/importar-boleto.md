# Importar boleto

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
