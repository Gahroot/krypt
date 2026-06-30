-- 003_job_advancement.sql — Add job tier and branch columns for 2nd-job advancement.

ALTER TABLE characters ADD COLUMN job_tier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN branch_id TEXT NOT NULL DEFAULT '';
