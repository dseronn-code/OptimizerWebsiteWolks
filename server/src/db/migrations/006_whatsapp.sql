-- Bot de WhatsApp: o número de telefone é o "login" do colaborador.

-- Número no formato internacional, só dígitos (ex.: 5511987654321). Único: um número = um usuário.
ALTER TABLE users ADD COLUMN whatsapp_phone text;
CREATE UNIQUE INDEX users_whatsapp_phone_idx ON users(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;

-- Estado da conversa de cada colaborador (fluxos de reserva/solicitação em andamento, último produto, histórico curto).
CREATE TABLE whatsapp_sessions (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wa_id            text NOT NULL,
  state            jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_product_id  bigint,
  history          jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Mensagens recebidas (idempotência: a Meta pode reenviar o mesmo evento).
CREATE TABLE whatsapp_messages (
  wa_message_id  text PRIMARY KEY,
  wa_from        text NOT NULL,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  authorized     boolean NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_messages_from_idx ON whatsapp_messages(wa_from, received_at DESC);

-- Solicitações de compra (internas: nada é lançado no Bling).
CREATE TABLE purchase_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          serial UNIQUE,
  product_id      bigint REFERENCES products(id) ON DELETE SET NULL,
  product_text    text NOT NULL,
  quantity        numeric NOT NULL CHECK (quantity > 0),
  customer_name   text,
  notes           text,
  requested_by    uuid NOT NULL REFERENCES users(id),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ORDERED', 'RECEIVED', 'REJECTED', 'CANCELLED')),
  manager_note    text,
  handled_by      uuid REFERENCES users(id),
  handled_at      timestamptz,
  source          text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'whatsapp')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_requests_status_idx ON purchase_requests(status, created_at DESC);
CREATE INDEX purchase_requests_user_idx ON purchase_requests(requested_by, created_at DESC);
