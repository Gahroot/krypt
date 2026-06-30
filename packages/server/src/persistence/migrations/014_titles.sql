-- Titles (owned list + equipped title)
ALTER TABLE characters ADD COLUMN owned_titles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN equipped_title TEXT NOT NULL DEFAULT '';
