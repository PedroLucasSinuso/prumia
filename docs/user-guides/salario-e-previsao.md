# Salário e previsão

Como cadastrar o salário (e o vale-refeição) **uma vez** e deixar o app prever os próximos meses, já com os descontos.
Use quando for começar a controlar as receitas, e quando o salário mudar.

## A ideia

Você não precisa lançar o salário todo mês. Você cria uma **fonte** (o "molde": valor bruto, dia em que cai e descontos). O app
gera a **previsão** dos próximos 12 meses. Em cada mês você só ajusta o que mudou (por exemplo, a coparticipação do plano de
saúde) e marca como **recebido** quando o dinheiro cair.

O **líquido** é sempre **bruto − descontos**. O app **não calcula impostos**: ele só soma o que você informar.

## Cadastrar o salário

1. Abra **receitas** (no menu).
2. Se ainda não houver nenhuma, toque em **Cadastrar salário**. Se já houver, toque em **+ Nova fonte**.
3. Em **Tipo**, deixe **Salário**. Em **De quem é**, escolha a pessoa.
4. Escreva o **Nome** (por exemplo, "Salário Pedro") e o **Valor bruto mensal**. Digite só os números: `850000` vira `R$ 8.500,00`.
5. Informe **Cai no dia** (em meses curtos o app usa o último dia) e **Começa em**.
6. Toque em **+ Adicionar desconto** para cada desconto: **INSS**, **IRRF**, **Plano de saúde**, **Coparticipação** ou **Outro desconto**
   (esse pede um nome). Digite o valor de cada um.
7. Confira o **líquido previsto por mês**, que aparece enquanto você digita, e toque em **Cadastrar fonte**.

Se os descontos passarem do valor bruto, o app avisa e não deixa salvar.

## Cadastrar o vale-refeição (VR)

Faça igual, mas em **Tipo** escolha **Vale (VR)**. Ele entra automaticamente na **carteira de benefício**. Veja
[carteiras.md](carteiras.md).

## Receber

Na lista **Receitas do mês**, toque no quadradinho azul ao lado da receita quando o dinheiro cair. Ele fica preenchido e a receita
passa a contar como **recebida**. Um aviso com **Desfazer** aparece em seguida. Para desfazer depois, toque no quadradinho de novo.

## Ajustar um mês

1. Toque no nome da receita do mês (no computador, os detalhes abrem ao lado da lista; no celular, num painel que sobe).
2. Altere o **valor bruto**, a **data prevista** ou os **descontos** (a coparticipação, por exemplo).
3. Toque em **Salvar alterações**.

Isso muda **só aquele mês**; a fonte e os outros meses ficam como estão.

## Mudou o salário? Atualize a fonte

1. Em **previsão mensal · fontes**, toque na fonte.
2. Altere o valor, o dia ou os descontos.
3. Para atualizar também os meses **já previstos**, marque **Reaplicar este molde aos meses previstos** e escolha **A partir de**.
4. Toque em **Salvar e reaplicar**.

**Atenção:** reaplicar **sobrescreve os ajustes que você fez** nos meses previstos (uma coparticipação diferente, por exemplo). Meses já
**recebidos** nunca mudam. Sem marcar a opção, só os meses futuros que ainda serão gerados usam o novo valor.

Para encerrar uma fonte (saiu do emprego), preencha **Termina em**. Só dá para antecipar o fim, e os meses depois dele deixam de
ser previstos.

## Receita avulsa

Para um dinheiro que não se repete (um freela, um reembolso), toque em **Nova receita** (no celular, no botão **+**), escolha o tipo,
a pessoa, o valor e a data, e toque em **Adicionar receita**.

## E se...

- **Errei o valor do mês.** Abra a receita do mês e corrija. A fonte não muda.
- **Excluí um mês por engano.** Os meses excluídos não são recriados sozinhos; cadastre uma receita avulsa para o mês.
- **A pessoa não aparece na lista de "De quem é".** Só membros da casa aparecem.
- **Só consigo ver, não consigo editar.** Seu papel na casa é de **visualização**.
