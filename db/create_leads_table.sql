-- Supabase SQL Migration: Create Leads Table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL,
    interest TEXT,
    lang TEXT,
    consent_given BOOLEAN NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on Row Level Security (RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can view leads
-- Note: Inserts come from the Server/API using the Service Role Key, which bypasses RLS.
CREATE POLICY "Admins can view leads" ON public.leads
    FOR SELECT
    USING (
        auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')
    );

-- Add comment to table
COMMENT ON TABLE public.leads IS 'Store leads captured from the landing page forms, including GDPR consent records.';
