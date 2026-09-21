-- Lets the app upload receipt photos to a new "receipts" storage bucket.
-- MANUAL SETUP REQUIRED (same as project-photos/task-photos/plans):
--   Supabase Dashboard → Storage → New bucket → Name: receipts, Public: ON
-- Marking it Public only allows reads — this policy is what allows the
-- app's anon-key client to actually upload (see 015_storage_upload_policies.sql
-- for why: this app doesn't use Supabase Auth, so anon needs an explicit grant).
-- Safe to run multiple times.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'anon_all_receipts'
  ) THEN
    CREATE POLICY anon_all_receipts ON storage.objects FOR ALL TO anon
      USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');
  END IF;
END $$;
