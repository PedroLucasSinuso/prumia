# Convidar pessoas

Como trazer quem mora com você para a sua casa no prumia, escolher o que cada pessoa pode fazer e ajudar quem esqueceu a senha. Use depois de criar a sua casa.

## O que cada pessoa pode fazer

- **Administrador**: tudo o que há na casa, mais convidar pessoas, mudar o que cada uma pode fazer, renomear e excluir a casa.
- **Membro**: lança, edita e paga contas e receitas.
- **Somente leitura**: só olha. Não lança nem altera nada.

Toda casa tem sempre pelo menos um administrador.

## Convidar uma pessoa

Só administradores convidam.

1. Abra **Ajustes** e escolha **Casa e pessoas**.
2. Em **convidar alguém**, escolha o **papel** (**Participante**, **Só leitura** ou **Responsável**; quem cuida das finanças da casa costuma ser o Responsável) e por quanto tempo o convite **vale** (1, 2 ou 7 dias).
3. Toque em **Gerar link de convite**.
4. Toque em **Copiar link** e envie para a pessoa (WhatsApp, por exemplo).

**Formato do link:** o código do convite vai depois de um `#` (`…/convite#token=…`). Essa parte fica só no navegador de quem abre e não passa pelo servidor. Links enviados antes, com `?token=`, continuam valendo até vencer.

**O endereço do link:** ele usa o endereço público do app, se estiver configurado (`PUBLIC_URL` no `.env`). Sem isso, usa o endereço que você estava usando no navegador, e se for `localhost` o link **não abre no celular da outra pessoa**. Nesse caso, gere o convite abrindo o app pelo endereço que a outra pessoa também consegue acessar (o do domínio, o do Tailscale ou o do IP da rede).

O link só aparece nesta tela, uma única vez. Se perder, gere outro. Cada convite serve para **uma pessoa só**.

## Aceitar um convite

**Ainda não tenho conta:**

1. Abra o link que recebeu.
2. Preencha **Seu nome**, **E-mail** e **Senha** (mínimo de 10 caracteres) e toque em **Criar conta e entrar**.

Você entra direto na casa de quem convidou, sem criar uma casa nova.

**Já tenho conta no prumia:**

- Se já está logado: abra o link e toque em **Entrar na casa**. Suas outras casas continuam com você.
- Se não está logado: abra o link, toque em **Entrar e aceitar o convite**, faça login e, de volta ao convite, toque em **Entrar na casa**.

Se o convite é para outra pessoa e o aparelho está logado na sua conta, saia da conta antes de abrir o link.

## Ter mais de uma casa

Uma conta pode participar de várias casas (por exemplo, a sua e a dos seus pais).

- **Trocar de casa**: toque no nome da casa no topo da tela (no computador, na barra lateral) e escolha outra. O app lembra a
  última casa usada neste aparelho. Com uma casa só, o nome aparece sem o seletor.
- **Criar outra casa**: em **Ajustes > Casa e pessoas**, toque em **Criar outra casa**, dê um nome e toque em **Criar casa**. Você vira administrador
  dela. Cada pessoa cria no máximo 5 casas; para criar mais, exclua uma que não usa.

## Mudar o que uma pessoa pode fazer

1. Em **Ajustes > Casa e pessoas**, na lista **pessoas da casa**, ache a pessoa.
2. Em **papel**, escolha o novo.

Se você é a única pessoa administradora, o app não deixa você se rebaixar. Primeiro torne outra pessoa administradora.

## Tirar alguém da casa ou sair dela

- Para tirar alguém (só administradores): toque em **remover** ao lado do nome e depois em **Confirmar remoção**.
- Para sair você mesmo (qualquer pessoa, até quem só lê): toque em **sair da casa** ao lado do seu nome e confirme. Se você tem outra casa, o app passa para ela; se era a sua única casa, você volta para a tela de entrada.

Quem sai perde o acesso na hora, mas as contas que já foram lançadas continuam na casa, com o nome da pessoa.

Você não troca o seu próprio papel: se é o único Responsável, o app não deixa você sair nem deixar de ser Responsável. Torne outra pessoa Responsável ou, se a casa não é mais necessária, exclua a casa.

## Mudar o nome ou excluir a casa

Só administradores, em **Ajustes > Casa e pessoas**.

1. Em **nome da casa**, escreva o novo nome e toque em **Salvar nome**.
2. Para excluir, toque em **Excluir casa…** e depois em **Sim, excluir a casa**. A casa some para todos. Se você tem outra casa, o app passa para ela.

## Ajudar quem esqueceu a senha

O prumia não envia e-mail. Quem administra a casa gera um link e entrega à pessoa.

1. Em **casa**, ao lado do nome da pessoa, toque em **link de nova senha**.
2. Toque em **Copiar link** e envie à pessoa por um canal que só vocês dois vejam. A tela mostra até quando o link vale.
3. A pessoa abre o link, escolhe uma senha nova (mínimo de 10 caracteres) e toca em **Salvar nova senha**.

Depois da troca, a pessoa é desconectada de todos os aparelhos e entra de novo com a senha nova.

## Convidar alguém para ter a própria casa

Às vezes a pessoa não vai morar com você: ela quer usar o prumia com a **própria conta e a própria casa** (um parente, um amigo, ou
uma conta de testes). Isso é diferente de "Convidar uma pessoa", que leva para a **sua** casa.

Só quem criou a **primeira conta** do prumia vê esta opção.

1. Abra **Ajustes > Minha conta** e vá até **Convites de cadastro**.
2. Escolha por quanto tempo o link vale (1, 2 ou 7 dias) e toque em **Gerar link de cadastro**.
3. Toque em **Copiar link** e envie à pessoa. O link aparece **uma vez só** e funciona **uma vez só**.
4. A pessoa abre o link, preenche nome, e-mail, senha e o nome da casa dela e toca em **Criar conta**.

A casa nova já vem com as carteiras e as categorias padrão. Ela não vê nada da sua casa, e você não vê nada da dela.

- A lista **Links de cadastro pendentes** mostra os que ainda valem. Toque em **Revogar** para cancelar um.
- Dá para ter até **5** links pendentes ao mesmo tempo.
- Se a pessoa vir "Este link de cadastro é inválido", ele venceu, já foi usado ou foi revogado: gere outro.

## E se...

- **"Este convite é inválido, expirou ou foi revogado."** O link está incompleto, o convite já foi usado, passou da validade ou foi cancelado. Peça um novo a quem administra.
- **"Você já faz parte desta casa."** Não precisa de convite: a casa já está na sua lista. O convite não foi gasto.
- **"A casa precisa de ao menos um administrador."** Torne outra pessoa administradora antes de sair ou se rebaixar.
- **"Você só pode redefinir a senha de quem participa apenas de casas que você administra."** A pessoa também está em uma casa que você não administra. Por segurança, só os administradores dessa outra casa também podem ajudar; ou a pessoa pode sair dela antes.
- **"Seu papel nesta casa é somente leitura."** Peça a um administrador para mudar o seu papel para Membro.
- **Link de nova senha não funciona.** Ele vale 1 hora e só uma vez. Gerar um link novo cancela o anterior.
- **"Você chegou ao limite de casas criadas por você."** Cada pessoa cria até 5 casas. Exclua uma que não usa (casas em que você só entrou por convite não contam).
- **O app pediu para entrar de novo.** Por segurança, o login vale no máximo 90 dias, mesmo usando o app todo dia (e cai antes se você ficar 30 dias sem abrir). Entre de novo com o seu e-mail e senha.
