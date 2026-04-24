-- One-time cleanup: invoices that should be 'paid' but are stuck as 'partial'/'open'
-- because amount_paid was a fraction of a cent below amount (float precision).
-- Run once after deploying the tolerance fix.

UPDATE invoices
SET status = 'paid'
WHERE status IN ('partial', 'open')
  AND amount_paid >= amount - 0.05
  AND amount > 0;
