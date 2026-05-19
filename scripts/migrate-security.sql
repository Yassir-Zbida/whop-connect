-- Security hardening migration (run once on existing databases)
-- mysql -u root -p whop_admin < scripts/migrate-security.sql

USE whop_admin;

ALTER TABLE user_settings
  MODIFY COLUMN whop_api_key VARCHAR(1024) NOT NULL DEFAULT '';

-- Ignore error if column already exists
ALTER TABLE user_settings
  ADD COLUMN whop_webhook_secret VARCHAR(1024) NOT NULL DEFAULT '' AFTER whop_company_id;
