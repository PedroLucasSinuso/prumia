# Como fazer backup e restaurar os dados

Use para guardar uma cópia de tudo o que está no prumia (contas, receitas, categorias, pessoas) e, se algo der errado,
voltar a essa cópia. É feito no computador onde o prumia roda, num terminal aberto na pasta do prumia.

## Fazer um backup

1. Abra o terminal na pasta do prumia.
2. Digite `make backup` e aperte Enter.
3. Espere a mensagem `backup ok:` com o nome do arquivo (ex.: `backups/prumia-20261021-031500.dump`).

Pronto: a cópia fica na pasta `backups`. O prumia guarda as 14 cópias mais recentes e apaga as mais antigas sozinho.

## Conferir se o backup presta

1. Digite `make test-restore` e aperte Enter.
2. No fim deve aparecer `OK: restore conferido`. Se aparecer `FALHOU`, não confie nos backups e peça ajuda.

Isso não mexe nos seus dados: a conferência é feita numa cópia temporária, que é apagada no fim.

## Restaurar (voltar a uma cópia)

Só faça isso se os dados se perderam ou estragaram. **Tudo o que foi lançado depois da cópia escolhida será perdido.**

1. Veja as cópias com `ls backups` e escolha a data desejada.
2. Digite `make restore FILE=backups/prumia-AAAAMMDD-HHMMSS.dump` (troque pelo nome do arquivo).
3. Quando pedir, digite `prumia` e aperte Enter. Qualquer outra resposta cancela sem mudar nada.
4. Espere `restauração concluída`. O app fica fora do ar por alguns segundos durante a restauração.
5. Abra o prumia e confira.

Antes de restaurar, o prumia faz sozinho uma cópia do estado atual. Se escolheu a data errada, dá para voltar.

## Quando fazer

- **Todo dia**, de preferência automático (quem cuida do servidor pode agendar; ver o guia técnico).
- **Antes** de atualizar o prumia ou mexer no computador onde ele roda.
- **Uma vez por mês**, rode `make test-restore` para ter certeza de que as cópias funcionam.

## E se...

- **O computador quebrar?** A pasta `backups` fica no mesmo disco. Copie os arquivos de vez em quando para outro lugar
  (pen drive, HD externo, pasta na nuvem). Guarde com cuidado: quem tem o arquivo vê todos os seus dados.
- **Aparecer "o container do banco não está rodando"?** O prumia está desligado. Rode `make up` e tente de novo.
- **Digitei errado na confirmação?** Nada foi alterado. Rode o comando de novo.
- **Quero só olhar uma cópia antiga sem perder nada?** Peça a quem cuida do servidor uma restauração "em outro banco".
