-- Migration: add auto_transfer tables (run on existing whop_admin DB)
USE whop_admin;

CREATE TABLE IF NOT EXISTS auto_transfer_config (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  processed_payment_ids JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_autotransfer_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auto_transfer_rules (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  product_id VARCHAR(128) NULL,
  plan_id VARCHAR(128) NULL,
  destination_id VARCHAR(128) NOT NULL,
  transfer_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
  value DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_autotransfer_rule_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
