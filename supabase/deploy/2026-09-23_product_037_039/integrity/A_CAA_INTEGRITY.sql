-- A_CAA_INTEGRITY.sql  (READ-ONLY, one SELECT; no names, emails or secrets)
WITH c AS (SELECT 'd80c39c1-4667-4a3a-9cbc-3704e7e0957a'::uuid AS id),
d AS (SELECT date '2026-09-23' AS today),
te AS (SELECT t.* FROM time_entries t, c WHERE t.company_id = c.id),
r(n, item, val) AS (
SELECT 1, 'company rows with CAA id',
  (SELECT count(*) FROM companies, c WHERE companies.id = c.id)::text
UNION ALL SELECT 2, 'settings rows for CAA (expect 1)',
  (SELECT count(*) FROM company_document_settings s, c
    WHERE s.company_id = c.id)::text
UNION ALL SELECT 3, 'profiles: total / created today',
  (SELECT count(*) || ' / ' || count(*) FILTER (WHERE created_at >= (SELECT today FROM d))
     FROM profiles p, c WHERE p.company_id = c.id)
UNION ALL SELECT 4, 'profiles: first / last created_at',
  (SELECT min(created_at)::date || ' / ' || max(created_at)::date
     FROM profiles p, c WHERE p.company_id = c.id)
UNION ALL SELECT 5, 'profiles: duplicate emails (all companies)',
  (SELECT count(*) FROM (SELECT lower(email) FROM profiles
     GROUP BY 1 HAVING count(*) > 1) x)::text
UNION ALL SELECT 6, 'workers: total / created today',
  (SELECT count(*) || ' / ' || count(*) FILTER (WHERE created_at >= (SELECT today FROM d))
     FROM workers w, c WHERE w.company_id = c.id)
UNION ALL SELECT 7, 'workers: duplicate names in CAA',
  (SELECT count(*) FROM (SELECT lower(full_name) FROM workers w, c
     WHERE w.company_id = c.id GROUP BY 1 HAVING count(*) > 1) x)::text
UNION ALL SELECT 8, 'projects: total / created today',
  (SELECT count(*) || ' / ' || count(*) FILTER (WHERE created_at >= (SELECT today FROM d))
     FROM projects p, c WHERE p.company_id = c.id)
UNION ALL SELECT 9, 'projects: duplicate names in CAA',
  (SELECT count(*) FROM (SELECT lower(name) FROM projects p, c
     WHERE p.company_id = c.id GROUP BY 1 HAVING count(*) > 1) x)::text
UNION ALL SELECT 10, 'worker_projects: CAA rows / orphans',
  (SELECT count(*) || ' / ' || count(*) FILTER (WHERE w.id IS NULL OR p.id IS NULL)
     FROM worker_projects wp JOIN c ON wp.company_id = c.id
     LEFT JOIN workers w ON w.id = wp.worker_id
     LEFT JOIN projects p ON p.id = wp.project_id)
UNION ALL SELECT 20, 'time_entries: total',
  (SELECT count(*) FROM te)::text
UNION ALL SELECT 21, 'time_entries: created before today / today',
  (SELECT count(*) FILTER (WHERE created_at < (SELECT today FROM d)) || ' / '
       || count(*) FILTER (WHERE created_at >= (SELECT today FROM d)) FROM te)
UNION ALL SELECT 22, 'time_entries: first / last created_at',
  (SELECT min(created_at) || ' / ' || max(created_at) FROM te)
UNION ALL SELECT 23, 'time_entries by work month (clock_in)',
  (SELECT string_agg(m || '=' || n, ', ' ORDER BY m) FROM (
     SELECT to_char(clock_in, 'YYYY-MM') m, count(*) n FROM te GROUP BY 1) x)
UNION ALL SELECT 24, 'Sep 1-15 / Sep 16-30 (by clock_in)',
  (SELECT count(*) FILTER (WHERE clock_in >= '2026-09-01' AND clock_in < '2026-09-16')
     || ' / ' || count(*) FILTER (WHERE clock_in >= '2026-09-16'
                                  AND clock_in < '2026-10-01') FROM te)
UNION ALL SELECT 25, 'entries with no employee and no worker',
  (SELECT count(*) FROM te WHERE employee_id IS NULL AND worker_id IS NULL)::text
UNION ALL SELECT 26, 'orphan employee_id (profile missing)',
  (SELECT count(*) FROM te LEFT JOIN profiles p ON p.id = te.employee_id
    WHERE te.employee_id IS NOT NULL AND p.id IS NULL)::text
UNION ALL SELECT 27, 'employee from ANOTHER company',
  (SELECT count(*) FROM te JOIN profiles p ON p.id = te.employee_id
    WHERE p.company_id IS DISTINCT FROM te.company_id)::text
UNION ALL SELECT 28, 'orphan worker_id (worker missing)',
  (SELECT count(*) FROM te LEFT JOIN workers w ON w.id = te.worker_id
    WHERE te.worker_id IS NOT NULL AND w.id IS NULL)::text
UNION ALL SELECT 29, 'orphan project_id (project missing)',
  (SELECT count(*) FROM te LEFT JOIN projects p ON p.id = te.project_id
    WHERE te.project_id IS NOT NULL AND p.id IS NULL)::text
UNION ALL SELECT 30, 'entries without project',
  (SELECT count(*) FROM te WHERE project_id IS NULL)::text
UNION ALL SELECT 31, 'open entries (no clock_out)',
  (SELECT count(*) FROM te WHERE clock_out IS NULL)::text
UNION ALL SELECT 32, 'is_full_day true / false / null',
  (SELECT count(*) FILTER (WHERE is_full_day) || ' / '
       || count(*) FILTER (WHERE NOT is_full_day) || ' / '
       || count(*) FILTER (WHERE is_full_day IS NULL) FROM te)
UNION ALL SELECT 33, 'approval_status breakdown',
  (SELECT string_agg(coalesce(s, 'null') || '=' || n, ', ') FROM (
     SELECT approval_status s, count(*) n FROM te GROUP BY 1) x)
UNION ALL SELECT 34, 'same person + same work day > 1 entry (groups)',
  (SELECT count(*) FROM (SELECT coalesce(employee_id, worker_id), clock_in::date
     FROM te GROUP BY 1, 2 HAVING count(*) > 1) x)::text
UNION ALL SELECT 35, 'created today for a PAST work day (manual backfill)',
  (SELECT count(*) FROM te WHERE created_at >= (SELECT today FROM d)
     AND clock_in < (SELECT today FROM d))::text
UNION ALL SELECT 40, 'expenses: total / created today',
  (SELECT count(*) || ' / ' || count(*) FILTER (WHERE created_at >= (SELECT today FROM d))
     FROM expenses e, c WHERE e.company_id = c.id)
UNION ALL SELECT 41, 'expenses: orphan submitter or project',
  (SELECT count(*) FROM expenses e JOIN c ON e.company_id = c.id
     LEFT JOIN profiles p ON p.id = e.submitted_by_profile_id
     LEFT JOIN projects pr ON pr.id = e.project_id
    WHERE (e.submitted_by_profile_id IS NOT NULL AND p.id IS NULL)
       OR (e.project_id IS NOT NULL AND pr.id IS NULL))::text
UNION ALL SELECT 42, 'mileage_trips: total',
  (SELECT count(*) FROM mileage_trips m, c WHERE m.company_id = c.id)::text
UNION ALL SELECT 50, 'new tables: payroll_periods / manual_comp rows',
  (SELECT count(*) FROM payroll_periods pp, c WHERE pp.company_id = c.id) || ' / '
  || (SELECT count(*) FROM manual_compensations mc, c WHERE mc.company_id = c.id)
UNION ALL SELECT 60, 'DB stats reset at (deletion counters start here)',
  (SELECT stats_reset::text FROM pg_stat_database WHERE datname = current_database())
UNION ALL SELECT 61, 'rows DELETED since stats reset (all companies)',
  (SELECT string_agg(relname || '=' || n_tup_del, ', ' ORDER BY relname)
     FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname IN
     ('companies','company_document_settings','profiles','workers','projects',
      'time_entries','expenses','mileage_trips','worker_projects'))
)
SELECT n, item, val FROM r ORDER BY n;
