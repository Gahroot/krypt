-- 010_friends.sql — Persistent per-account friends list (bidirectional buddy system).

CREATE TABLE IF NOT EXISTS friends (
  account_id        TEXT NOT NULL,
  friend_account_id TEXT NOT NULL,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (account_id, friend_account_id)
);

-- Reverse lookup: find all accounts that friend a given account.
CREATE INDEX IF NOT EXISTS idx_friends_b ON friends(friend_account_id);
