-- Transfer fee pipeline migration (run once on existing databases)
-- mysql -u root -p whop_admin < scripts/migrate-transfer-fees.sql

USE whop_admin;

ALTER TABLE user_settings
  ADD COLUMN platform_commission_pct DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN cached_fee_pct DECIMAL(8,6) NULL;
