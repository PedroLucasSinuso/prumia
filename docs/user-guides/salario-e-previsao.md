# Receitas: salário, vale e outras entradas

Como cadastrar o salário, o vale-refeição e outras entradas **uma vez** e deixar o prumia cuidar dos próximos meses: a data certa
(dia útil), o valor (cheio ou por dia trabalhado) e o recebimento, que é **automático**. Use ao começar a controlar as receitas
e quando algo mudar.

## A ideia

- Você cadastra a receita uma vez e marca **Repete todo mês**. O prumia cria os próximos 12 meses e continua criando.
- **Você não precisa marcar nada quando o dinheiro cai.** A receita conta como **recebida** sozinha quando a data chega. Só avise
  quando algo der errado: **Não caiu**.
- O **líquido** é **valor − descontos**. Os descontos são opcionais; o prumia nunca os aplica sozinho.

## Cadastrar uma receita

1. Abra **Receitas** no menu e use **Nova receita** (no computador, tecla `N`; no celular, o botão **+**).
2. **Quem e o quê**: escolha a pessoa, o tipo (**Salário**, **Vale (VR)** ou **Outra**) e uma descrição. O VR entra na carteira de
   benefício; o resto, na carteira livre.
3. **Valor**:
   - **Valor cheio**: um valor fixo por mês.
   - **Por unidade**: um preço multiplicado por uma quantidade. Escreva o nome da unidade (por exemplo "dia trabalhado", "hora" ou
     "plantão"). A quantidade já vem com o **número de dias úteis do mês**; ajuste mês a mês. O total é sempre preço × quantidade.
4. **Quando cai**: escolha a regra.
   - **Dia do mês** (por exemplo, dia 28). Escolha o que fazer se cair em fim de semana ou feriado: **Próximo dia útil** (o padrão),
     **Dia útil anterior** ou **Manter a data**.
   - **N-ésimo dia útil** (por exemplo, o 2º ou o 5º dia útil do mês).
   - **Último dia útil**.
   - **Data específica** (só para receita que não se repete).

   Embaixo aparecem as **próximas datas** conforme a regra. Sábado, domingo e feriados nacionais não contam como dia útil.
5. **Repete todo mês**: deixe marcado para salário e vale. Se quiser, escolha até qual mês (**Até**).
6. **Descontos** (opcional): adicione INSS, IRRF, plano de saúde etc. Para salário, **Sugerir INSS e IRRF** preenche INSS e IRRF
   com uma **estimativa pela tabela do ano** (e pelo número de dependentes). Confira no seu holerite e edite os valores. Se o
   imposto do seu caso for diferente (pensão, outras rendas), digite o do holerite.
7. Confira o **líquido** e use **Adicionar receita**.

## Acompanhar o mês

No alto da tela:

- **Recebido** (número grande): o que já caiu neste mês. **A receber** (pequeno): o que ainda falta.
- **Por pessoa**: o recebido e o que falta de cada um.
- **Sobra do mês**: receitas do mês menos as despesas do mês (pagas e a pagar). Em **Ver no resumo** você vê o detalhe.

A lista tem as seções **A receber** e **Recebidas** (no computador, dá para recolher e agrupar **Por pessoa**). Os marcadores:
`[ ▪ ]` recebida, `[ ▫ ]` a receber, `[ ✖ ]` não caiu.

## Quando o dinheiro não caiu

Abra a receita e use **Não caiu**. Ela volta para **A receber** (atrasada, se a data passou) e **sai do saldo**. Quando o dinheiro
entrar, abra de novo e use **Caiu**. Dá para usar **Desfazer** no aviso que aparece. Também é possível usar **Caiu** antes da data, se
o dinheiro entrou adiantado.

## Mudar, excluir e voltar atrás

- **Editar**: abra a receita e use **Editar**. Dá para mudar pessoa, tipo, mês, valor, quantidade, regra de data, descontos e
  observação. Numa receita que se repete, escolha **Só este mês** ou **Este e os seguintes** (que reaplica aos próximos meses ainda
  não recebidos; ajustes feitos neles são sobrescritos). Meses já recebidos nunca mudam em lote.
- **Excluir**: **Excluir só este mês** ou **Excluir este e os seguintes** (encerra a repetição). Use **Desfazer** no aviso para voltar
  atrás. Meses já recebidos não são excluídos em lote.
- **Receitas que se repetem** (no fim da página): veja a regra e o valor de cada repetição, abra **Editar** ou **Encerrar** (mantém o
  mês exibido e tira os seguintes que ainda não caíram).

## E se...

- **Cadastrei e o mês já passou.** A receita com data passada já aparece como **recebida**. Se não caiu, use **Não caiu**.
- **O salário cai no 2º dia útil, mas houve um feriado.** A regra já considera os feriados nacionais. Feriados estaduais e municipais
  não entram: nesse caso use **Data específica** naquele mês (**Editar**, **Só este mês**).
- **O valor muda todo mês (por exemplo, dias trabalhados).** Use **Por unidade** e ajuste a quantidade de cada mês em **Editar**.
- **A estimativa de imposto não bate com o holerite.** É só uma estimativa (não considera pensão, férias, 13º, outras rendas). Use o
  valor do holerite.
- **Uso o computador sem internet para feriados.** O prumia calcula os feriados nacionais sozinho quando não consegue consultá-los.
