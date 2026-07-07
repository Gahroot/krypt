-- 022_owned_mounts.sql — Persistent storage for owned mount def ids per character.

ALTER TABLE characters ADD COLUMN owned_mounts TEXT;
