-- Migration: Add Calendar/Meet fields to sessions
-- Run this in Supabase SQL Editor

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS google_meet_link TEXT;

COMMENT ON COLUMN sessions.google_calendar_event_id IS 'Google Calendar event ID for this class';
COMMENT ON COLUMN sessions.google_meet_link IS 'Google Meet link generated for this class';
