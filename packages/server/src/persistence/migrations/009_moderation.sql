-- 009_moderation.sql — Moderation tooling for public multiplayer alpha.
-- Adds: admin role, muted/banned flags, block lists, player reports.

-- Admin / moderation role on accounts.
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'player';

-- Muted: timestamp (epoch ms) until which the account is muted. NULL = not muted.
ALTER TABLE accounts ADD COLUMN muted_until INTEGER;

-- Banned: boolean flag. Banned accounts cannot join.
ALTER TABLE accounts ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;

-- Ban reason (for audit trail).
ALTER TABLE accounts ADD COLUMN ban_reason TEXT NOT NULL DEFAULT '';

-- Block list: JSON array of blocked character names, per account.
ALTER TABLE accounts ADD COLUMN blocked_players TEXT NOT NULL DEFAULT '[]';

-- Player reports table for GM review.
CREATE TABLE IF NOT EXISTS player_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_acc  TEXT    NOT NULL,
  reporter_name TEXT    NOT NULL,
  target_name   TEXT    NOT NULL,
  reason        TEXT    NOT NULL,
  chat_context  TEXT    NOT NULL DEFAULT '[]',
  map_id        TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Index for GM review: newest first.
CREATE INDEX IF NOT EXISTS idx_player_reports_created
  ON player_reports (created_at DESC);

-- Index for querying reports about a specific player.
CREATE INDEX IF NOT EXISTS idx_player_reports_target
  ON player_reports (target_name);
