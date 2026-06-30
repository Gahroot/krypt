-- Player settings (controls + video + audio + gameplay).
-- Stored as JSON; client reads/writes via SETTINGS_SYNC message.
ALTER TABLE characters ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
