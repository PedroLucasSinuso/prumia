# Salário e previsão

Como lançar seu salário (com os descontos) uma vez só e deixar o app prever os próximos meses. Use quando quiser parar de digitar
o mesmo salário todo mês.

> As telas deste guia chegam junto com o app visual. Os nomes dos botões abaixo são o desenho previsto e podem mudar; o
> comportamento (o que é criado, o que muda e o que não muda) já está pronto e testado.

## Cadastrar o salário

1. Abra **Receitas** e toque em **Nova fonte de receita**.
2. Escolha de quem é (**Pessoa**) e o **Tipo**: **Salário**, **Benefício (VR)** ou **Outra**.
3. Dê um **Nome** ("Salário Ana").
4. Informe o **Valor bruto** (R$ 8.000,00) e o **Dia do recebimento** (de 1 a 31).
5. Escolha o **Mês de início** e, se já souber, o **Mês de fim**.
6. Em **Descontos**, toque em **Adicionar desconto** para cada um e informe o tipo, o nome e o valor: INSS, IRRF, plano de saúde,
   coparticipação ou outro. O app **não calcula imposto**: você digita o valor que aparece no seu holerite.
7. Toque em **Salvar**.

O app mostra o **valor líquido** (bruto menos os descontos) e cria, de uma vez, um lançamento **previsto** por mês, do início até
12 meses à frente, cada um já com o bruto e os descontos que você informou.

Exemplo: bruto R$ 8.000,00, INSS R$ 908,00, IRRF R$ 612,00, plano R$ 350,00 e coparticipação R$ 45,90 dão líquido de **R$ 6.084,10**.

Regras úteis:

- a soma dos descontos **não pode passar do bruto**;
- o **dia 31** vira o último dia dos meses mais curtos (28 ou 29 em fevereiro, 30 em abril);
- o **vale-refeição/alimentação** sempre vai para a **carteira de benefício**, e as outras receitas para a **carteira livre**
  (veja [carteiras.md](carteiras.md)). Não dá para colocar VR na carteira livre.

## Ver a previsão de um mês

1. Em **Receitas**, escolha o mês.
2. Veja a lista: cada linha mostra o valor líquido e se está **prevista** ou **recebida**.

Se você olhar um mês bem à frente, o app gera a previsão até ele. Isso acontece sozinho.

## Ajustar um mês (coparticipação variável)

1. Em **Receitas**, abra o mês e toque no lançamento.
2. Mude o **Valor bruto**, a **Data esperada** ou os **Descontos** (por exemplo, a coparticipação de R$ 199,90 neste mês).
3. Toque em **Salvar**.

Mudar um mês **não muda a fonte** nem os outros meses.

## Marcar como recebido

1. Quando o dinheiro cair, abra o lançamento do mês e toque em **Recebi**.
2. Confirme a data (por padrão, hoje).

Só o que está **recebido** conta no saldo da carteira. Errou? Toque em **Desfazer recebimento** e o lançamento volta a previsto.

## Mudar o salário para os próximos meses

Aconteceu um aumento, ou um desconto mudou:

1. Abra **Receitas**, toque na fonte e escolha **Editar**.
2. Mude o valor bruto, o dia ou os descontos.
3. Escolha **Aplicar a partir de** e informe o mês (por exemplo, o mês do aumento).
4. Toque em **Salvar**.

O que acontece:

- os meses **previstos** daquele mês em diante passam a usar os valores novos. Isso **substitui** os ajustes que você tinha feito
  neles (como a coparticipação de um mês);
- os meses **já recebidos nunca mudam**;
- se você **não** escolher o mês, só os meses futuros que o app ainda vai criar usam os valores novos.

## Encerrar (saí do emprego)

1. Abra a fonte e toque em **Encerrar**.
2. Informe o **último mês** em que você recebe.

Os meses previstos depois dele somem; os já recebidos ficam no histórico. Dá para **antecipar** o fim, mas não adiar nem reabrir uma
fonte encerrada: para voltar, cadastre uma nova.

## Lançar uma receita avulsa

Um bônus, um freela, uma venda:

1. Em **Receitas**, toque em **Nova receita**.
2. Informe a **Descrição**, o **Valor**, o **Mês** e a **Data esperada**; se quiser, os **Descontos**.
3. Toque em **Salvar** e, quando receber, **Recebi**.

## E se...

- **Excluí um mês por engano.** Toque em **Desfazer** logo depois de excluir. O app **nunca recria sozinho** um mês que você excluiu,
  nem quando renova a previsão.
- **A previsão acabou.** O app renova sozinho conforme os meses passam; não precisa fazer nada.
- **Todos veem minha renda?** Sim: quem faz parte da casa vê as receitas de todos os membros, porque a casa é uma só. Quem não faz
  parte da casa não vê nada.
- **Não consigo criar nem editar.** Pessoas com acesso só de leitura (`viewer`) apenas consultam. Peça a quem administra a casa para
  mudar seu acesso.
