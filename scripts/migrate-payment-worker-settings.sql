-- Per-user payment worker settings (replaces PAYMENT_WORKER_ENABLED env)
-- mysql -u root -p whop_admin < scripts/migrate-payment-worker-settings.sql

USE whop_admin;

ALTER TABLE user_settings
  ADD COLUMN worker_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN worker_concurrency INT UNSIGNED NOT NULL DEFAULT 5;

-- Enable for every existing account (safe to re-run)
UPDATE user_settings SET worker_enabled = 1;
