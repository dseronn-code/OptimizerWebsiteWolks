# Bling Stock AI

Assistente de estoque para a equipe comercial: responde, em linguagem natural, **quanto de cada
produto pode realmente ser vendido agora**, descontando do saldo do Bling apenas os compromissos
que ainda não foram baixados — sem contar o mesmo compromisso duas vezes.

> **Status: Fase 1 (MVP) implementada**, somente leitura em relação ao Bling, mais o núcleo do
> módulo de reservas (Fase 2) necessário para os testes de concorrência. Ver
> [docs/STATUS.md](docs/STATUS.md) para o que foi implementado, testado e o que depende de configuração.

## Como funciona em uma frase
`disponível = saldo-base do Bling − (pedidos pagos/confirmados não baixados + pré-pedidos com reserva + reservas complementares + bloqueios)`,
onde cada compromisso é classificado uma única vez (já baixado → não subtrai; reserva vinculada a pedido → conta pelo pedido).
Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Estrutura
```
bling-stock-ai/
├── server/   API Node.js + TypeScript (Fastify, PostgreSQL)
│   ├── src/engine/      motor de disponibilidade (função pura)
│   ├── src/bling/       OAuth, cliente HTTP, simulador da API
│   ├── src/sync/        sincronização, fila de jobs, webhooks
│   ├── src/ai/          agente de IA + ferramentas + interpretador local
│   └── test/            testes do motor e de integração
├── web/      React + TypeScript + Tailwind
└── docs/     mapeamento da API Bling, arquitetura, status
```

## Rodar localmente (demonstração com dados fictícios)
Requisitos: Node 20+ e PostgreSQL 14+.

```bash
cd bling-stock-ai
npm run install:all
cp .env.example server/.env        # ajuste DATABASE_URL; para desenvolvimento use NODE_ENV=development
npm run seed:demo                  # cria tabelas, usuários de demonstração e dados fictícios
npm run dev:server                 # API em http://localhost:3001
npm run dev:web                    # interface em http://localhost:5173
```

Usuários da demonstração (apenas no banco de demonstração):

| Usuário | Senha | Perfil |
|---|---|---|
| `admin` | `DemoAdmin2026` | Administrador |
| `gestor` | `DemoGestor2026` | Gestor |
| `ana`, `bruno` | `DemoVendas2026` | Vendedor |

A interface exibe a faixa **"AMBIENTE DE DEMONSTRAÇÃO"** e todos os produtos fictícios terminam com `[DEMO]`.

## Testes
```bash
createdb blingstock_test                       # banco exclusivo de testes (é recriado a cada execução)
npm test                                       # ou TEST_DATABASE_URL=postgres://… npm test
```
36 testes: os 15 cenários obrigatórios, prevenção de dupla contagem, concorrência, falha de
sincronização, eventos fora de ordem, idempotência de webhooks, autenticação, perfis e privacidade.

## Produção (conectar ao Bling real)
1. Cadastre um aplicativo no Bling (área do desenvolvedor) com a URL de redirecionamento
   `https://SEU_DOMINIO/api/bling/callback`, os escopos de leitura de produtos, estoques, depósitos,
   pedidos de venda, pedidos de compra e situações, e (opcional) o webhook `https://SEU_DOMINIO/api/webhooks/bling`.
2. Defina as variáveis do `.env.example` no ambiente do servidor (cofre de segredos), incluindo
   `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI`.
3. `npm run build && npm run migrate && npm run create-admin` e inicie com `npm start` (ou `docker compose up`).
4. Entre como administrador → **Administração › Integração Bling** → *Usar Bling real* → *Conectar ao Bling*.
5. Em **Regras de situação**, defina para cada situação do Bling o significado comercial e se o estoque já foi baixado.
   Até isso ser feito, pedidos nessas situações são descontados por precaução e a disponibilidade aparece como não confirmada.
6. (Opcional) defina `ANTHROPIC_API_KEY` para respostas com modelo de linguagem; sem ela, o interpretador local responde.

> As credenciais do Bling **nunca** devem ser enviadas por chat, e-mail ou commit. Configure-as diretamente no servidor.
