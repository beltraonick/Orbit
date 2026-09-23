-- B_CAA_TIME_ENTRIES.sql  (READ-ONLY; initials only, no emails/secrets)
SELECT
  left(t.id::text, 8)                                   AS entry,
  CASE WHEN t.employee_id IS NOT NULL THEN 'employee' ELSE 'worker' END AS who,
  regexp_replace(coalesce(p.full_name, w.full_name, '?'),
                 '(\w)\w*\s*', '\1', 'g')               AS initials,
  (p.id IS NOT NULL OR w.id IS NOT NULL)                AS person_ok,
  coalesce(pr.name, '(none)')                           AS project,
  t.clock_in::date                                      AS work_day,
  to_char(t.clock_in, 'HH24:MI')                        AS clock_in,
  to_char(t.clock_out, 'HH24:MI')                       AS clock_out,
  CASE t.is_full_day WHEN true THEN 'full' WHEN false THEN 'half'
                     ELSE 'null' END                    AS day_type,
  t.approval_status                                     AS status,
  (t.notes IS NOT NULL AND t.notes <> '')               AS has_notes,
  to_char(t.created_at, 'YYYY-MM-DD HH24:MI')           AS created_utc
FROM time_entries t
LEFT JOIN profiles p  ON p.id = t.employee_id
LEFT JOIN workers  w  ON w.id = t.worker_id
LEFT JOIN projects pr ON pr.id = t.project_id
WHERE t.company_id = 'd80c39c1-4667-4a3a-9cbc-3704e7e0957a'
ORDER BY t.clock_in;
