-- =============================================================
-- Audit Fixes Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

-- 1. EXCLUSION CONSTRAINT: Prevent double-booking for teachers
-- Blocks two sessions from overlapping for the same teacher.
-- If two concurrent INSERTs try to book the same slot, 
-- PostgreSQL will reject the second one with a constraint violation.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Helper: IMMUTABLE function required for GiST index expressions
-- (make_interval is STABLE, which PostgreSQL rejects in index expressions)
CREATE OR REPLACE FUNCTION public.session_tstzrange(start_at timestamptz, dur_min integer)
RETURNS tstzrange
LANGUAGE sql IMMUTABLE
AS $$ SELECT tstzrange(start_at, start_at + (dur_min * interval '1 minute')); $$;

ALTER TABLE public.sessions
ADD CONSTRAINT no_overlapping_teacher_sessions
EXCLUDE USING gist (
    teacher_id WITH =,
    session_tstzrange(scheduled_at, duration_minutes) WITH &&
)
WHERE (status NOT IN ('cancelled'));

-- 2. UNIQUE CONSTRAINT on leads.email
-- Prevents duplicate entries from the same email in the CRM.
-- Uses ON CONFLICT so existing code won't crash — it will just
-- fail the insert with a 23505 error that can be caught.

ALTER TABLE public.leads
ADD CONSTRAINT leads_email_unique UNIQUE (email);
