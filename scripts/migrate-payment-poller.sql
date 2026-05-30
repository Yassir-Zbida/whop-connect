-- Payment poller migration (run once on existing databases)
-- mysql -u root -p whop_admin < scripts/migrate-payment-poller.sql

USE whop_admin;

ALTER TABLE user_settings
  ADD COLUMN last_poll_at DATETIME NULL,
  ADD COLUMN poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  ADD COLUMN polls_total INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN last_poll_error VARCHAR(512) NULL;
