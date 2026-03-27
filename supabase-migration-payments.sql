-- Payments history table (run ONLY this, nothing else)
CREATE TABLE IF NOT EXISTS payments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all payments" ON payments
  FOR ALL USING (true) WITH CHECK (true);
