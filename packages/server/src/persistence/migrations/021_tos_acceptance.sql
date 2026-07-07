-- 021_tos_acceptance.sql — Record alpha Terms-of-Service acceptance at registration.
--
-- Every new account (guest, email, wallet) must accept a short ToS/Privacy notice
-- before entering the alpha. The acceptance timestamp and version string are stored
-- server-side so we can prove consent and track which notice version each account saw.

ALTER TABLE account_auth ADD COLUMN tos_accepted_at INTEGER;
ALTER TABLE account_auth ADD COLUMN tos_version TEXT;
