# Product database deployment — migrations 037, 038, 039 only

Scope: brings the production database in line with code already live on `main`
(PRs #60–#68). **Not included:** 040–044 (RLS/security phase), `SUPABASE_JWT_SECRET`,
`AUTH_SECRET`, the service-role login fix (commit `3a1e2d8`), and anything from the
abandoned `claude/vercel-deploy-mobile-first-f6xt21` branch.

The three `STEPn_APPLY_*.sql` files are the `supabase/migrations/03x_*.sql` files from
`main`, byte-identical, wrapped in `BEGIN; … COMMIT;` so each one is all-or-nothing.

| sha256 (first 12) of the migration body | file |
|---|---|
| `11e49d14b5d0` | 037_company_pay_system.sql |
| `a3d7b5426bec` | 038_payroll_period_snapshots.sql |
| `edf50b69bda8` | 039_manual_compensation.sql |

## Order (run one file at a time in Supabase → SQL Editor → New query)

| # | File | Writes? | Continue only if |
|---|---|---|---|
| 0 | `PRE_037_039_PRODUCTION_CHECK.sql` | no | OVERALL = `PASS`, CAA match = exactly 1, SCHEMA 037/038/039 = `false`. **Save the result and copy the `BASELINE_PASTE` value.** |
| 1 | `STEP1_APPLY_037_company_pay_system.sql` | yes | Ends with `Success` / no error |
| 1b | `STEP1_AFTER_037_CHECK.sql` (paste BASELINE on the marked line) | no | OVERALL = `PASS` |
| 2 | `STEP2_APPLY_038_payroll_period_snapshots.sql` | yes | no error |
| 2b | `STEP2_AFTER_038_CHECK.sql` (paste BASELINE) | no | OVERALL = `PASS` |
| 3 | `STEP3_APPLY_039_manual_compensation.sql` | yes | no error (Supabase may warn "destructive operation" because of `DROP CONSTRAINT IF EXISTS` on the new, empty table — expected, confirm) |
| 3b | `STEP3_AFTER_039_CHECK.sql` (paste BASELINE) | no | OVERALL = `PASS` |
| 4 | `POST_037_039_PRODUCTION_CHECK.sql` (paste BASELINE) | no | OVERALL = `PASS`; compare its CAA section with PRE's |

Each check file is a single read-only `SELECT` returning one table
(`section | check_name | value | result`) with an `OVERALL` verdict row on top.

## STOP rules
- Any `FAIL` or `STOP` row → stop and send the full result before doing anything else.
- `STOP: BASELINE not pasted` → you forgot to paste the PRE value; paste and re-run the check (nothing is wrong with the DB).
- An `UNCHANGED … FAIL` can be caused by normal app use during the window (e.g. an admin edits an employee's rate or an old time entry). Report it; it is checked, not ignored.
- An error while running an APPLY file → the transaction is rolled back automatically; nothing was applied. Stop and send the error text.
- Do not re-order steps: 039 depends on 038 (`payroll_periods`, `payroll_period_entries`).
- All three APPLY files are safe to re-run (verified locally).

## What 037 writes (the only step that touches existing tables)
1. Adds the nullable column `company_document_settings.pay_system`.
2. Inserts a default `company_document_settings` row for any company that has none.
   Its values equal the defaults the app already uses when the row is missing, so
   nothing the app shows changes (`settings.effective_values_fingerprint` proves it).
3. Sets `pay_system` only where it is still NULL: `daily` if every active employee/worker
   has only a daily rate, `hourly` if every one has only an hourly rate, otherwise NULL.
   PRE row "active people by rate type" predicts CAA's result. `pay_system` is **not**
   used in any pay calculation (only default mode for new people + labels + the
   mismatch report in Settings); no rate is modified.

038 and 039 only create new, empty tables/columns/indexes/policies.

Verified locally on PostgreSQL 16 with migrations 002–036 applied and fictional data:
all checks PASS, re-running all three APPLY files is a no-op, and a deliberately changed
rate and time entry were both caught as FAIL.
