-- E_TIME_ENTRIES_COLUMNS.sql  (READ-ONLY)
-- Lists every column slot of time_entries straight from the catalog,
-- including slots of columns that were DROPPED (shown as dropped=true).
SELECT a.attnum                               AS position,
       CASE WHEN a.attisdropped THEN '(dropped column)'
            ELSE a.attname END                AS column_name,
       a.attisdropped                         AS dropped,
       format_type(a.atttypid, a.atttypmod)   AS type,
       CASE a.attgenerated WHEN 's' THEN 'generated' ELSE '' END AS generated
FROM pg_attribute a
WHERE a.attrelid = 'public.time_entries'::regclass
  AND a.attnum > 0
ORDER BY a.attnum;
