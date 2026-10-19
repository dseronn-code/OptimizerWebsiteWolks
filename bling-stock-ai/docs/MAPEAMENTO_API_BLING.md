# Mapeamento da API Bling v3

> **Fonte e grau de confirmação.** O portal oficial (developer.bling.com.br) não pôde ser acessado
> a partir do ambiente de desenvolvimento. Os endpoints e campos abaixo foram conferidos na
> tipagem do SDK `bling-erp-api-js` (gerada a partir da especificação pública da API v3) e no SDK
> PHP `prhost/bling-v3-sdk`. Itens marcados com **⚠ confirmar** devem ser validados na
> documentação oficial antes de ir para produção. Nenhum endpoint foi inventado: onde a API não
> oferece o dado, o sistema usa um **controle complementar** e isso está indicado.

Base da API: `https://api.bling.com.br/Api/v3` · OAuth: `https://www.bling.com.br/Api/v3/oauth/*`

## 1. Autenticação (OAuth 2.0 — authorization code)

| Etapa | Chamada | Uso no sistema |
|---|---|---|
| Autorização | `GET /oauth/authorize?response_type=code&client_id=…&state=…` | `bling/oauth.ts → createAuthorizationUrl` (state aleatório, válido por 15 min) |
| Troca do código | `POST /oauth/token` (`grant_type=authorization_code`, Basic `client_id:client_secret`, form-urlencoded) | `handleOAuthCallback` |
| Renovação | `POST /oauth/token` (`grant_type=refresh_token`) | `dbTokenProvider` — serializada com *advisory lock*; renova 5 min antes de expirar e também após um `401` |

Tokens ficam cifrados (AES-256-GCM, chave `TOKEN_ENCRYPTION_KEY`) na tabela `bling_connection`.
Nunca são enviados ao navegador.

## 2. Recursos lidos (Fase 1 é somente leitura)

| Dado | Endpoint | Campos usados | Tabela local |
|---|---|---|---|
| Produtos e SKUs | `GET /produtos?pagina&limite&criterio=5&dataAlteracaoInicial` | `id, idProdutoPai, nome, codigo, situacao, formato` | `products` |
| Detalhe / kits | `GET /produtos/{id}` | `unidade, gtin, estrutura.componentes[{produto.id, quantidade}]`, `variacoes` | `products`, `product_components` |
| Depósitos | `GET /depositos?pagina&limite` | `id, descricao, padrao, desconsiderarSaldo, situacao` | `deposits` |
| Saldos físico e virtual | `GET /estoques/saldos?idsProdutos[]=…` | `produto.id, saldoFisicoTotal, saldoVirtualTotal, depositos[{id, saldoFisico, saldoVirtual}]` | `stock_balances` |
| Pedidos de venda (lista) | `GET /pedidos/vendas?pagina&limite&dataAlteracaoInicial&idsSituacoes[]` | `id, numero, data, situacao.id` | — |
| Pedido de venda (detalhe) | `GET /pedidos/vendas/{id}` | `numero, data, dataPrevista, dataSaida, contato{id,nome}, vendedor.id, loja.id, situacao.id, itens[{id, codigo, quantidade, unidade, produto.id}]` | `sales_orders`, `sales_order_items` |
| Situações | `GET /situacoes/modulos` e `GET /situacoes/modulos/{idModulo}` | `id, nome, idHerdado` | `situations` |
| Entradas previstas | `GET /pedidos/compras?valorSituacao=0|3` e `GET /pedidos/compras/{id}` | `numero, data, dataPrevista, fornecedor, situacao.valor (0 aberto, 1 atendido, 2 cancelado, 3 em andamento), itens[{produto.id, quantidade}]` | `purchase_orders`, `purchase_order_items` |

Paginação: `limite=100`, avançando `pagina` até vir menos de 100 registros.
Limites de requisição: o cliente HTTP espaça as chamadas (`BLING_REQUESTS_PER_SECOND`, padrão 3/s),
respeita `Retry-After` em `429` e re-tenta `5xx`/falhas de rede com recuo exponencial. **⚠ confirmar**
os limites vigentes da conta (por segundo e diários) e ajustar a variável.

## 3. Webhooks

| Item | Implementação |
|---|---|
| Endpoint | `POST /api/webhooks/bling` |
| Assinatura | HMAC-SHA256 do corpo bruto com o *client secret*, cabeçalho configurável (`BLING_WEBHOOK_SIGNATURE_HEADER`, padrão `x-bling-signature-256`, aceita prefixo `sha256=`) **⚠ confirmar nome do cabeçalho** |
| Formato esperado | `{ eventId, date, event: "<recurso>.<ação>", data: { id … } }` **⚠ confirmar** — a extração é defensiva (`order*/pedido*`, `product*/produto*`, `stock*/estoque*`) |
| Tratamento | O webhook é só um **aviso**: o evento é gravado (idempotente por `eventId`), eventos mais antigos que o estado já aplicado são ignorados e o recurso é **consultado novamente na API** (fonte da verdade). |

Mesmo com webhooks, a sincronização incremental (padrão a cada 10 min) e a reconciliação (padrão a cada 60 min)
continuam rodando — o sistema não presume que webhooks sejam suficientes.

## 4. O que vem do Bling × o que é controle complementar

| Informação necessária | Origem | Observação |
|---|---|---|
| Estoque físico e virtual por depósito | **Bling** (`/estoques/saldos`) | Base do cálculo |
| Itens, quantidades, cliente, vendedor, situação do pedido | **Bling** (`/pedidos/vendas/{id}`) | |
| Situações personalizadas e herança | **Bling** (`/situacoes/modulos/{id}`) | |
| Composição de kits | **Bling** (`/produtos/{id}` → `estrutura`) | Pedidos do kit são desdobrados nos componentes |
| Entradas previstas | **Bling** (`/pedidos/compras`) | Nunca somam ao disponível |
| **Se o estoque do pedido já foi baixado** | **Complementar** | O pedido de venda v3 não informa se houve lançamento de estoque. Regra por situação (`situation_rules.stock_effect`) + ajuste por pedido (`order_overrides`). Sem regra → "desconhecido" → desconta por precaução e marca *não confirmada*. |
| **Se o saldo virtual já desconta o pedido** | **Complementar** | Depende da configuração da conta; regra por situação (`virtual_effect`). |
| **Depósito do pedido** | **Complementar** | O pedido v3 não traz depósito; atribuído ao depósito padrão na visão por depósito (o total não muda) ou definido em `order_overrides.deposit_id`. |
| **Entregas parciais e liberações** | **Complementar** | `item_fulfillments` (entregue, liberado, se a entrega já foi baixada). |
| **Reservas de negociação** | **Complementar** | Módulo `reservations` (o Bling v3 não expõe reservas avulsas). |
| **Bloqueios operacionais** (avaria, conferência, entrada não recebida) | **Complementar** | `stock_blocks`. |
| **Movimentações de estoque (extrato)** | ⚠ **Não utilizado** | Não foi identificado endpoint de listagem de movimentações na v3; a detecção de baixa usa as regras acima. Se a conta tiver acesso a um endpoint de movimentações, ele pode alimentar `stock_effect` automaticamente (Fase 3). |

## 5. Escrita no Bling

Nenhuma. A Fase 1 é exclusivamente de leitura. Os endpoints de escrita existentes
(ex.: `POST /pedidos/vendas/{id}/lancar-estoque`, `PATCH /pedidos/vendas/{id}/situacoes/{idSituacao}`)
**não são chamados** e só poderão ser considerados na Fase 3, após validação técnica e aprovação.
