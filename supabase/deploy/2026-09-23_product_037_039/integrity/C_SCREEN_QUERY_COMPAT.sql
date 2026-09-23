-- C_SCREEN_QUERY_COMPAT.sql  (READ-ONLY)
-- Every table.column and every relation the screens request, checked
-- against the live schema, plus the row counts each screen would load.
WITH need(screen, tbl, col) AS (VALUES
 ('Settings','company_document_settings','timezone'),
 ('Settings','company_document_settings','enforce_clock_window'),
 ('Settings','company_document_settings','clock_in_window_start'),
 ('Settings','company_document_settings','clock_in_window_end'),
 ('Settings','company_document_settings','clock_out_deadline'),
 ('Settings','company_document_settings','home_period_type'),
 ('Settings','company_document_settings','pay_system'),
 ('Settings','company_document_settings','mileage_rate_per_mile'),
 ('Settings','companies','default_hourly_rate'),
 ('Payroll','time_entries','hours_worked'),
 ('Payroll','time_entries','is_full_day'),
 ('Payroll','time_entries','notes'),
 ('Payroll','time_entries','worker_id'),
 ('Payroll','profiles','daily_rate'),
 ('Payroll','workers','hourly_rate'),
 ('Payroll','payroll_periods','finalized_by'),
 ('Payroll','payroll_periods','grand_total'),
 ('ManualComp','manual_compensations','compensation_date'),
 ('ManualComp','manual_compensations','payroll_period_id'),
 ('ManualComp','manual_compensations','created_by'),
 ('Time','time_entries','city'),
 ('Time','time_entries','state'),
 ('Time','time_entries','approval_status'),
 ('Time','time_entries','clocked_by_profile_id'),
 ('Reports','payroll_period_entries','source_time_entry_id'),
 ('Reports','expenses','expense_type'),
 ('Reports','expenses','approval_status'),
 ('Reports','expenses','category_id'),
 ('Reports','expenses','submitted_by_profile_id'),
 ('Reports','mileage_trips','purpose'),
 ('Reports','mileage_trips','employee_profile_id'),
 ('Reports','mileage_trips','reimbursement_amount'),
 ('Home','profiles','permissions'),
 ('Pay','payroll_period_entries','person_id'),
 ('Pay','payroll_period_entries','overtime_pay')
),
fk(screen, tbl, col, ref) AS (VALUES
 ('Payroll/Time/Reports','time_entries','project_id','projects'),
 ('Payroll/Time/Reports','time_entries','employee_id','profiles'),
 ('Payroll/Time/Reports','time_entries','worker_id','workers'),
 ('Time','time_entries','clocked_by_profile_id','profiles'),
 ('Payroll','payroll_periods','finalized_by','profiles'),
 ('ManualComp','manual_compensations','project_id','projects'),
 ('ManualComp','manual_compensations','created_by','profiles'),
 ('Pay','payroll_period_entries','payroll_period_id','payroll_periods'),
 ('Reports','expenses','category_id','expense_categories'),
 ('Reports','expenses','project_id','projects'),
 ('Reports','expenses','submitted_by_profile_id','profiles'),
 ('Reports','mileage_trips','employee_profile_id','profiles')
),
caa AS (SELECT 'd80c39c1-4667-4a3a-9cbc-3704e7e0957a'::uuid AS id),
r(n, check_name, val, result) AS (
 SELECT 1, 'columns requested by screens: present / required',
   (SELECT count(i.column_name) || ' / ' || count(*) FROM need n
      LEFT JOIN information_schema.columns i ON i.table_schema = 'public'
       AND i.table_name = n.tbl AND i.column_name = n.col),
   CASE WHEN (SELECT count(*) FROM need n WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public'
       AND i.table_name = n.tbl AND i.column_name = n.col)) = 0
     THEN 'PASS' ELSE 'FAIL' END
 UNION ALL SELECT 2, 'missing columns (screen: table.column)',
   coalesce((SELECT string_agg(n.screen || ': ' || n.tbl || '.' || n.col, '; ')
     FROM need n WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i
      WHERE i.table_schema = 'public' AND i.table_name = n.tbl
        AND i.column_name = n.col)), 'none'), 'INFO'
 UNION ALL SELECT 3, 'relations (FKs) used for joins: present / required',
   (SELECT count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM pg_constraint k
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.conrelid = to_regclass('public.' || f.tbl)
        AND a.attname = f.col AND k.confrelid = to_regclass('public.' || f.ref)))
     || ' / ' || count(*) FROM fk f),
   CASE WHEN (SELECT count(*) FROM fk f WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.conrelid = to_regclass('public.' || f.tbl)
        AND a.attname = f.col AND k.confrelid = to_regclass('public.' || f.ref))) = 0
     THEN 'PASS' ELSE 'FAIL' END
 UNION ALL SELECT 4, 'missing relations',
   coalesce((SELECT string_agg(f.tbl || '.' || f.col || '->' || f.ref, '; ')
     FROM fk f WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.conrelid = to_regclass('public.' || f.tbl)
        AND a.attname = f.col AND k.confrelid = to_regclass('public.' || f.ref))),
     'none'), 'INFO'
 UNION ALL SELECT 5, 'anon can read the new tables (policy anon_all)',
   (SELECT count(*) FROM pg_policies WHERE policyname = 'anon_all'
     AND tablename IN ('payroll_periods','payroll_period_entries',
                       'manual_compensations'))::text || ' / 3',
   CASE WHEN (SELECT count(*) FROM pg_policies WHERE policyname = 'anon_all'
     AND tablename IN ('payroll_periods','payroll_period_entries',
                       'manual_compensations')) = 3 THEN 'PASS' ELSE 'FAIL' END
 UNION ALL SELECT 10, 'Settings row the screen loads (CAA)',
   (SELECT concat_ws(' | ', s.timezone, 'window=' || s.enforce_clock_window,
      s.clock_in_window_start || '-' || s.clock_in_window_end,
      'out=' || s.clock_out_deadline, s.home_period_type,
      'mileage=' || s.mileage_rate_per_mile,
      'pay_system=' || coalesce(s.pay_system, 'NULL'))
      FROM company_document_settings s, caa WHERE s.company_id = caa.id), 'INFO'
 UNION ALL SELECT 11, 'Payroll Sep 1-15: closed entries the screen loads',
   (SELECT count(*) FROM time_entries t, caa WHERE t.company_id = caa.id
     AND t.clock_out IS NOT NULL AND t.clock_in >= '2026-09-01'
     AND t.clock_in < '2026-09-16')::text, 'INFO'
 UNION ALL SELECT 12, 'Payroll Sep 16-30: closed entries the screen loads',
   (SELECT count(*) FROM time_entries t, caa WHERE t.company_id = caa.id
     AND t.clock_out IS NOT NULL AND t.clock_in >= '2026-09-16'
     AND t.clock_in < '2026-10-01')::text, 'INFO'
 UNION ALL SELECT 13, 'Time & Attendance: open entries (clocked in now)',
   (SELECT count(*) FROM time_entries t, caa WHERE t.company_id = caa.id
     AND t.clock_out IS NULL)::text, 'INFO'
 UNION ALL SELECT 14, 'Manual Comp Sep 1-15 / Sep 16-30 rows',
   (SELECT count(*) FILTER (WHERE compensation_date <= '2026-09-15') || ' / '
        || count(*) FILTER (WHERE compensation_date >= '2026-09-16')
      FROM manual_compensations m, caa WHERE m.company_id = caa.id), 'INFO'
 UNION ALL SELECT 15, 'Employees whose Home/Days/Pay profile lookup resolves',
   (SELECT count(*) FILTER (WHERE x.n = 1) || ' of ' || count(*) FROM (
      SELECT p.email, (SELECT count(*) FROM profiles q
                        WHERE q.email = p.email) n
      FROM profiles p, caa WHERE p.company_id = caa.id
        AND p.role = 'employee') x), 'INFO'
)
SELECT check_name, val, result FROM r ORDER BY n;
