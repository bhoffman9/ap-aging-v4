-- Bank balances table (run in Supabase SQL Editor)
CREATE TABLE IF NOT EXISTS balances (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all balances" ON balances
  FOR ALL USING (true) WITH CHECK (true);

-- Seed the two accounts
INSERT INTO balances (id, label, amount) VALUES
  ('capacity_express', 'Capacity Express', 0),
  ('show_freight', 'Show Freight', 0)
ON CONFLICT (id) DO NOTHING;
