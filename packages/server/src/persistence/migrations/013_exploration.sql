-- Exploration Dispatch (idle Monster Collection)
ALTER TABLE characters ADD COLUMN exploration TEXT NOT NULL DEFAULT '{"slots":[]}';
