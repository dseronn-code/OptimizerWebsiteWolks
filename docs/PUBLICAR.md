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
