-- =============================================
-- PROGRESSIVE DRIVE ACCESS
-- =============================================
--
-- Goals:
-- 1. Persist the shared folder URL separately from the folder ID.
-- 2. Support progressive hardening from link-based access to explicit Google account access.
-- 3. Keep the invariant that a linked Google account only exists when the student already has a folder.

ALTER TABLE public.profiles_private
    ADD COLUMN IF NOT EXISTS drive_folder_url TEXT,
    ADD COLUMN IF NOT EXISTS google_account_email TEXT;

UPDATE public.profiles_private
SET drive_folder_url = CONCAT('https://drive.google.com/drive/folders/', drive_folder_id)
WHERE drive_folder_id IS NOT NULL
  AND drive_folder_url IS NULL;

ALTER TABLE public.profiles_private
    DROP CONSTRAINT IF EXISTS profiles_private_google_account_email_requires_folder;

ALTER TABLE public.profiles_private
    ADD CONSTRAINT profiles_private_google_account_email_requires_folder
    CHECK (google_account_email IS NULL OR drive_folder_id IS NOT NULL);
