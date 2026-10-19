# Status da entrega — Fase 1

## Implementado

| Item do escopo | Situação | Onde |
|---|---|---|
| Aplicação web responsiva | ✅ | `web/` — desktop com menu lateral, celular com menu recolhível |
| Login individual, perfis vendedor/gestor/admin | ✅ | `server/src/auth`, verificação em todas as rotas |
| Configuração da conexão Bling (OAuth 2.0) | ✅ código pronto, **⏳ depende das credenciais do app Bling** | Administração › Integração Bling |
| Sincronização de produtos, kits, depósitos, saldos | ✅ | `sync/syncService.ts` |
| Sincronização de pedidos de venda e de compra | ✅ incremental + reconciliação | idem |
| Webhooks (idempotentes, assinatura HMAC, fora de ordem) | ✅ **⚠ formato/cabeçalho a confirmar** | `sync/webhooks.ts` |
| Fila com re-tentativas, limites de requisição, registro de erros | ✅ | `sync/jobs.ts`, `bling/httpClient.ts` |
| Interpretação dos compromissos (máquina de estados configurável) | ✅ | Regras de situação + ajustes por pedido |
| Cálculo confiável de disponibilidade, sem dupla contagem | ✅ | `engine/availability.ts` |
| "Não confirmada" quando faltam dados | ✅ | idem |
| Chat com IA + ferramentas determinísticas | ✅ **⏳ modelo de linguagem depende de `ANTHROPIC_API_KEY`**; sem ela, interpretador local | `ai/` |
| Explicação detalhada dos saldos | ✅ | página do produto + chat |
| Registro de sincronização | ✅ | Administração › Sincronização |
| Testes automatizados das regras críticas | ✅ 36 testes | `server/test` |
| Ambiente de demonstração identificado | ✅ | `npm run seed:demo`, faixa amarela, sufixo `[DEMO]` |

Adiantado da Fase 2 (necessário para testes de concorrência e para o painel): solicitação,
aprovação, validade, renovação, cancelamento, liberação, vínculo e conversão em pedido de reservas,
controle de concorrência, painel de compromissos e alertas operacionais.

## Testes — cenários obrigatórios

| # | Cenário | Teste |
|---|---|---|
| 1 | Produto disponível sem reservas | `engine.test.ts › 1.` |
| 2 | Pedido pago ainda não baixado | `engine.test.ts › 2.` e integração "pedido confirmado sincronizado…" |
| 3 | Reserva já refletida no saldo virtual | `engine.test.ts › 3.` |
| 4 | Pedido com baixa efetuada e reserva encerrada | `engine.test.ts › 4.` e integração (atendido não desconta 2×) |
| 5 | Possível reserva duplicada | `engine.test.ts › 5a/5b/5c`, integração "reserva vinculada…" |
| 6 | Pré-pedido com reserva autorizada | `engine.test.ts › 6.` |
| 7 | Cotação sem reserva | `engine.test.ts › 7.` |
| 8 | Pedido cancelado | `engine.test.ts › 8.` |
| 9 | Pedido parcialmente atendido | `engine.test.ts › 9.` |
| 10 | Entrada ainda não recebida | `engine.test.ts › 10.` |
| 11 | Dois vendedores e o último saldo | `integration.test.ts › 11.` e `11b.` (PostgreSQL real, chamadas simultâneas) |
| 12 | Falha de sincronização | `engine.test.ts › 12.`, `integration.test.ts › 12.` e re-tentativa de jobs |
| 13 | Situação fora de ordem | `integration.test.ts › 13.` e `13b.` (webhooks) |
| 14 | Mais de um depósito | `engine.test.ts › 14.`, `integration.test.ts › 14.` |
| 15 | Saldo divergente ou negativo | `engine.test.ts › 15.` |

Resultado da última execução: **36/36 aprovados** (`npm test`).

## Limitações conhecidas e decisões conservadoras

1. **Baixa de estoque por pedido não vem da API.** O pedido de venda v3 não indica se o estoque foi
   lançado. O sistema usa a regra configurada por situação (+ ajuste manual por pedido). Situação sem
   regra ⇒ desconta e marca "não confirmada".
2. **Depósito do pedido não vem da API.** O total é exato; na visão por depósito, o compromisso é
   atribuído ao depósito padrão (sinalizado como "presumido") ou ao depósito definido manualmente.
3. **Webhooks:** nome do cabeçalho de assinatura e formato do evento implementados conforme a
   documentação pública conhecida, com extração defensiva — validar com um evento real. Como o
   webhook só dispara uma nova consulta à API, divergências de formato não comprometem os dados.
4. **Limites de requisição:** padrão de 3 req/s; ajustar `BLING_REQUESTS_PER_SECOND` ao plano da conta.
   A sincronização de pedidos consulta o detalhe de cada pedido alterado (a listagem não traz itens).
5. **Reserva vinculada com quantidade maior que o pedido:** o pedido do Bling passa a governar; o excedente
   da reserva deixa de contar (documentado na linha de explicação).
6. **Reserva vencida:** por padrão é mantida no cálculo até o gestor renovar ou liberar (configurável).
7. **Kits:** disponibilidade = mínimo de kits montáveis com o disponível dos componentes; pedidos do kit
   são desdobrados nos componentes.
8. **Movimentações de estoque:** não há uso de extrato de movimentações (não identificado endpoint de
   listagem na v3). Pode alimentar a detecção automática de baixa na Fase 3.

## Próximos passos sugeridos
- Conectar a conta real do Bling, cadastrar as regras de situação e validar com 5–10 produtos conhecidos.
- Confirmar formato do webhook com um evento real (tela Sincronização › Webhooks recebidos).
- Fase 3: detecção automática de baixa, análise de causas de divergência, histórico/previsão de
  disponibilidade, notificações externas.
