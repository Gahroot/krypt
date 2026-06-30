-- 006_combat_qol.sql — Auto-pot thresholds + skill macros per character.
ALTER TABLE characters ADD COLUMN auto_pot TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN macros TEXT NOT NULL DEFAULT '[]';
