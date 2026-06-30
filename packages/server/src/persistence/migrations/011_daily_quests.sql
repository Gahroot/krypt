-- 011_daily_quests.sql — Add daily quest reset tracking columns.

ALTER TABLE characters ADD COLUMN last_daily_reset_at INTEGER DEFAULT NULL;
ALTER TABLE characters ADD COLUMN daily_completions TEXT NOT NULL DEFAULT '{}';
