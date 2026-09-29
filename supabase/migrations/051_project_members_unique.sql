-- ============================================================================
-- Prevent a person from being added to the same project more than once.
-- ============================================================================
--
-- The admin Employees page deletes-then-reinserts a profile's project_members
-- rows on every save; with no uniqueness enforced, a duplicate project_id in
-- that insert (or a retried/duplicated request) silently creates a second
-- row for the same project+person, which then shows that person twice
-- anywhere the roster is listed (e.g. Team Clock), even though their
-- attendance/clock-in data is unaffected — every time_entries row still
-- points at one real person.
--
-- Cleans up existing duplicates first (kept: the row with the lowest ctid,
-- since project_members carries no other distinguishing data — see
-- 047_project_members_rls.sql), then adds a unique index so a duplicate can
-- never be created again. Guarded by table/column existence, safe to run
-- multiple times.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_members')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_members' AND column_name = 'project_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_members' AND column_name = 'profile_id') THEN
    EXECUTE '
      DELETE FROM project_members a
      USING project_members b
      WHERE a.ctid < b.ctid
        AND a.project_id = b.project_id
        AND a.profile_id = b.profile_id
    ';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_id_profile_id_key ON project_members(project_id, profile_id)';
  END IF;
END $$;
