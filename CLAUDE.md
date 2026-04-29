# AP Aging Dashboard v4

Accounts-payable aging dashboard for Show Freight Inc. Tracks vendor invoices, aging buckets, payments, AI-powered PDF extraction, and fleet equipment.

**Live:** https://ap-aging-v4.vercel.app/  
**Owner:** Ben Hoffman

## Tech Stack

- **Framework:** Next.js 14 (App Router), React 18
- **Database:** Supabase (PostgreSQL) — tables: `invoices`, `payments`, `equipment`
- **Storage:** Supabase Storage bucket `invoices` (PDF files)
- **AI:** Anthropic SDK (`@anthropic-ai/sdk` v0.30) — Claude Haiku 4.5 for PDF invoice extraction
- **PDF Parsing:** `pdfjs-dist` for client-side regex extraction (zero-cost fallback)
- **Deployment:** Vercel
- **Language:** Plain JavaScript (no TypeScript)
- **Styling:** Inline styles via `S` object (dark slate/blue theme) — no CSS framework

## Project Structure

```
src/
├── app/
│   ├── layout.js              # Root layout, Google fonts (DM Sans, JetBrains Mono)
│   ├── page.js                # Client wrapper → <APAgingDashboard />
│   ├── globals.css            # Animations: spin, fadeIn, modalIn
│   └── api/
│       ├── invoices/route.js  # Full CRUD (GET/POST/PUT/DELETE)
│       ├── payments/route.js  # GET history, POST record payment
│       ├── extract/route.js   # PDF → Claude Haiku → structured JSON
│       └── equipment/route.js # Fleet data with invoice matching, CORS enabled
├── components/
│   └── APAgingDashboard.js    # Single main component (~1400 lines)
└── lib/
    ├── supabase.js            # Server client (service role key)
    ├── supabase-browser.js    # Browser client (anon key)
    └── extract-pdf.js         # Client-side regex PDF extraction
```

## Architecture Notes

- **Single-component frontend.** `APAgingDashboard.js` contains all views, modals, state, and rendering. Do not split into separate files unless Ben asks.
- **Path alias:** `@/*` maps to `./src/*` (jsconfig.json).
- **All API routes use `force-dynamic`** — no static generation.
- **Backend uses service role** (`@/lib/supabase`), frontend uses anon key (`@/lib/supabase-browser`).
- **Field mapping:** Database is `snake_case`, frontend is `camelCase`. The `toFrontend()` helper in `/api/invoices/route.js` converts.
- **Supabase build workaround:** Uses placeholder URL at build time so Next.js doesn't crash when env vars aren't available.

## Database Schema

### `invoices`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto-generated |
| vendor_name | TEXT NOT NULL | |
| invoice_number | TEXT NOT NULL | |
| invoice_date | DATE | |
| due_date | DATE | |
| amount | NUMERIC(12,2) | default 0 |
| amount_paid | NUMERIC(12,2) | default 0 |
| terms | TEXT | default '' |
| description | TEXT | default '' |
| status | TEXT | 'open' / 'partial' / 'paid' / 'void' |
| pdf_path | TEXT | Supabase storage path |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | auto-trigger |

**Unique constraint:** `(vendor_name, invoice_number)` — prevents duplicates.

### `payments`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | auto-generated |
| invoice_id | UUID FK → invoices | ON DELETE CASCADE |
| amount | NUMERIC(12,2) NOT NULL | |
| payment_date | DATE | default today |
| payment_method | TEXT | default 'ACH'. Values: ACH / Check / Wire / Credit Card / Zelle / Other. Used for remittance grouping. |
| note | TEXT | "CREDIT APPLIED" for credits |
| created_at | TIMESTAMPTZ | |

### `equipment`
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| fleet_number | TEXT | truck/trailer number (e.g. "510") |
| vendor | TEXT NOT NULL | TEC, Penske, TCI, McKinney, etc. |
| vendor_unit | TEXT | vendor's equipment ID for invoice matching |
| vin, make, model, year | TEXT | equipment details |
| type | TEXT | Day Cab, Sleeper, Box Truck, Dry Van, etc. |
| category | TEXT | 'truck' or 'trailer' |
| monthly_cost | NUMERIC(10,2) | |
| mileage_rate | NUMERIC(6,4) | |
| contract | TEXT | lease/rental agreement ID |
| status | TEXT | 'Active', 'Returned', 'OOS' |

**97 units total:** 33 trucks + 65 trailers.

## API Endpoints

### `GET /api/invoices`
Returns all invoices ordered by status then due_date. Supports `?vendor=X&invoiceNumber=Y` for duplicate checking.

### `POST /api/invoices`
Create invoice. Requires `vendorName` + `invoiceNumber`. Rejects duplicates.

### `PUT /api/invoices`
Update any invoice field by `id`.

### `DELETE /api/invoices?id=UUID`
Deletes invoice and its PDF from Supabase Storage.

### `GET /api/payments?invoiceId=UUID`
Payment history for an invoice.

### `POST /api/payments`
Record payment: `{ invoiceId, amount, paymentDate, paymentMethod, note }`. Auto-updates invoice `amount_paid` and `status` (open → partial → paid). Status uses **±$0.05 tolerance** so float precision in stored `amount` doesn't leave fully-paid invoices stuck as `partial`.

### `GET /api/payments?all=1`
All payments with joined invoice context (vendor name, invoice #, status). Used by the Remittances section to group closed invoices by `vendor + payment_date + payment_method`.

### `GET /api/equipment`
Full fleet with invoice summaries. Matches invoices to units by:
1. `Unit # XXXXX` in invoice description → exact match to `vendor_unit`
2. TCI contract: invoice# containing contract number → unit
3. Unmatched invoices stay at vendor level

CORS enabled for all origins (consumed by FreightIQ dashboard).

### `POST /api/extract`
Multipart form with PDF file → Claude Haiku 4.5 extraction → returns `{ vendorName, invoiceNumber, invoiceDate, dueDate, amount, terms, description, units[], vins[], contractNumber, billingPeriod }`.

## Key Features

1. **5 views:** Aging, Vendor Folders, Equipment, Expected, Analytics
2. **Aging buckets:** Current, 1-30, 31-60, 61-90, 90+ days (color-coded green→red)
3. **Drag-and-drop PDF upload** with batch queue
4. **AI extraction:** Claude Haiku parses PDFs; client-side regex fallback (zero API cost)
5. **Payment recording:** Full, Partial, Apply Credit — single or batch. Each payment captures a `payment_method` (ACH/Check/Wire/Credit Card/Zelle/Other), defaulting to ACH.
6. **Batch payment modal:** Two modes — **Per-Invoice** (full/partial toggle per invoice) and **Distribute Total** (type one total, app fills oldest-due invoices first; "Pay All" shortcut auto-fills total balance; live allocated-vs-balance indicator with over-amount warning).
6a. **Remittances view:** Replaces the old flat paid/void list. Closed invoices grouped into collapsible cards keyed by `vendor + payment_date + payment_method`. Each card shows total paid, invoice count, color-coded method badge; expand to see invoice breakdown with reopen/PDF/delete per invoice. Voided invoices with no payment surface as their own "Void" remittance card.
7. **Equipment fleet view:** Click unit to expand and see matched invoices + PDFs
8. **Expected invoices:** Auto-generates expected monthly costs from equipment table
9. **Analytics:** Per-vendor spend breakdown, % of total, averages
10. **Vendor normalization:** Groups similar vendor names (e.g. "Penske" = "PENSKE TRUCK LEASING")
11. **CSV export (Aging view, top-right):** Two single-sheet CSVs for management reports.
    - **Summary CSV** — one row per vendor: `Vendor, Open Invoices, Current, 1–30, 31–60, 61–90, 90+, Total Outstanding` + `TOTAL` row. Filename `ap-aging-YYYY-MM-DD.csv`.
    - **Detail CSV** — one row per open invoice: `Vendor, Invoice #, Invoice Date, Due Date, Days Past Due, Aging Bucket, Amount, Amount Paid, Balance, Status, Terms, Description` + `TOTAL` row. Sorted by vendor → due date. Filename `ap-aging-detail-YYYY-MM-DD.csv`.
    - Both reuse the dashboard's `agingBucket()` / `bucketTotal()` so numbers match what's on screen. UTF-8 BOM prepended so Excel opens cleanly. Amounts written as plain decimals (no `$`) so Excel keeps them numeric.

## Equipment Vendors & Invoice Matching

**Trucks:**
- **TCI** (6 units): vendor_unit = `26xxx` or `19129`. Contract-based matching for invoices.
- **Penske** (3 units): vendor_unit = `587xxx`
- **TEC** (23 units): Old format `101xxx`, new format `104xxx`/`103xxx`
- **Ryder** (1 unit)

**Trailers:** McKinney (28), Mountain West (21), XTRA Lease (8), Ten Trailer (5), Premier (2), Boxwheel (1). Most use statement-level invoices without unit-level matching.

## Styles

All styling is inline via the `S` object at the bottom of `APAgingDashboard.js`. Key tokens:
- Dark backgrounds: `#070b14`, `#0a0f1a`, `#0d1117`, `#161b22`
- Borders: `#1e293b`
- Text: `#e2e8f0` (bright), `#94a3b8` (medium), `#64748b` (dim)
- Accent: green `#22c55e`, blue `#3b82f6`, orange `#f59e0b`, red `#ef4444`
- Max page width: 1600px
- Fonts: DM Sans (body), JetBrains Mono (monospace values)

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anon key (browser)
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role (server API routes)
ANTHROPIC_API_KEY=                # For /api/extract PDF parsing
NEXT_PUBLIC_APP_PASSWORD=         # Password gate (current: ShowFreight2026!)
```

## Authentication

- **Password gate** in `src/components/PasswordGate.js`, wraps `<APAgingDashboard />` from `src/app/page.js`
- Users enter the password once per browser, stays unlocked for **30 days** via localStorage key `sf_auth_v1`
- Server API routes (`/api/invoices`, `/api/payments`, `/api/extract`, `/api/equipment`) bypass the gate so cross-app calls (FreightIQ pulling equipment) keep working
- Same shared password as FreightIQ, Per Load CPM, Budget Calendar, Flexent

## Development

```bash
npm run dev    # Start dev server
npm run build  # Production build
npm start      # Start production server
```

## Cross-Project Integration

- **FreightIQ** fetches `/api/equipment` for its Trucks & Trailers "Assets" views via `useEquipment()` context.
- **CFO Dashboard** pulls AP data from Supabase directly for financial metrics.

## SQL Migration Files (root)

- `supabase-setup.sql` — Creates `invoices` table, indexes, RLS, storage bucket
- `supabase-migration-payments.sql` — Creates `payments` table
- `supabase-migration-payment-method.sql` — Adds `payment_method` column (default 'ACH'), backfills historical rows, indexes for remittance grouping
- `supabase-cleanup-stuck-paid.sql` — One-time cleanup: marks invoices `paid` where `amount_paid >= amount - 0.05` but status is still `partial`/`open` (legacy float-precision sweep)
- `equipment-setup.sql` — Creates `equipment` table
- `seed-equipment.js` — Seeds equipment data (97 units)

## Money math conventions

**Always use ±$0.05 tolerance** when deriving payment status from `amount` vs `amount_paid`. Strict equality leaves invoices stuck at sub-cent balances because stored `amount` may have hidden float precision. Pattern:
```
paid    if newPaid >= amount - 0.05
open    if newPaid <= 0.05
partial otherwise
```
Applies to POST (record payment) and DELETE (undo payment) handlers, and to any future "fully covered" derivations.
