-- D_CAA_ENTRY_PROVENANCE.sql  (READ-ONLY; initials/roles only)
SELECT
  left(t.id::text, 8)                                     AS entry,
  t.clock_in::date                                        AS work_day,
  regexp_replace(coalesce(p.full_name, w.full_name, '?'),
                 '(\w)\w*\s*', '\1', 'g')                 AS person,
  to_char(t.created_at, 'MM-DD HH24:MI')                  AS created_utc,
  t.is_manual_entry                                       AS manual,
  coalesce(cb.role, 'none')                               AS created_by_role,
  regexp_replace(coalesce(cb.full_name, '-'),
                 '(\w)\w*\s*', '\1', 'g')                 AS created_by,
  coalesce(kb.role, 'none')                               AS clocked_by_role,
  count(*) OVER (PARTITION BY coalesce(t.employee_id, t.worker_id),
                 t.clock_in::date)                        AS same_day_count
FROM time_entries t
LEFT JOIN profiles p  ON p.id  = t.employee_id
LEFT JOIN workers  w  ON w.id  = t.worker_id
LEFT JOIN profiles cb ON cb.id = t.created_by
LEFT JOIN profiles kb ON kb.id = t.clocked_by_profile_id
WHERE t.company_id = 'd80c39c1-4667-4a3a-9cbc-3704e7e0957a'
UNION ALL
SELECT 'ALL COS', NULL, 'company=' || left(company_id::text, 8),
       min(created_at)::date || '..' || max(created_at)::date, NULL,
       'live=' || count(*), NULL, NULL, NULL
FROM time_entries GROUP BY company_id
UNION ALL
SELECT 'STATS', NULL, 'time_entries', NULL, NULL,
       'ins=' || n_tup_ins, 'del=' || n_tup_del, 'live=' || n_live_tup, NULL
FROM pg_stat_user_tables WHERE relname = 'time_entries'
ORDER BY 1, 2;
