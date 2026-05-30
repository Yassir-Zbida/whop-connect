-- Per-user payment poller settings (run once on existing databases)
-- mysql -u root -p whop_admin < scripts/migrate-payment-poller-settings.sql

USE whop_admin;

ALTER TABLE user_settings
  ADD COLUMN poll_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN poll_tick_ms INT UNSIGNED NOT NULL DEFAULT 60000,
  ADD COLUMN poll_parallel INT UNSIGNED NOT NULL DEFAULT 5;

UPDATE user_settings
SET poll_tick_ms = GREATEST(10000, poll_interval_seconds * 1000);
