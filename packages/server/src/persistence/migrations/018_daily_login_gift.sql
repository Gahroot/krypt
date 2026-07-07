-- 018_daily_login_gift.sql — Track last daily login gift claim per character.

ALTER TABLE characters ADD COLUMN last_daily_login_gift_at INTEGER DEFAULT NULL;
