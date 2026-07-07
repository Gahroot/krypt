-- 019_feedback_context.sql — Add player position + server version to feedback reports.
ALTER TABLE feedback_reports ADD COLUMN pos_x REAL NOT NULL DEFAULT 0;
ALTER TABLE feedback_reports ADD COLUMN pos_y REAL NOT NULL DEFAULT 0;
ALTER TABLE feedback_reports ADD COLUMN server_version TEXT NOT NULL DEFAULT '';
