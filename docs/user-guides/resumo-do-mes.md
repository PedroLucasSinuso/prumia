# Resumo do mês

Como ler o resumo para responder: **no fim do mês, vai sobrar ou faltar dinheiro, e para onde ele vai?** Use quando quiser conferir
como as coisas estão, não só no fim do mês.

## Abrir

Selecione **resumo** no menu. Use ‹ e › para trocar de mês; o mês que você estava vendo acompanha ao trocar de tela.

## Os destaques

A primeira linha tem quatro números:

- **Saldo projetado** da carteira padrão (a Geral): tudo o que está **previsto para entrar** nela no mês menos o que **já foi pago**
  e o que **falta pagar**. É o número principal. Diz **deve sobrar** ou, se vai faltar, **vai faltar** com o marcador `[ ✖ ]`.
  Não soma as outras carteiras: o que sobra no Benefício (VR) não paga o aluguel. Se outra carteira vai ficar negativa, aparece
  logo abaixo um aviso como "`[ ✖ ]` Benefício: vai faltar R$ 120,00".
- **A pagar**: o que ainda não foi pago (inclui as atrasadas).
- **Atrasado**: quanto já venceu sem pagar e em quantas contas. O marcador `[ ✖ ]` só aparece se houver alguma.
- **Pago**: o que já saiu, pelo valor efetivamente pago (com juros ou desconto).

Por que projetado? Se hoje é dia 22 e o salário cai dia 30, você ainda não marcou o salário como recebido. O app **não** acusa
"falta" por isso: o salário previsto já conta no projetado.

## As carteiras

Há um bloco para cada carteira da casa (a **padrão** em destaque; veja [carteiras.md](carteiras.md)). O saldo continua de um mês para o outro: o bloco mostra o que veio dos meses anteriores.

- O destaque é o **saldo projetado** da carteira, com **deve sobrar** ou **vai faltar**.
- Logo abaixo, **hoje**: o que já foi recebido menos o que já foi pago (o "realizado"). Pode estar negativo sem ser problema, se o
  salário ainda vai cair.
- A barra mostra quanto **do previsto** já foi pago.
- Por fim: **previsto para entrar**, **já recebido**, **já pago** e **a pagar (estimado)**. Se houve transferência entre carteiras no mês, aparecem também **transferências recebidas** e **transferências enviadas** (e entram no saldo de hoje e no projetado).

"A pagar (estimado)": a carteira de uma conta só é conhecida quando você paga. Até lá, o app usa a carteira sugerida da
categoria (ex.: Mercado → Benefício; veja [categorias-e-ajustes.md](categorias-e-ajustes.md)). Sem sugestão, conta na carteira padrão. Por isso o
saldo projetado de cada carteira, inclusive o do destaque, depende dessa estimativa: marque a carteira sugerida nas categorias. Veja também [carteiras.md](carteiras.md).

## Transferir entre carteiras

O botão **Transferir**, no topo do Resumo, move dinheiro de uma carteira para outra: por exemplo, guardar R$ 500,00 do Geral na Reserva
ou tirar de lá. Escolha o valor, **De**, **Para**, a data e (se quiser) uma observação. Depois de salvar, aparece um aviso com **Desfazer**.

Mais abaixo, **Transferências do mês** lista cada uma (data, de → para, valor, observação) com o botão de excluir. Transferência **não é
receita nem conta**: não entra em "pago", "a pagar" nem em "para onde vai o dinheiro", só muda o saldo das carteiras. Passo a passo em [carteiras.md](carteiras.md).

## Para onde vai o dinheiro

Cada categoria aparece com o total do mês e uma barra: a parte **escura** é o que já foi pago e a **azul** é o que ainda falta pagar.
As categorias vêm da maior para a menor; a categoria principal soma as subcategorias, detalhadas embaixo.

### Histórico de uma categoria (gráfico)

1. Selecione uma categoria (ou uma subcategoria) na lista.
2. No **celular**, o histórico abre num painel que sobe da base; feche com **×** ou tocando fora. No **computador**, ele aparece ao
   lado da lista (de início, o da categoria que mais pesa no mês).
3. Cada barra é um mês, terminando no mês do resumo. Use **6 meses** ou **12 meses** para mudar o período.
4. Numa categoria principal, as barras empilham as **subcategorias**, uma cor por subcategoria (veja a legenda). Numa subcategoria
   ou categoria sem subcategorias, é uma barra só.
5. Parte **sólida** = já pago; parte **listrada** = a pagar.
6. Para ver o valor exato de um mês, passe o mouse sobre a barra; no teclado, selecione o gráfico com Tab e use ← e →.

Em cima do gráfico: a **média por mês** do período e a **variação** do mês do resumo contra o anterior (ex.: `+R$ 10,00 (+7%)`).

### Gasto por mês (computador)

No computador, ao lado das carteiras, o gráfico **Gasto por mês** mostra o total da casa nos últimos 6 meses (ou 12).

## Compromissos futuros

Se você tem compras parceladas ou contas fixas, aparece quanto delas já está programado para os **próximos 3 meses**, mês a mês.
Selecione **ver parcelas e fixas** para abrir a tela de parcelas. Sem parcelas nem contas fixas, a seção não aparece.

## Tudo por competência

O resumo e os gráficos agrupam pelo **mês de competência** das contas e das receitas, não pela data em que o dinheiro se mexeu. A
conta de luz de setembro paga em outubro entra em **setembro**.

## E se...

- **Aparece "Ainda não há receitas neste mês".** Cadastre o salário em **receitas**; o app prevê os próximos meses (veja
  [salario-e-previsao.md](salario-e-previsao.md)). Sem receitas, o projetado mostra só o que sai.
- **O saldo não bate com o meu banco.** É esperado: o resumo é do mês, sem saldo anterior.
- **A carteira Benefício diz "vai faltar", mas paguei o mercado com outra carteira.** A estimativa usa a carteira sugerida da categoria
  até você pagar; depois de marcar como paga, vale a carteira escolhida.
- **Falta um pagamento.** Confira se a conta foi marcada como **paga** em **mês**.
