-- Migration: Add Drive document fields to sessions
-- Run this in Supabase SQL Editor

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS drive_doc_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS drive_doc_link TEXT;

COMMENT ON COLUMN sessions.drive_doc_id IS 'Google Drive document ID for this class exercise document';
COMMENT ON COLUMN sessions.drive_doc_link IS 'Shareable link to the Google Drive document';
