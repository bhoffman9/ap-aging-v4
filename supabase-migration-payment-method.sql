-- Add payment_method column to payments (run ONLY this)
-- Values: 'ACH' | 'Check' | 'Wire' | 'Credit Card' | 'Zelle' | 'Other'

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'ACH';

-- Backfill any existing NULLs to 'ACH' so historical payments group cleanly
UPDATE payments SET payment_method = 'ACH' WHERE payment_method IS NULL OR payment_method = '';

CREATE INDEX IF NOT EXISTS idx_payments_remittance
  ON payments (invoice_id, payment_date, payment_method);
