-- =============================================================================
-- Whop Admin — Tables only (CloudPanel / existing database)
-- =============================================================================
--
-- Use when CloudPanel already created the database (e.g. whooop-app).
-- Does NOT drop the database.
--
--   mysql -u admin -p whooop-app < scripts/init-tables-cloudpanel.sql
--
-- Set DB_NAME=whooop-app in .env to match.
-- =============================================================================

USE `whoop-app`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS payment_jobs;
DROP TABLE IF EXISTS auto_split_rule_splits;
DROP TABLE IF EXISTS auto_split_rules;
DROP TABLE IF EXISTS auto_split_config;
DROP TABLE IF EXISTS auto_transfer_rules;
DROP TABLE IF EXISTS auto_transfer_config;
DROP TABLE IF EXISTS connected_accounts;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS activity_log;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- -----------------------------------------------------------------------------
-- Users
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

CREATE TABLE user_settings (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  whop_api_key VARCHAR(1024) NOT NULL DEFAULT '',
  whop_company_id VARCHAR(128) NOT NULL DEFAULT '',
  whop_webhook_secret VARCHAR(1024) NOT NULL DEFAULT '',
  webhook_token VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_token (webhook_token),
  KEY idx_settings_company (whop_company_id),
  CONSTRAINT fk_settings_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT NULL,
  PRIMARY KEY (session_id),
  KEY idx_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'whooop-app tables initialized successfully.' AS status;
