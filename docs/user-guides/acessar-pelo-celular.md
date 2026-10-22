# Como acessar o prumia pelo celular

Use quando quiser abrir o prumia no celular (em casa ou na rua) com o endereço seguro `https://...`, sem deixar o app
aberto para a internet. Quem faz isso é o **Tailscale**, um app gratuito que cria uma rede privada só entre os seus aparelhos.

Você faz isso **uma vez** no computador onde o prumia roda, e uma vez em cada celular.

## No computador

1. Instale o Tailscale: abra <https://tailscale.com/download>, escolha o sistema do computador e siga o instalador.
2. Entre na sua conta (Google, Microsoft, GitHub ou e-mail). Guarde qual conta usou: o celular tem de usar **a mesma**.
3. Abra o painel do Tailscale em <https://login.tailscale.com/admin/dns>.
4. Em **MagicDNS**, clique em **Enable** (se já estiver ligado, siga).
5. Em **HTTPS Certificates**, clique em **Enable HTTPS**.
6. No arquivo `.env` do prumia, deixe `APP_ENV=production`.
7. No terminal, na pasta do prumia, rode `make up` e depois `make tailscale-up`.
8. Anote o endereço que aparece no fim, no formato `https://<nome-do-computador>.<sua-rede>.ts.net`.

## No celular

1. Instale o app **Tailscale** (Play Store ou App Store).
2. Abra e entre com **a mesma conta** do computador.
3. Ligue a chave do Tailscale (o celular pode pedir para permitir uma "VPN": aceite).
4. Abra o navegador e digite o endereço anotado (`https://...ts.net`).
5. Entre com o seu e-mail e senha do prumia.

Dica: no menu do navegador, use **Adicionar à tela inicial** para abrir o prumia como um app.

## E se...

- **A página não abre**: confira se a chave do Tailscale está ligada no celular e se o computador está ligado e com o
  Tailscale conectado. No computador, rode `make tailscale-status`.
- **Aparece aviso de certificado ou "não seguro"**: o passo 5 do computador (HTTPS Certificates) não foi feito. Faça e rode
  `make tailscale-up` de novo. A primeira abertura pode demorar alguns segundos enquanto o certificado é emitido.
- **Entro, mas volto para a tela de login / "erro ao salvar"**: avise quem cuida do servidor e diga a mensagem exata;
  há um roteiro para isso em `docs/developer-guide/deployment.md` (seção do erro `bad_origin`).
- **Quero que outra pessoa da casa acesse**: ela precisa entrar no seu Tailscale (no painel, **Users → Invite**) e,
  no prumia, receber um convite (ver [convidar-pessoas.md](convidar-pessoas.md)).
- **Quero desligar o acesso pelo celular**: no computador, rode `scripts/tailscale-serve.sh off`.

O prumia **não** fica visível na internet: só aparelhos conectados à sua conta do Tailscale enxergam o endereço.
