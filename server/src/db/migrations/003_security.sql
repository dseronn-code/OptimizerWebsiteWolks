-- Verificação em duas etapas (TOTP) e desafios de login

ALTER TABLE users ADD COLUMN totp_secret_enc text;          -- segredo cifrado (AES-256-GCM)
ALTER TABLE users ADD COLUMN totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN totp_last_counter bigint;       -- impede reutilizar o mesmo código
ALTER TABLE users ADD COLUMN recovery_codes jsonb;           -- hashes dos códigos de recuperação

CREATE TABLE mfa_challenges (
  token_hash       text PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose          text NOT NULL CHECK (purpose IN ('verify', 'setup')),
  setup_secret_enc text,
  attempts         integer NOT NULL DEFAULT 0,
  ip               text,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges(user_id);
