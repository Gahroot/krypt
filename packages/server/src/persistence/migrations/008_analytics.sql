-- Analytics: append-only event log for alpha success measurement.
-- Privacy-safe: no PII beyond a SHA-256 hash of the accountId.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,          -- e.g. 'account_created', 'level_up'
  account_id  TEXT    NOT NULL,          -- SHA-256 hex digest of the raw accountId
  char_id     TEXT,                      -- optional, may be NULL for account-level events
  payload     TEXT    NOT NULL,          -- JSON blob (event-specific)
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Index for funnel queries: group by account_id + event_type.
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_account
  ON analytics_events (event_type, account_id);

-- Index for time-range queries (retention, time-to-level).
CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events (created_at);
