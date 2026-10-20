-- Cadastro com confirmação de e-mail e aprovação pelo administrador

ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN pending_approval boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE email_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  purpose     text NOT NULL DEFAULT 'signup',
  code_hash   text NOT NULL,
  payload     jsonb NOT NULL,          -- dados do cadastro (nome e hash da senha — nunca a senha em texto)
  attempts    integer NOT NULL DEFAULT 0,
  sent_count  integer NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_email_idx ON email_verifications (lower(email), created_at DESC);
