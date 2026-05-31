-- Batch transfer settings on auto-split and auto-transfer rules
ALTER TABLE auto_split_rules
  ADD COLUMN batch_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER plan_id,
  ADD COLUMN batch_per_amount DECIMAL(12,2) NULL AFTER batch_enabled;

ALTER TABLE auto_transfer_rules
  ADD COLUMN batch_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER value,
  ADD COLUMN batch_per_amount DECIMAL(12,2) NULL AFTER batch_enabled;
