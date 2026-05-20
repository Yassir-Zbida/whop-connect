-- Payment job queue for high-concurrency webhook processing
-- mysql -u root -p whop_admin < scripts/migrate-payment-jobs.sql

USE whop_admin;

CREATE TABLE IF NOT EXISTS payment_jobs (
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
  CONSTRAINT fk_payment_job_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
