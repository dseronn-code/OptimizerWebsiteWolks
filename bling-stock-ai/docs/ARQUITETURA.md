# Arquitetura

```
┌────────────────────┐   HTTPS (cookie HttpOnly)   ┌──────────────────────────────────────────────┐
│ Web (React + TS +  │ ──────────────────────────► │ API Fastify (Node + TS)                       │
│ Tailwind) — chat,  │                             │  auth/        sessões, perfis, bloqueio       │
│ produto, reservas, │                             │  routes/      controle de acesso no backend   │
│ painel, admin      │                             │  ai/          agente + ferramentas (leitura)  │
└────────────────────┘                             │  engine/      MOTOR DETERMINÍSTICO (puro)      │
                                                   │  stock/       carrega dados → motor            │
        Bling API v3  ◄── OAuth, leitura ───────── │  bling/       cliente HTTP, OAuth, simulador   │
        Webhooks ──────── POST assinado ─────────► │  sync/        fila, agendador, webhooks        │
                                                   │  reservations/ alerts/ audit/                  │
                                                   └───────────────┬──────────────────────────────┘
                                                                   │
                                                          PostgreSQL (espelho + controles)
```

## Camadas (separação pedida no escopo)

| # | Camada | Onde | Responsabilidade |
|---|---|---|---|
| 1 | Interface | `web/` | Chat, busca, cartões, visão por depósito, painel, administração. Responsiva. |
| 2 | Autenticação | `server/src/auth` | bcrypt (custo 12), sessão opaca em cookie HttpOnly/SameSite, expiração deslizante, bloqueio após 5 falhas, perfis vendedor/gestor/admin verificados no backend. |
| 3 | Integração Bling | `server/src/bling` | OAuth 2.0 com tokens cifrados, renovação serializada, limitador de taxa, re-tentativas. `FakeBlingClient` reproduz a API para demo/testes. |
| 4 | Sincronização e armazenamento | `server/src/sync`, `db/migrations` | Carga completa e incremental, reconciliação de pedidos ativos, webhooks idempotentes, fila em PostgreSQL (`FOR UPDATE SKIP LOCKED`), registro de execuções e erros. |
| 5 | Motor de regras | `server/src/engine` | Função pura `calculateAvailability(snapshot)`. Sem I/O, 100% testável. |
| 6 | Reservas | `server/src/reservations` | Solicitação, aprovação, validade, renovação, vínculo com pedido, conversão, histórico. Transação + *advisory lock* por produto. |
| 7 | Ferramentas da IA | `server/src/ai/tools.ts` | 11 consultas somente-leitura executadas com o perfil do usuário. |
| 8 | Auditoria e monitoramento | `server/src/audit`, `alerts` | `audit_log`, `sync_runs`, `webhook_events`, `jobs`, alertas automáticos. |

## O motor de disponibilidade

```
disponível = Σ saldo-base dos depósitos que compõem a disponibilidade
           − compromissos que o saldo-base AINDA NÃO reflete
```

Cada linha (item de pedido, reserva, bloqueio) recebe exatamente um tratamento:

| Tratamento | Quando | Efeito |
|---|---|---|
| `ALREADY_IN_BASE` | baixa já efetuada (físico) ou já descontado no virtual (base virtual) | não subtrai de novo |
| `SUBTRACTED` | compromisso válido ainda não refletido; entrega parcial sem baixa; bloqueio | subtrai a quantidade pendente |
| `SUPERSEDED` | reserva local vinculada a pedido do Bling já sincronizado | contada uma única vez, pelo pedido |
| `NOT_COUNTED` | cotação sem reserva, cancelado, reserva pendente/encerrada | não reduz |

Classificação comercial por situação (configurável): `COMMITTED`, `PRE_ORDER_RESERVED`, `OPPORTUNITY`,
`CANCELLED`, `FULFILLED`, `IGNORED`; situação sem regra → `UNMAPPED` (desconta por precaução).

A disponibilidade fica **NÃO CONFIRMADA** quando: falta saldo, saldo desatualizado, falha de
sincronização (ou pedidos sem sincronizar há mais que o limite), situação sem regra, efeito de
estoque desconhecido, possível duplicidade, saldo negativo ou compromissos acima do saldo.
Nessas condições a verificação de venda responde "não confirmado" em vez de "sim".

### Consultas críticas
`verificar_venda`/"Verificar venda" atualiza o saldo do produto (e componentes de kit) na API do
Bling quando ele é mais antigo que `criticalRefreshMinutes`. Se a atualização falhar, a resposta
sai como não confirmada.

## Concorrência
- Reservas: `pg_advisory_xact_lock(produto)` + recálculo dentro da transação → dois vendedores
  disputando o último saldo são serializados (teste `11`).
- Pedidos: `SELECT … FOR UPDATE` + `last_event_at` impede que um estado antigo sobrescreva um novo (teste `13`).
- Tokens: renovação do refresh token sob *advisory lock* (o refresh token do Bling é rotativo).
- Jobs: `FOR UPDATE SKIP LOCKED`, deduplicação de pendentes e recuperação de jobs presos.

## IA
- Com `ANTHROPIC_API_KEY`: o modelo (`AI_MODEL`, padrão `claude-opus-5-5`) recebe as ferramentas e um
  *prompt* que proíbe inventar números; o laço de ferramentas tem no máximo 6 iterações e o
  *fallback* de servidor (`fallbacks: "default"`) para recusas está habilitado.
- Sem chave (ou se a chamada falhar): o **interpretador local** reconhece as perguntas frequentes
  e usa as mesmas ferramentas — o sistema continua utilizável.
- Nenhuma ferramenta escreve no Bling; o chat não cria nem altera reservas.

## Segurança
- Tokens do Bling só no servidor, cifrados em repouso; segredos via variáveis de ambiente.
- Controle de acesso em todas as rotas no backend; vendedores não veem nomes de clientes de outros vendedores (configurável).
- Cookie HttpOnly + SameSite=Lax + `Secure` em produção; cabeçalho obrigatório `x-requested-with` em requisições que alteram estado (anti-CSRF).
- Helmet (CSP restritiva), limite de requisições global e específico para login/chat.
- Webhooks exigem assinatura HMAC válida (comparação em tempo constante).
- Auditoria de login, alterações de configuração, regras, reservas, bloqueios, ajustes de pedidos e conexão Bling.
