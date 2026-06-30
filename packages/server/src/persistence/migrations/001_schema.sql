-- 001_schema.sql — Initial database schema for CryptoMaple persistence.
-- Covers accounts, characters, market listings, treasury, and guilds.

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Accounts: premium currency, cash inventory, shared stash
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  cash INTEGER NOT NULL DEFAULT 10000,
  cash_inventory TEXT NOT NULL DEFAULT '[]',
  storage TEXT NOT NULL DEFAULT '{}'
);

-- Characters: full character record with JSON blobs for complex nested data
CREATE TABLE IF NOT EXISTS characters (
  char_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  name TEXT NOT NULL,
  archetype TEXT NOT NULL,
  appearance TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  ap INTEGER NOT NULL DEFAULT 0,
  sp INTEGER NOT NULL DEFAULT 0,
  stats TEXT NOT NULL DEFAULT '{}',
  max_hp INTEGER NOT NULL DEFAULT 50,
  max_mp INTEGER NOT NULL DEFAULT 5,
  mesos INTEGER NOT NULL DEFAULT 0,
  map_id TEXT NOT NULL DEFAULT 'meadowfield',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '{}',
  equipped TEXT DEFAULT NULL,
  equipped_cash TEXT DEFAULT NULL,
  quests TEXT DEFAULT NULL,
  learned_skills TEXT NOT NULL DEFAULT '[]',
  skill_book TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_name ON characters(name);

-- Free Market listings
CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  item TEXT NOT NULL,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Treasury: mesos sink tracker (single row)
CREATE TABLE IF NOT EXISTS treasury (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_burned INTEGER NOT NULL DEFAULT 0,
  by_reason TEXT NOT NULL DEFAULT '{}'
);

-- Guilds with roster
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emblem TEXT NOT NULL,
  created_date INTEGER NOT NULL,
  roster_entries TEXT NOT NULL DEFAULT '[]'
);
