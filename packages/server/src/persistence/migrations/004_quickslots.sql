-- 004_quickslots.sql — Add quickslot hotbar column for skill/item shortcuts.

ALTER TABLE characters ADD COLUMN quickslots TEXT NOT NULL DEFAULT '[]';
