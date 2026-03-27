-- ═══════════════════════════════════════════════════
-- AP Aging Dashboard v4 — Supabase Setup
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_name   TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date  DATE,
  due_date      DATE,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid   NUMERIC(12,2) NOT NULL DEFAULT 0,
  terms         TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','partial','paid','void')),
  pdf_path      TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Prevent exact duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_invoice
  ON invoices (vendor_name, invoice_number);

-- Fast lookups by status and vendor
CREATE INDEX IF NOT EXISTS idx_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_vendor ON invoices (vendor_name);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_updated ON invoices;
CREATE TRIGGER trg_invoices_updated
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Storage bucket for invoice PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: allow all operations via service role (anon for reads)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON invoices
  FOR ALL USING (true) WITH CHECK (true);

-- Storage policy: allow uploads and reads
CREATE POLICY "Allow uploads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'invoices');

CREATE POLICY "Allow reads" ON storage.objects
  FOR SELECT USING (bucket_id = 'invoices');

CREATE POLICY "Allow deletes" ON storage.objects
  FOR DELETE USING (bucket_id = 'invoices');
