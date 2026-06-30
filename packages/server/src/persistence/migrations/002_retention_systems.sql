-- 002_retention_systems.sql — Add codex, fame, achievement, and lifetime counter columns.

ALTER TABLE characters ADD COLUMN codex TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN fame TEXT NOT NULL DEFAULT '{"fame":0,"fameHistory":{}}';
ALTER TABLE characters ADD COLUMN achievements TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN total_mesos_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN total_quests_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN total_items_collected INTEGER NOT NULL DEFAULT 0;
