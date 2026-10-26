# Política de segurança

O prumia lida com finanças de uma casa, então segurança é levada a sério, mesmo sendo um projeto pessoal.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para falhas de segurança.

Use o relato privado do GitHub: aba **Security** do repositório > **Report a vulnerability**
([abrir direto](https://github.com/PedroLucasSinuso/prumia/security/advisories/new)). Só quem mantém o projeto vê o relato.

Inclua, se puder:
- o que você encontrou e onde (arquivo, rota ou tela);
- passos para reproduzir e o impacto que você enxerga;
- versão ou commit em que testou.

Respondo em **até 7 dias** para confirmar o recebimento. O tempo de correção depende da gravidade; falhas que expõem dados ou
permitem acesso sem login têm prioridade. Se quiser, o seu nome entra nos créditos da correção.

## O que está no escopo

O código deste repositório: API em Go, front-end React, scripts, migrations e a configuração de deploy. Exemplos do que interessa:
- acesso a dados de outra casa (isolamento por casa), ou a ações sem o papel necessário (Responsável, Participante, Só leitura);
- falhas de autenticação, de sessão, de convite ou de redefinição de senha, e de CSRF;
- injeção (SQL, comando), leitura ou gravação de arquivos fora do esperado na leitura de boletos;
- vazamento de segredos, senhas, tokens, conteúdo de boletos ou dados pessoais em logs e respostas.

## O que fica fora

- **Instâncias em uso real.** O app roda de forma privada para uma família. **Não teste contra servidores que não sejam seus**: rode a sua própria cópia (veja `docs/developer-guide/getting-started.md`).
- Negação de serviço, força bruta em larga escala, engenharia social e ataques físicos.
- Falhas em dependências já conhecidas e sem exploração prática aqui (relate à biblioteca de origem; avise-me se houver impacto no prumia).
- Relatórios de scanners automáticos sem uma exploração demonstrada.

## Boas-fé

Pesquisa feita de boa-fé, dentro deste escopo, sem acessar dados de terceiros nem degradar serviços, não será tratada como ataque.

## Versões

Só a branch `main` recebe correções.

## Ao contribuir

Nunca inclua dados reais (boletos, CNPJ/CPF, linhas digitáveis, valores, senhas ou tokens) em commits, issues ou PRs: os testes usam dados **sintéticos**. Se achar um dado real que ficou no repositório por engano, relate pelo mesmo canal privado.
