-- Equipment Fleet Table Setup
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/bhdaiddrfeqtwjlsfifx/sql

CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  fleet_number TEXT,
  vendor TEXT NOT NULL,
  vendor_unit TEXT,
  vin TEXT DEFAULT '—',
  make TEXT DEFAULT '—',
  model TEXT DEFAULT '—',
  year TEXT DEFAULT '—',
  type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('truck', 'trailer')),
  monthly_cost NUMERIC(10,2) DEFAULT 0,
  mileage_rate NUMERIC(6,4) DEFAULT 0,
  contract TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on equipment" ON equipment
  FOR ALL USING (true) WITH CHECK (true);

-- Optional: auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_equipment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER equipment_updated_at_trigger
  BEFORE UPDATE ON equipment
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_updated_at();
