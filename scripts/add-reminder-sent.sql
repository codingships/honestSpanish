-- ============================================
-- Migration: Add reminder_sent field to sessions
-- ============================================
-- Run this in Supabase SQL Editor

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false;

-- Index for efficient CRON queries
CREATE INDEX IF NOT EXISTS idx_sessions_reminder_pending 
ON sessions (scheduled_at, status, reminder_sent) 
WHERE status = 'scheduled' AND reminder_sent = false;
