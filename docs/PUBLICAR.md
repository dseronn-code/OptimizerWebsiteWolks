# Publicar o sistema (dá para fazer pelo celular)

## Opção A — Railway (recomendado: não "dorme" e o banco fica junto)

Custo: teste grátis com crédito inicial; depois, plano Hobby (~US$ 5/mês, que já inclui US$ 5 de uso —
um sistema deste porte costuma caber nesse valor). Confira em railway.com/pricing.

1. Acesse **railway.com** → *Login* com a conta **GitHub**.
2. **New Project** → **Deploy from GitHub repo** → escolha `optimizerwebsitewolks`.
3. Abra o serviço criado → **Settings**:
   - **Source › Branch**: `claude/great-gates-t0hp3w` (ou `main`, depois de juntar o código);
   - **Source › Root Directory**: deixe vazio (o sistema está na raiz do repositório);
   - **Networking › Generate Domain** (cria o endereço público).
4. No projeto: **+ Create** (ou *New*) → **Database** → **PostgreSQL**.
5. No serviço do app → **Variables** → adicione:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (o Railway sugere ao digitar) |
   | `NODE_ENV` | `production` |
   | `TOKEN_ENCRYPTION_KEY` | uma frase secreta qualquer com **32 ou mais caracteres** (guarde-a) |
   | `BOOTSTRAP_ADMIN_USERNAME` | `admin` |
   | `BOOTSTRAP_ADMIN_PASSWORD` | sua senha (mín. 10 caracteres, letras e números) |
   | `SEED_DEMO_IF_EMPTY` | `true` (dados fictícios para conhecer o app; depois mude para `false`) |
   | `AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` (opcional) |
   | `AI_MODEL` | `gemini-flash-lite-latest` (opcional) |
   | `AI_API_KEY` | chave do Google Gemini (opcional) |

6. **Deploy**. Quando ficar verde, abra o endereço gerado e entre com `admin` + sua senha.

O arquivo `railway.json` já define build, início e verificação de saúde.

---

## Opção B — Render + Neon (gratuito)

Hospedagem: **Render** (servidor, plano gratuito) + **Neon** (banco PostgreSQL, plano gratuito).

> Limitação do plano gratuito do Render: depois de 15 minutos sem uso o servidor "dorme" e o
> primeiro acesso seguinte demora cerca de 1 minuto. Enquanto dorme, a sincronização com o Bling
> fica parada (ela volta ao acordar). Para uso diário da equipe, o plano pago mais simples resolve.

## 1. Banco de dados (Neon)
1. Acesse **neon.tech** → *Sign up* (pode entrar com a conta Google ou GitHub).
2. Crie um projeto (região: São Paulo, se houver; senão a mais próxima).
3. Em *Connection string*, copie o endereço que começa com `postgresql://…` (deve terminar com `sslmode=require`).

## 2. Servidor (Render)
1. Acesse **render.com** → *Sign up* com a conta **GitHub** (a mesma do repositório).
2. *New* → **Blueprint** → escolha o repositório `optimizerwebsitewolks` e o branch com o código.
3. O Render lê o arquivo `render.yaml` e pede:
   - `DATABASE_URL` → cole o endereço do Neon;
   - `BOOTSTRAP_ADMIN_PASSWORD` → crie uma senha forte (mín. 10 caracteres, letras e números);
   - `AI_API_KEY` → chave do Google Gemini (opcional; sem ela o chat usa o interpretador local).
4. *Apply* e aguarde o build (alguns minutos).
5. O endereço fica como `https://itcomtech-estoque.onrender.com` (ou parecido).

## 3. Primeiro acesso
- Usuário `admin` + a senha escolhida. Os usuários da demonstração (`gestor`, `ana`, `bruno`) usam a mesma senha.
- A faixa amarela indica dados fictícios. Para usar o Bling real: *Administração › Integração Bling*.
- Depois de configurar a empresa de verdade, mude `SEED_DEMO_IF_EMPTY` para `false` no Render.

## 4. Instalar no celular
- **Android (Chrome):** abra o endereço → ⋮ → **Instalar app**.
- **iPhone (Safari):** abra o endereço → Compartilhar → **Adicionar à Tela de Início**.

### APK (opcional)
Com o sistema publicado, o site **pwabuilder.com** gera um pacote Android (APK/AAB) a partir do
endereço, sem programar. Na prática ele abre o mesmo sistema; a instalação pelo Chrome já tem o mesmo efeito.

---

## "Criar conta" com código por e-mail (Brevo, gratuito)

O Railway bloqueia envio de e-mail por SMTP fora do plano Pro, por isso o sistema envia pela API do Brevo
(grátis até 300 e-mails por dia).

1. Crie a conta em **brevo.com** (plano Free).
2. **Senders, Domains & Dedicated IPs › Senders › Add a sender**: cadastre o e-mail remetente
   (ex.: o e-mail da empresa) e confirme pelo link que o Brevo envia para ele.
3. **SMTP & API › API Keys › Generate a new API key** e copie a chave (começa com `xkeysib-`).
4. No Railway, em **Variables**, adicione:

   | Variável | Valor |
   |---|---|
   | `EMAIL_PROVIDER` | `brevo` |
   | `EMAIL_FROM` | o e-mail remetente confirmado no passo 2 |
   | `EMAIL_FROM_NAME` | `ITCOMTECH Estoque` |
   | `BREVO_API_KEY` | a chave do passo 3 |

5. Deploy. O link **"Criar conta"** aparece na tela de login.

Regras (em *Administração › Parâmetros*): cadastro ligado/desligado, aprovação obrigatória do administrador
(padrão: ligada) e domínios de e-mail permitidos (ex.: `itcomtech.com.br`). Cadastros pendentes aparecem em
*Administração › Usuários* e como alerta.

### Alternativa sem telefone: enviar pelo próprio Gmail (Google Apps Script, gratuito)

Limite: ~100 e-mails por dia (conta Gmail comum). Os e-mails saem do seu Gmail, o que ajuda a não cair no spam.

1. Acesse **script.google.com** (no celular, use o Chrome em *Versão para computador*) → **Novo projeto**.
2. Apague o conteúdo e cole o código de `docs/gmail-apps-script.gs`.
3. Troque `TROQUE-POR-UMA-SENHA-LONGA` por uma senha longa só sua e salve (ícone de disquete).
4. **Implantar › Nova implantação** → engrenagem → **App da Web** →
   *Executar como*: **Eu** · *Quem pode acessar*: **Qualquer pessoa** → **Implantar**.
5. Autorize (**Avançado › Acessar projeto (não seguro)** é normal para scripts próprios) e copie a **URL do app da Web** (termina em `/exec`).
6. No Railway, em **Variables**:

   | Variável | Valor |
   |---|---|
   | `EMAIL_PROVIDER` | `gmail_script` |
   | `GMAIL_SCRIPT_URL` | a URL do passo 5 |
   | `GMAIL_SCRIPT_SECRET` | a mesma senha do passo 3 |
   | `EMAIL_FROM_NAME` | `ITCOMTECH Estoque` |
