-- 016_account_auth.sql — Authentication credentials for accounts.
--
-- Identity (account_id) is ALWAYS server-generated (see src/auth.ts). This table
-- attaches a *login credential* to an existing account so a player can recover the
-- same account — and therefore the same characters, mesos and items — after their
-- browser's localStorage is cleared or on a different machine.
--
-- Two credential kinds are supported for the alpha, and an account may have either
-- or both:
--   (a) email + bcrypt password hash   — lightweight, no wallet required.
--   (b) wallet                         — "sign in with wallet" (EIP-191 verified).
--
-- Guests have NO row here; they "claim"/upgrade their account by inserting one,
-- keeping their existing account_id (and all progress) intact.
--
-- NOTE: password_hash stores a salted bcrypt digest only — never a plaintext secret.

CREATE TABLE IF NOT EXISTS account_auth (
  account_id    TEXT PRIMARY KEY REFERENCES accounts(account_id),
  -- Normalized (trimmed + lowercased) email. NULL when wallet-only.
  email         TEXT,
  -- Salted bcrypt hash of the password. NULL when wallet-only.
  password_hash TEXT,
  -- Lowercased 0x EVM address. NULL when email-only.
  wallet        TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- One account per email / per wallet. Partial indexes so multiple NULLs are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_auth_email
  ON account_auth (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_auth_wallet
  ON account_auth (wallet) WHERE wallet IS NOT NULL;
