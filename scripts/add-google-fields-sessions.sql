-- ============================================
-- Migration: Add Google Integration Fields to Sessions
-- ============================================
-- Run this in Supabase SQL Editor
-- ============================================

-- Add Google Drive fields
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS drive_doc_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS drive_doc_url TEXT;

-- Add Google Calendar fields
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

-- Note: meet_link already exists in sessions table
-- If it doesn't exist, uncomment the following:
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS meet_link TEXT;

-- Add current_level to profiles if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_level TEXT DEFAULT 'A2';

-- ============================================
-- Verify the changes
-- ============================================
-- Run this to check the columns:
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'sessions' 
-- ORDER BY ordinal_position;
