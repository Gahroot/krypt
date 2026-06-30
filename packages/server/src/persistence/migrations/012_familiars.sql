-- Familiar system: registered familiar cards + currently summoned per character.
ALTER TABLE characters ADD COLUMN familiars TEXT NOT NULL DEFAULT '{"registered":[],"summoned":[]}';
