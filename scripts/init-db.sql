-- =============================================================================
-- Whop Admin — Full database init (clean install)
-- =============================================================================
--
-- WARNING: This DROPS the entire database and recreates it. All data is lost.
--
-- Run from project root:
--   mysql -u root -p < scripts/init-db.sql
--
-- Or with explicit host/port:
--   mysql -h localhost -P 3306 -u root -p < scripts/init-db.sql
--
-- Ensure DB_NAME in .env matches the database name below (default: whop_admin).
-- After init: start the app, sign up, configure Whop in Settings.
--
-- Requires: MySQL 8.0+ (JSON columns). MariaDB 10.2+ may work with JSON support.
-- =============================================================================

DROP DATABASE IF EXISTS whop_admin;
CREATE DATABASE whop_admin
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE whop_admin;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- Users (email login; role: user | admin)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email),
  KEY idx_users_role (role),
  KEY idx_users_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Activity log (admin dashboard + workflow metrics)
-- -----------------------------------------------------------------------------
CREATE TABLE activity_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  email VARCHAR(255) NULL,
  action VARCHAR(128) NOT NULL,
  message VARCHAR(512) NOT NULL DEFAULT '',
  meta JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_activity_created (created_at),
  KEY idx_activity_user (user_id),
  KEY idx_activity_action (action),
  KEY idx_activity_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Connected accounts (Whop child companies created via the app)
-- -----------------------------------------------------------------------------
CREATE TABLE connected_accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  company_id VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  title VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_company (user_id, company_id),
  KEY idx_connected_user (user_id),
  KEY idx_connected_company (company_id),
  CONSTRAINT fk_connected_account_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Per-user Whop settings (encrypted API key + webhook secret at app layer)
-- -----------------------------------------------------------------------------
CREATE TABLE user_settings (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  whop_api_key VARCHAR(1024) NOT NULL DEFAULT '',
  whop_company_id VARCHAR(128) NOT NULL DEFAULT '',
  whop_webhook_secret VARCHAR(1024) NOT NULL DEFAULT '',
  platform_commission_pct DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  cached_fee_pct DECIMAL(8,6) NULL,
  last_poll_at DATETIME NULL,
  poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  poll_enabled TINYINT(1) NOT NULL DEFAULT 1,
  poll_tick_ms INT UNSIGNED NOT NULL DEFAULT 60000,
  poll_parallel INT UNSIGNED NOT NULL DEFAULT 5,
  polls_total INT UNSIGNED NOT NULL DEFAULT 0,
  last_poll_error VARCHAR(512) NULL,
  worker_enabled TINYINT(1) NOT NULL DEFAULT 1,
  worker_concurrency INT UNSIGNED NOT NULL DEFAULT 5,
  webhook_token VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_token (webhook_token),
  KEY idx_settings_company (whop_company_id),
  CONSTRAINT fk_settings_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Auto-split (config + rules + split destinations)
-- -----------------------------------------------------------------------------
CREATE TABLE auto_split_config (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  processed_payment_ids JSON NOT NULL DEFAULT ('[]'),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_autosplit_config_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auto_split_rules (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  product_id VARCHAR(128) NULL,
  plan_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_split_rules_user (user_id),
  KEY idx_split_rules_product (user_id, product_id),
  CONSTRAINT fk_split_rule_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auto_split_rule_splits (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_id VARCHAR(64) NOT NULL,
  destination_id VARCHAR(128) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL,
  KEY idx_split_dest_rule (rule_id),
  CONSTRAINT fk_split_rule
    FOREIGN KEY (rule_id) REFERENCES auto_split_rules (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Auto-transfer (config + rules)
-- -----------------------------------------------------------------------------
CREATE TABLE auto_transfer_config (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  processed_payment_ids JSON NOT NULL DEFAULT ('[]'),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_autotransfer_config_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auto_transfer_rules (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  product_id VARCHAR(128) NULL,
  plan_id VARCHAR(128) NULL,
  destination_id VARCHAR(128) NOT NULL,
  transfer_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
  value DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_transfer_rules_user (user_id),
  KEY idx_transfer_rules_product (user_id, product_id),
  CONSTRAINT fk_autotransfer_rule_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Payment job queue (webhooks + catch-up; background worker)
-- -----------------------------------------------------------------------------
CREATE TABLE payment_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  payment_id VARCHAR(128) NOT NULL,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  last_error TEXT NULL,
  result_json JSON NULL,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_payment (user_id, payment_id),
  KEY idx_status_created (status, created_at),
  KEY idx_payment_jobs_user (user_id),
  KEY idx_payment_jobs_updated (status, updated_at),
  CONSTRAINT fk_payment_job_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Express sessions (express-mysql-session)
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT NULL,
  PRIMARY KEY (session_id),
  KEY idx_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- Done
-- -----------------------------------------------------------------------------
SELECT 'whop_admin database initialized successfully.' AS status;
