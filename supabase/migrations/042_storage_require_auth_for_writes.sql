-- ============================================================================
-- Storage hardening — Part 1 (writes only; reads are a separate, larger
-- follow-up — see the note at the bottom of this file).
-- ============================================================================
--
-- Today, storage.objects has anon_all_* policies (015_storage_upload_policies.sql,
-- 032_receipts_bucket_policy.sql) granting the `anon` role full read/write/
-- delete on the project-photos, task-photos, plans, and receipts buckets,
-- scoped only to bucket_id — not to any path/company. Since these buckets
-- are also marked Public in the Storage dashboard (needed today because
-- there's no other way for this app's anon-key uploads to work), reads via
-- a direct object URL bypass RLS entirely regardless of this migration —
-- that part is a separate, larger fix (see bottom note).
--
-- This migration narrows what it safely can right now: only an authenticated
-- (logged-in) request may upload, overwrite, or delete objects in these
-- buckets — stopping an anonymous request with just the public anon key
-- from doing so via the raw Storage API, which today it can. This is
-- additive (the old anon_all_* policies are untouched here — see migration
-- 044 for the deliberate, separate cutover step) and safe to run multiple
-- times.

GRANT INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_write_project_photos'
  ) THEN
    CREATE POLICY authenticated_write_project_photos ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'project-photos') WITH CHECK (bucket_id = 'project-photos');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_write_task_photos'
  ) THEN
    CREATE POLICY authenticated_write_task_photos ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'task-photos') WITH CHECK (bucket_id = 'task-photos');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_write_plans'
  ) THEN
    CREATE POLICY authenticated_write_plans ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'plans') WITH CHECK (bucket_id = 'plans');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_write_receipts'
  ) THEN
    CREATE POLICY authenticated_write_receipts ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');
  END IF;
END $$;

-- ── KNOWN REMAINING GAP: per-company READ isolation ─────────────────────────
-- Upload paths are NOT consistently prefixed with company_id today — spot
-- checked across the actual upload call sites:
--   KanbanBoard.tsx (task photos):     {companyId}/{taskId}/...
--   expenses/page.tsx (receipts):      {companyId}/...
--   admin/projects/page.tsx (covers):  covers/{projectId}.{ext}   <- no company_id
--   ProfileForm.tsx (avatars):         avatars/{profileId}/...    <- no company_id
--   admin/projects/[id]/page.tsx:      {projectId}/misc-...       <- no company_id
-- Because these buckets are Public, a signed-URL migration (converting them
-- to private buckets and serving files through a server action that mints a
-- short-lived signed URL after checking the caller's company) is the only
-- way to make READS company-isolated too — anyone who has or guesses an
-- object's URL can currently view it regardless of this migration, since
-- public-bucket downloads don't go through storage.objects RLS at all. That
-- is a materially larger change (touches every upload/display call site
-- listed above) and was intentionally left out of this pass per "no broad
-- architectural rewrite" — see the security report for the full writeup.
