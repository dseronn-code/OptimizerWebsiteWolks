-- Bling Stock AI — esquema inicial
-- Convenção: tabelas espelho do Bling usam o id do Bling como chave primária (bigint)
-- e a coluna `source` ('bling' | 'demo') identifica a origem do dado.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- usuários / sessões
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text NOT NULL UNIQUE,
  name            text NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL CHECK (role IN ('vendedor', 'gestor', 'admin')),
  bling_seller_id bigint,
  active          boolean NOT NULL DEFAULT true,
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------- integração Bling
CREATE TABLE bling_connection (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token_enc   text,
  refresh_token_enc  text,
  access_expires_at  timestamptz,
  scope              text,
  status             text NOT NULL DEFAULT 'disconnected',
  oauth_state        text,
  oauth_state_at     timestamptz,
  connected_at       timestamptz,
  last_refresh_at    timestamptz,
  last_error         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bling_connection (id) VALUES (1);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- ---------------------------------------------------------------- espelho Bling
CREATE TABLE deposits (
  id             bigint PRIMARY KEY,
  name           text NOT NULL,
  is_default     boolean NOT NULL DEFAULT false,
  ignore_balance boolean NOT NULL DEFAULT false, -- "desconsiderarSaldo" no Bling
  active         boolean NOT NULL DEFAULT true,
  source         text NOT NULL DEFAULT 'bling',
  synced_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint PRIMARY KEY,
  parent_id   bigint,
  sku         text,
  name        text NOT NULL,
  gtin        text,
  unit        text,
  format      text NOT NULL DEFAULT 'S', -- S simples, V com variações, E com composição (kit)
  active      boolean NOT NULL DEFAULT true,
  search_text text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT 'bling',
  synced_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_sku_idx ON products(lower(sku));

CREATE TABLE product_components (
  product_id   bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id bigint NOT NULL,
  quantity     numeric(18,4) NOT NULL,
  PRIMARY KEY (product_id, component_id)
);

CREATE TABLE stock_balances (
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  deposit_id  bigint NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  physical    numeric(18,4) NOT NULL,
  virtual     numeric(18,4),
  fetched_at  timestamptz NOT NULL,
  source      text NOT NULL DEFAULT 'bling',
  PRIMARY KEY (product_id, deposit_id)
);

CREATE TABLE situations (
  id          bigint PRIMARY KEY,
  module_id   bigint,
  name        text NOT NULL,
  inherited_id bigint,
  source      text NOT NULL DEFAULT 'bling',
  synced_at   timestamptz NOT NULL DEFAULT now()
);

-- Regra comercial configurável por situação de pedido de venda.
-- category: o que o pedido representa comercialmente
-- stock_effect: se o estoque FÍSICO registrado no Bling já reflete a saída
-- virtual_effect: se o saldo VIRTUAL do Bling já desconta o pedido
CREATE TABLE situation_rules (
  situation_id   bigint PRIMARY KEY,
  category       text NOT NULL CHECK (category IN
                   ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'CANCELLED', 'FULFILLED', 'IGNORED')),
  stock_effect   text NOT NULL CHECK (stock_effect IN ('NOT_POSTED', 'POSTED', 'UNKNOWN')),
  virtual_effect text NOT NULL CHECK (virtual_effect IN ('REFLECTED', 'NOT_REFLECTED', 'UNKNOWN')),
  label          text,
  notes          text,
  updated_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_orders (
  id             bigint PRIMARY KEY,
  number         bigint,
  order_date     date,
  expected_date  date,
  ship_date      date,
  situation_id   bigint,
  customer_id    bigint,
  customer_name  text,
  seller_id      bigint,
  store_id       bigint,
  total          numeric(18,2),
  deleted        boolean NOT NULL DEFAULT false,
  last_event_at  timestamptz,           -- data do último evento/consulta aplicado (proteção fora de ordem)
  synced_at      timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL DEFAULT 'bling',
  raw            jsonb
);
CREATE INDEX sales_orders_situation_idx ON sales_orders(situation_id);
CREATE INDEX sales_orders_customer_idx ON sales_orders(lower(customer_name));

CREATE TABLE sales_order_items (
  id          bigint PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id  bigint,
  sku         text,
  description text,
  quantity    numeric(18,4) NOT NULL,
  unit        text
);
CREATE INDEX sales_order_items_product_idx ON sales_order_items(product_id);
CREATE INDEX sales_order_items_order_idx ON sales_order_items(order_id);

-- Histórico de situações observadas (permite detectar cancelamento após baixa etc.)
CREATE TABLE sales_order_situation_history (
  id            bigserial PRIMARY KEY,
  order_id      bigint NOT NULL,
  situation_id  bigint,
  observed_at   timestamptz NOT NULL DEFAULT now(),
  origin        text NOT NULL
);
CREATE INDEX so_sit_hist_order_idx ON sales_order_situation_history(order_id);

-- Controles complementares por pedido (não existem no Bling v3)
CREATE TABLE order_overrides (
  order_id       bigint PRIMARY KEY,
  stock_effect   text CHECK (stock_effect IN ('NOT_POSTED', 'POSTED', 'UNKNOWN')),
  deposit_id     bigint,
  notes          text,
  updated_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE item_fulfillments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id          bigint NOT NULL,
  quantity_delivered     numeric(18,4) NOT NULL DEFAULT 0,
  quantity_released      numeric(18,4) NOT NULL DEFAULT 0,
  delivered_stock_posted boolean NOT NULL DEFAULT false,
  notes                  text,
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_fulfillments_item_idx ON item_fulfillments(order_item_id);

CREATE TABLE purchase_orders (
  id              bigint PRIMARY KEY,
  number          bigint,
  order_date      date,
  expected_date   date,
  situation_value smallint, -- 0 em aberto, 1 atendido, 2 cancelado, 3 em andamento
  supplier_id     bigint,
  supplier_name   text,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'bling'
);

CREATE TABLE purchase_order_items (
  purchase_order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no           integer NOT NULL,
  product_id        bigint,
  sku               text,
  description       text,
  quantity          numeric(18,4) NOT NULL,
  PRIMARY KEY (purchase_order_id, line_no)
);
CREATE INDEX purchase_order_items_product_idx ON purchase_order_items(product_id);

-- ---------------------------------------------------------------- módulo complementar
CREATE TABLE reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       bigint NOT NULL REFERENCES products(id),
  deposit_id       bigint REFERENCES deposits(id),
  quantity         numeric(18,4) NOT NULL CHECK (quantity > 0),
  customer_name    text,
  customer_id      bigint,
  negotiation_ref  text,
  bling_order_id   bigint,
  seller_user_id   uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL CHECK (status IN
                     ('PENDING', 'ACTIVE', 'EXPIRED', 'REJECTED', 'CANCELLED', 'RELEASED', 'CONVERTED')),
  reason           text NOT NULL,
  expires_at       timestamptz NOT NULL,
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamptz,
  source           text NOT NULL DEFAULT 'live',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_product_idx ON reservations(product_id, status);

CREATE TABLE reservation_history (
  id             bigserial PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  action         text NOT NULL,
  from_status    text,
  to_status      text,
  user_id        uuid REFERENCES users(id),
  details        jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  bigint NOT NULL REFERENCES products(id),
  deposit_id  bigint REFERENCES deposits(id),
  quantity    numeric(18,4) NOT NULL CHECK (quantity > 0),
  reason_type text NOT NULL CHECK (reason_type IN ('AVARIA', 'CONFERENCIA', 'ENTRADA_NAO_RECEBIDA', 'DECISAO_OPERACIONAL')),
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  source      text NOT NULL DEFAULT 'live',
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES users(id)
);

-- ---------------------------------------------------------------- sincronização
CREATE TABLE webhook_events (
  event_id     text PRIMARY KEY,
  resource     text,
  action       text,
  resource_id  bigint,
  event_date   timestamptz,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status       text NOT NULL DEFAULT 'received', -- received | processed | ignored | failed
  note         text,
  payload      jsonb
);

CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  dedupe_key   text,
  status       text NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 6,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs(status, run_at);
CREATE UNIQUE INDEX jobs_dedupe_pending_idx ON jobs(dedupe_key) WHERE status IN ('pending', 'running') AND dedupe_key IS NOT NULL;

CREATE TABLE sync_runs (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running', -- running | success | error
  items        integer NOT NULL DEFAULT 0,
  error        text,
  triggered_by text
);
CREATE INDEX sync_runs_kind_idx ON sync_runs(kind, started_at DESC);

CREATE TABLE sync_state (
  resource        text PRIMARY KEY,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  cursor          jsonb
);

-- ---------------------------------------------------------------- alertas / auditoria / histórico
CREATE TABLE alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  dedupe_key     text NOT NULL UNIQUE,
  product_id     bigint,
  order_id       bigint,
  reservation_id uuid,
  user_id        uuid,
  message        text NOT NULL,
  details        jsonb,
  status         text NOT NULL DEFAULT 'open', -- open | acknowledged | resolved
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX alerts_status_idx ON alerts(status, severity);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  user_id   uuid,
  action    text NOT NULL,
  entity    text,
  entity_id text,
  details   jsonb,
  ip        text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);

CREATE TABLE query_history (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question    text NOT NULL,
  answer      text NOT NULL,
  tools       jsonb,
  engine      text NOT NULL, -- 'llm' | 'local'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX query_history_user_idx ON query_history(user_id, created_at DESC);
