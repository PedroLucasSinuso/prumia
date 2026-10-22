# Backup e restore

Responde: como o banco do prumia é copiado, onde ficam as cópias, como restaurar e como provar que o restore funciona.

Scripts em [`scripts/`](../../scripts/) (bash, `set -euo pipefail`), com atalhos no Makefile:

| Comando | Script | O que faz |
|---|---|---|
| `make backup` | `scripts/backup.sh` | Gera um backup do banco e aplica a rotação |
| `make restore FILE=... [TARGET=...]` | `scripts/restore.sh [--target <banco>] <arquivo>` | Restaura um backup no banco real (com confirmação) ou em outro banco |
| `make test-restore [FILE=...]` | `scripts/test-restore.sh [arquivo\|latest]` | Restaura num banco temporário, compara com o real e apaga |

## Como funciona

- Tudo roda **dentro do container `db`** com `docker compose exec -T db ...`: o host não precisa de `pg_dump`/`psql`, e a
  versão das ferramentas é sempre a do Postgres que gerou o dado (16).
- O dump é `pg_dump -Fc` (formato *custom*: comprimido, restaura com `pg_restore`, permite listar o conteúdo).
- Usuário e banco vêm das variáveis do próprio container (`POSTGRES_USER`, `POSTGRES_DB`). **A senha nunca é lida nem
  impressa**: dentro do container o Postgres aceita o usuário pelo socket local.
- Os scripts acham a raiz do repositório pela própria localização: funcionam de qualquer diretório.
- Funções comuns em `scripts/lib.sh` (não é executável; é carregado com `source`).

> Pegadinha de shell encontrada no teste: `docker compose exec -T` **lê a entrada padrão**. Se um comando
> que não precisa dela roda antes de um `read`, ele "come" o que a pessoa digitou. Por isso os `exec` que não leem nada
> usam `</dev/null`.

## Onde ficam os arquivos

- Diretório: `backups/` na raiz do repositório (ignorado pelo git; `*.dump` também). Configurável por `BACKUP_DIR`
  (caminho relativo = relativo à raiz do repo).
- Nome: `prumia-AAAAMMDD-HHMMSS.dump` (hora local da máquina). O nome ordena do mais antigo ao mais novo.
- Permissões: diretório `700`, arquivo `600` (o dump tem dados financeiros e hashes de senha).
- O arquivo é escrito como `.prumia-....dump.partial`, validado e só então renomeado: um backup interrompido não deixa
  arquivo pela metade com cara de bom.

Validação de cada backup: não pode estar vazio e `pg_restore --list` precisa ler o índice (o que pega arquivo corrompido
ou truncado).

## Rotação

Depois de cada backup bem-sucedido, só os `BACKUP_KEEP` mais recentes ficam (padrão **14**; com um backup por dia, duas
semanas). A rotação considera só arquivos `prumia-*.dump` do diretório; cópias renomeadas não são apagadas.

```bash
BACKUP_KEEP=30 make backup
```

## Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `BACKUP_DIR` | `backups` | Onde gravar/procurar backups |
| `BACKUP_KEEP` | `14` | Quantos manter na rotação (inteiro ≥ 1) |
| `PRUMIA_ENV_FILE` | `.env` da raiz | `.env` passado ao compose |
| `PRUMIA_COMPOSE_PROJECT` | o do `compose.yaml` (`prumia`) | Projeto compose; útil para testar numa stack isolada |

## Restaurar passo a passo (banco real)

Use quando o banco foi perdido ou estragado e você quer voltar ao estado de um backup. **Tudo o que foi lançado depois
desse backup é perdido.**

1. Confira se o app está no ar: `make ps` (o container `db` precisa estar rodando).
2. Escolha o arquivo: `ls -l backups/`.
3. (Recomendado) Teste o arquivo antes: `make test-restore FILE=backups/prumia-....dump` — se o banco mudou depois do
   backup, as contagens divergem (é esperado); o importante é o `pg_restore` não falhar. Ou restaure numa cópia, abaixo.
4. Restaure: `make restore FILE=backups/prumia-AAAAMMDD-HHMMSS.dump`.
5. Digite o nome do banco (`prumia`) quando pedir. Qualquer outra coisa cancela sem alterar nada.
6. O script então:
   1. faz um **backup de segurança** do estado atual (aparece no fim: `backup de segurança: ...`);
   2. para a API (para ninguém escrever durante a restauração);
   3. apaga e recria o banco (`DROP DATABASE ... WITH (FORCE)`) e carrega o dump com `pg_restore --exit-on-error`;
   4. sobe a API de novo (mesmo se algo falhar).
7. Entre no app e confira. As sessões voltam como estavam no backup (quem tinha sessão ativa naquela hora continua logado).

Se a restauração falhar no meio, o script mostra o comando para voltar ao backup de segurança.

## Restaurar em outro banco

Para conferir um backup sem tocar no banco real:

```bash
make restore FILE=backups/prumia-AAAAMMDD-HHMMSS.dump TARGET=conferencia
```

O banco `conferencia` é criado no mesmo Postgres (se já existir, pede para digitar o nome e o recria). Nomes aceitos:
minúsculas, números e `_`; `postgres`/`template0`/`template1` são recusados. Para olhar e depois apagar:

```bash
docker compose --env-file .env -f deploy/compose.yaml exec db sh -c 'psql -U "$POSTGRES_USER" -d conferencia'
echo 'DROP DATABASE conferencia;' | docker compose --env-file .env -f deploy/compose.yaml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres'
```

A API continua apontando para o banco real; o banco extra só ocupa espaço até ser apagado.

## Testar o restore

```bash
make test-restore                      # gera um backup agora e testa
make test-restore FILE=latest          # testa o mais recente de backups/
make test-restore FILE=backups/x.dump  # testa um arquivo específico
```

O teste restaura em `prumia_restore_test` (no mesmo Postgres), compara com o banco real a **contagem de linhas de todas
as tabelas** do schema `public` (users, households, household_members, categories, invoices, purchases, recurrences,
incomes, income_sources, deduções, sessões, convites...) e a última versão aplicada do goose, imprime a tabela lado a
lado e **apaga o banco temporário** no fim (mesmo se falhar). Código de saída `1` se algo divergir.

Sem arquivo, ele gera um backup novo de propósito: comparar um backup antigo com o banco atual diverge sempre que alguém
lançou algo depois. Com `FILE=...`, divergência pode ser legítima; olhe quais tabelas mudaram.

Rode depois de mudar migrations, de atualizar o Postgres e, de vez em quando, para ter certeza de que o backup diário
está bom. Um backup que nunca foi restaurado é só uma esperança.

## Agendar o backup diário (exemplo, não instalado)

Nada é instalado no sistema pelo projeto. Exemplos para copiar, ajustando o caminho do repositório:

```cron
# crontab -e  — todo dia às 03:15; log em backups/cron.log
15 3 * * * /caminho/para/prumia/scripts/backup.sh >> /caminho/para/prumia/backups/cron.log 2>&1
```

```ini
# ~/.config/systemd/user/prumia-backup.service
# [Unit]
# Description=Backup do banco do prumia
# [Service]
# Type=oneshot
# ExecStart=/caminho/para/prumia/scripts/backup.sh
#
# ~/.config/systemd/user/prumia-backup.timer
# [Unit]
# Description=Backup diário do prumia
# [Timer]
# OnCalendar=*-*-* 03:15
# Persistent=true
# [Install]
# WantedBy=timers.target
#
# Ativar: systemctl --user daemon-reload && systemctl --user enable --now prumia-backup.timer
# (para rodar sem sessão aberta: loginctl enable-linger $USER)
```

O usuário que roda o agendamento precisa ter acesso ao Docker. `Persistent=true` faz o backup perdido (máquina
desligada às 03:15) rodar quando ela ligar.

## Atenção: backup no mesmo disco não é backup completo

`backups/` fica no mesmo disco do banco. Isso protege contra erro humano, bug e banco corrompido, mas **não** contra
perda do disco, roubo da máquina ou ransomware. Copie os arquivos para outro lugar regularmente, por exemplo:

- `rclone copy backups/ remoto:prumia-backups` (para um storage na nuvem, de preferência com criptografia `rclone crypt`);
- uma pasta sincronizada (Syncthing, Nextcloud, Drive) em outro aparelho;
- um HD externo de vez em quando.

Os dumps não são criptografados pelo prumia: quem tem o arquivo tem os dados. Trate a cópia externa como dado sensível.
Isto ainda não é automatizado.
