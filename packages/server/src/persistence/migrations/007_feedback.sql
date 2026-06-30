-- 007_feedback.sql — Bug reports / feedback from alpha testers.
CREATE TABLE IF NOT EXISTS feedback_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  char_id     TEXT NOT NULL,
  char_name   TEXT NOT NULL,
  category    TEXT NOT NULL CHECK(category IN ('bug', 'idea', 'balance')),
  message     TEXT NOT NULL,
  map_id      TEXT NOT NULL DEFAULT '',
  level       INTEGER NOT NULL DEFAULT 0,
  archetype   TEXT NOT NULL DEFAULT '',
  client_version TEXT NOT NULL DEFAULT '',
  log_lines   TEXT NOT NULL DEFAULT '[]',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
