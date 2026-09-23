-- STEP2_AFTER_038_CHECK.sql — run right after STEP2_APPLY_038_payroll_period_snapshots.sql.
-- READ-ONLY: a single SELECT. It does not create, insert, update, or delete anything.
-- Returns no password hashes, tokens, keys or secrets (only counts, booleans and md5 fingerprints of non-secret columns).
-- PREFILLED with the production PRE baseline (2026-09-23 15:17 UTC). Paste nothing — run as is.
WITH
baseline(metric, value) AS (VALUES
  ('__none__', NULL::text),('companies.count','3'),('companies.fingerprint','9d44c9b931a84d0a6c7461272ea2fbbb'),('expenses.count (created before cutoff)','3'),('expenses.fingerprint (created before cutoff)','1eee9f135ec4d5920da8e9abd94ce0fe'),('profiles.count','26'),('profiles.fingerprint (id/company/email/name/role/status/auth_status/has_password)','6f8c309360ae8120b8b2d131abe30c70'),('profiles.password_hash_present_count','26'),('projects.count','8'),('projects.fingerprint','83e9cfd4926733868e097a42ae9ebf8b'),('rates.fingerprint (profiles + workers daily/hourly rates)','f58439d8ae85fe0904399a1967391469'),('settings.customized_rows_fingerprint (existing saved settings)','853fea584e79545e04c5e35ce387982f'),('settings.effective_values_fingerprint (what the app sees, all companies)','5bfdb9a6a5370215bdfdbcfef4285283'),('time_entries.count (created before cutoff)','8'),('time_entries.fingerprint (created before cutoff)','81adfbe354a696b6463b3c338a1e7439'),('workers.count','18'),('workers.fingerprint','c5287b03d9101f318efa69d5ac2cce3f'),('cutoff','2026-09-23 00:00:00+00')
),
cutoff AS (
  SELECT coalesce((SELECT value FROM baseline WHERE metric = 'cutoff')::timestamptz,
                  date_trunc('day', now())) AS ts
),
caa AS (
  SELECT id, name FROM companies WHERE name ILIKE '%CAA%'
),
cur(metric, value) AS (
            SELECT 'companies.count', (SELECT count(*) FROM companies)::text
  UNION ALL SELECT 'companies.fingerprint', md5(coalesce((SELECT string_agg(id::text || '|' || name, ',' ORDER BY id) FROM companies), ''))
  UNION ALL SELECT 'settings.effective_values_fingerprint (what the app sees, all companies)',
                   md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((c.id)::text,'~'), coalesce((coalesce(s.timezone,'America/New_York'))::text,'~'), coalesce((coalesce(s.enforce_clock_window,false))::text,'~'), coalesce((coalesce(s.clock_in_window_start,'07:00'))::text,'~'), coalesce((coalesce(s.clock_in_window_end,'09:00'))::text,'~'), coalesce((coalesce(s.clock_out_deadline,'18:00'))::text,'~'), coalesce((coalesce(s.home_period_type,'biweekly'))::text,'~'), coalesce((coalesce(s.mileage_rate_per_mile,0.6700))::text,'~')), ',' ORDER BY c.id) FROM companies c LEFT JOIN company_document_settings s ON s.company_id = c.id), ''))
  UNION ALL SELECT 'settings.customized_rows_fingerprint (existing saved settings)',
                   md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((s.company_id)::text,'~'), coalesce((s.logo_storage_path)::text,'~'), coalesce((s.primary_color)::text,'~'), coalesce((s.document_header)::text,'~'), coalesce((s.document_footer)::text,'~'), coalesce((s.currency_code)::text,'~'), coalesce((s.mileage_rate)::text,'~'), coalesce((s.mileage_rate_per_mile)::text,'~'), coalesce((s.timezone)::text,'~'), coalesce((s.enforce_clock_window)::text,'~'), coalesce((s.clock_in_window_start)::text,'~'), coalesce((s.clock_in_window_end)::text,'~'), coalesce((s.clock_out_deadline)::text,'~'), coalesce((s.home_period_type)::text,'~')), ',' ORDER BY s.company_id) FROM company_document_settings s WHERE NOT (s.logo_storage_path IS NULL AND s.primary_color = '#007AFF' AND s.document_header IS NULL AND s.document_footer IS NULL AND s.currency_code = 'USD' AND s.mileage_rate = 0.6700 AND s.mileage_rate_per_mile = 0.6700 AND s.timezone = 'America/New_York' AND s.enforce_clock_window = false AND s.clock_in_window_start = '07:00' AND s.clock_in_window_end = '09:00' AND s.clock_out_deadline = '18:00' AND s.home_period_type = 'biweekly')), ''))
  UNION ALL SELECT 'profiles.count', (SELECT count(*) FROM profiles)::text
  UNION ALL SELECT 'profiles.fingerprint (id/company/email/name/role/status/auth_status/has_password)', md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((id)::text,'~'), coalesce((company_id)::text,'~'), coalesce((email)::text,'~'), coalesce((full_name)::text,'~'), coalesce((role)::text,'~'), coalesce((status)::text,'~'), coalesce((auth_status)::text,'~'), coalesce(((password_hash IS NOT NULL AND password_hash <> ''))::text,'~')), ',' ORDER BY id) FROM profiles), ''))
  UNION ALL SELECT 'profiles.password_hash_present_count',
                   (SELECT count(*) FILTER (WHERE password_hash IS NOT NULL AND password_hash <> '') FROM profiles)::text
  UNION ALL SELECT 'rates.fingerprint (profiles + workers daily/hourly rates)',
                   md5(md5(coalesce((SELECT string_agg(concat_ws('|', coalesce(('p')::text,'~'), coalesce((id)::text,'~'), coalesce((daily_rate)::text,'~'), coalesce((hourly_rate)::text,'~')), ',' ORDER BY id) FROM profiles), '')) || md5(coalesce((SELECT string_agg(concat_ws('|', coalesce(('w')::text,'~'), coalesce((id)::text,'~'), coalesce((daily_rate)::text,'~'), coalesce((hourly_rate)::text,'~')), ',' ORDER BY id) FROM workers), '')))
  UNION ALL SELECT 'workers.count', (SELECT count(*) FROM workers)::text
  UNION ALL SELECT 'workers.fingerprint', md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((id)::text,'~'), coalesce((company_id)::text,'~'), coalesce((full_name)::text,'~'), coalesce((status)::text,'~')), ',' ORDER BY id) FROM workers), ''))
  UNION ALL SELECT 'projects.count', (SELECT count(*) FROM projects)::text
  UNION ALL SELECT 'projects.fingerprint', md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((id)::text,'~'), coalesce((company_id)::text,'~'), coalesce((name)::text,'~')), ',' ORDER BY id) FROM projects), ''))
  UNION ALL SELECT 'time_entries.count (created before cutoff)',
                   (SELECT count(*) FROM time_entries WHERE created_at < (SELECT ts FROM cutoff))::text
  UNION ALL SELECT 'time_entries.fingerprint (created before cutoff)',
                   md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((id)::text,'~'), coalesce((company_id)::text,'~'), coalesce((employee_id)::text,'~'), coalesce((worker_id)::text,'~'), coalesce((project_id)::text,'~'), coalesce((clock_in)::text,'~'), coalesce((clock_out)::text,'~'), coalesce((is_full_day)::text,'~'), coalesce((approval_status)::text,'~'), coalesce((notes)::text,'~')), ',' ORDER BY id) FROM time_entries WHERE created_at < (SELECT ts FROM cutoff)), ''))
  UNION ALL SELECT 'expenses.count (created before cutoff)',
                   (SELECT count(*) FROM expenses WHERE created_at < (SELECT ts FROM cutoff))::text
  UNION ALL SELECT 'expenses.fingerprint (created before cutoff)',
                   md5(coalesce((SELECT string_agg(concat_ws('|', coalesce((id)::text,'~'), coalesce((company_id)::text,'~'), coalesce((amount)::text,'~'), coalesce((expense_date)::text,'~'), coalesce((description)::text,'~')), ',' ORDER BY id) FROM expenses WHERE created_at < (SELECT ts FROM cutoff)), ''))
),
report(ord, section, check_name, value, result) AS (
  SELECT 0, 'RUN', 'executed at', now()::text, 'INFO'
  UNION ALL SELECT 0, 'RUN', 'PREFILLED file: baseline rows loaded (expect 17)', (SELECT count(*) FROM baseline WHERE metric <> '__none__')::text,
                   CASE WHEN (SELECT count(*) FROM baseline WHERE metric <> '__none__') = 17 THEN 'PASS' ELSE 'STOP' END
  UNION ALL SELECT 40, '037', 'pay_system column exists', (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_document_settings' AND column_name='pay_system'))::text, CASE WHEN (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_document_settings' AND column_name='pay_system')) = true THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 41, '037', 'pay_system CHECK allows only daily/hourly',
                   (SELECT string_agg(pg_get_constraintdef(oid), '; ') FROM pg_constraint
                    WHERE conrelid = 'public.company_document_settings'::regclass AND contype = 'c'
                      AND pg_get_constraintdef(oid) LIKE '%pay_system%'),
                   CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.company_document_settings'::regclass
                      AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%pay_system%daily%hourly%') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 42, '037', 'every company has a settings row (companies / settings rows)',
                   (SELECT count(*) FROM companies) || ' / ' || (SELECT count(*) FROM company_document_settings),
                   CASE WHEN NOT EXISTS (SELECT 1 FROM companies c WHERE NOT EXISTS
                      (SELECT 1 FROM company_document_settings s WHERE s.company_id = c.id)) THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 43, '037', 'pay_system per company (all companies)',
                   (SELECT string_agg(c.name || '=' || coalesce(to_jsonb(s)->>'pay_system', 'NULL'), '; ' ORDER BY c.name)
                    FROM companies c LEFT JOIN company_document_settings s ON s.company_id = c.id), 'INFO'
  UNION ALL SELECT 44, '037', 'CAA pay_system (column did not exist before 037, so any non-NULL value was inferred by 037)',
                   coalesce((SELECT to_jsonb(s)->>'pay_system' FROM company_document_settings s
                             WHERE s.company_id = (SELECT id FROM caa LIMIT 1)), 'NULL (left for admin to choose in Settings)'),
                   'INFO'

  UNION ALL SELECT 50, '038', 'payroll_periods exists', ((to_regclass('public.payroll_periods') IS NOT NULL))::text, CASE WHEN ((to_regclass('public.payroll_periods') IS NOT NULL)) = true THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 51, '038', 'payroll_period_entries exists', ((to_regclass('public.payroll_period_entries') IS NOT NULL))::text, CASE WHEN ((to_regclass('public.payroll_period_entries') IS NOT NULL)) = true THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 52, '038', 'RLS enabled on both', (coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.payroll_periods')), false) AND coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.payroll_period_entries')), false))::text, CASE WHEN (coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.payroll_periods')), false) AND coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.payroll_period_entries')), false)) = true THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 53, '038', 'anon_all policy on both (app still runs as anon until the later security phase)',
                   (EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payroll_periods' AND policyname='anon_all') AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payroll_period_entries' AND policyname='anon_all'))::text, CASE WHEN (EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payroll_periods' AND policyname='anon_all') AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payroll_period_entries' AND policyname='anon_all')) = true THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 54, '038', 'unique (company_id, period_start, period_end) on payroll_periods',
                   (EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.payroll_periods') AND contype = 'u'))::text, CASE WHEN (EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.payroll_periods') AND contype = 'u')) = true THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 55, '038', 'no payroll periods finalized yet (payroll_periods / payroll_period_entries rows)',
                   (SELECT count(*) FROM payroll_periods) || ' / ' || (SELECT count(*) FROM payroll_period_entries), 'INFO'
  UNION ALL SELECT 100, 'UNCHANGED', c.metric, c.value,
                   CASE WHEN NOT EXISTS (SELECT 1 FROM baseline WHERE metric <> '__none__') THEN 'STOP: BASELINE not pasted'
                        WHEN b.value IS NULL THEN 'STOP: metric missing from BASELINE'
                        WHEN b.value = c.value THEN 'PASS'
                        ELSE 'FAIL (before: ' || b.value || ')' END
  FROM cur c LEFT JOIN baseline b ON b.metric = c.metric
  UNION ALL SELECT 99, 'UNCHANGED', 'cutoff used for time_entries / expenses', (SELECT ts FROM cutoff)::text, 'INFO'
)
SELECT section, check_name, value, result
FROM (
  SELECT -1 AS ord, 'OVERALL' AS section, 'verdict' AS check_name,
         (SELECT count(*) FILTER (WHERE result LIKE 'FAIL%') || ' FAIL, ' || count(*) FILTER (WHERE result LIKE 'STOP%') || ' STOP, '
                 || count(*) FILTER (WHERE result = 'PASS') || ' PASS' FROM report) AS value,
         CASE WHEN EXISTS (SELECT 1 FROM report WHERE result LIKE 'FAIL%' OR result LIKE 'STOP%') THEN 'STOP — do not continue'
              ELSE 'PASS — ok to continue' END AS result
  UNION ALL SELECT ord, section, check_name, value, result FROM report
) r
ORDER BY ord, section, check_name;
