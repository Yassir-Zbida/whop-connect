-- Whop Admin multi-user schema (MySQL)
-- Run to reset and create database and tables. WARNING: DROPS existing whop_admin database.

DROP DATABASE IF EXISTS whop_admin;
CREATE DATABASE whop_admin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE whop_admin;

-- Users (sign up / login by email); role: 'user' | 'admin'; active: 1 = can log in, 0 = deactivated
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email)
);

-- Activity log (for admin: all users' actions)
CREATE TABLE activity_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  email VARCHAR(255) NULL,
  action VARCHAR(128) NOT NULL,
  message VARCHAR(512) NOT NULL DEFAULT '',
  meta JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_user (user_id)
);

-- Connected accounts: each Whop company created by a user is stored and linked to that user
CREATE TABLE connected_accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  company_id VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  title VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_company (user_id, company_id),
  KEY idx_user (user_id),
  CONSTRAINT fk_connected_account_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Per-user Whop settings and webhook token (one row per user)
CREATE TABLE user_settings (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  whop_api_key VARCHAR(1024) NOT NULL DEFAULT '',
  whop_company_id VARCHAR(128) NOT NULL DEFAULT '',
  whop_webhook_secret VARCHAR(1024) NOT NULL DEFAULT '',
  webhook_token VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_token (webhook_token),
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Auto-split config per user (enabled + processed payment ids)
CREATE TABLE auto_split_config (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  processed_payment_ids JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_autosplit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Auto-split rules (product/plan filters)
CREATE TABLE auto_split_rules (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  product_id VARCHAR(128) NULL,
  plan_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rule_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Splits per rule (destination + percentage)
CREATE TABLE auto_split_rule_splits (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_id VARCHAR(64) NOT NULL,
  destination_id VARCHAR(128) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL,
  CONSTRAINT fk_split_rule FOREIGN KEY (rule_id) REFERENCES auto_split_rules (id) ON DELETE CASCADE
);

-- Auto-transfer config per user (enabled + processed payment ids)
CREATE TABLE auto_transfer_config (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  processed_payment_ids JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_autotransfer_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Auto-transfer rules: on payment match (product/plan), send % or fixed amount to any destination
CREATE TABLE auto_transfer_rules (
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

-- Sessions (for express-mysql-session; optional if store creates it automatically)
CREATE TABLE sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT
);
