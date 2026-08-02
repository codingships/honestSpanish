\set ON_ERROR_STOP on

DO $$
BEGIN
    CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$$;

DO $$
BEGIN
    CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$$;

DO $$
BEGIN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    email_confirmed_at TIMESTAMPTZ,
    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL
STABLE
SET search_path = ''
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
