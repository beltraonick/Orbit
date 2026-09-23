-- F_REMOVE_DUPLICATE_SEP10.sql
-- Removes ONLY the second Sep 10 entry (943e17bb…, created 13:55 UTC after the
-- Time screen went blank), and ONLY if the original (a1acac0d…) still exists
-- with the same employee, project, day, times and full-day flag.
-- Otherwise it deletes nothing. All-or-nothing transaction.
BEGIN;

DELETE FROM time_entries dup
USING time_entries orig
WHERE dup.company_id  = 'd80c39c1-4667-4a3a-9cbc-3704e7e0957a'
  AND orig.company_id = dup.company_id
  AND dup.id::text  LIKE '943e17bb%'
  AND orig.id::text LIKE 'a1acac0d%'
  AND orig.employee_id = dup.employee_id
  AND orig.project_id  IS NOT DISTINCT FROM dup.project_id
  AND orig.clock_in    = dup.clock_in
  AND orig.clock_out   IS NOT DISTINCT FROM dup.clock_out
  AND orig.is_full_day IS NOT DISTINCT FROM dup.is_full_day;

COMMIT;

-- Check (expect: 1 entry on 2026-09-10, 10 CAA entries in total):
SELECT count(*) FILTER (WHERE clock_in::date = '2026-09-10') AS sep10,
       count(*) AS total
FROM time_entries
WHERE company_id = 'd80c39c1-4667-4a3a-9cbc-3704e7e0957a';
