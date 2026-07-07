-- 020_invite_codes.sql — Alpha invite-code gating.
--
-- When ALPHA_ENABLED is set, new account creation (register, guest, wallet) requires
-- a valid invite code. Admins mint/revoke codes via /admin/invite-codes endpoints.

CREATE TABLE IF NOT EXISTS invite_codes (
  code         TEXT PRIMARY KEY,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expires_at   INTEGER NOT NULL DEFAULT 0,
  max_uses     INTEGER NOT NULL DEFAULT 1,
  use_count    INTEGER NOT NULL DEFAULT 0,
  used_by      TEXT NOT NULL DEFAULT '[]',
  revoked      INTEGER NOT NULL DEFAULT 0
);
