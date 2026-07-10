import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260710150000_staging_integration_smoke_runs.sql',
    'utf8',
).replace(/\r\n/g, '\n').trim();
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const schemaBlock = schema.slice(
    schema.indexOf('CREATE TABLE public.staging_integration_smoke_runs ('),
    schema.indexOf('-- =============================================\n-- SEED DATA:'),
).trim();

describe('staging integration smoke schema', () => {
    it('keeps the official schema source synchronized with the migration', () => {
        expect(schemaBlock).toBe(migration);
    });

    it('fences exact jobs and never makes them due to the generic processor', () => {
        expect(migration).toContain("v_job.run_at IS DISTINCT FROM TIMESTAMPTZ '2099-01-01 00:00:00+00'");
        expect(migration).toContain("v_job.payload->'sendEmail' IS DISTINCT FROM 'false'::JSONB");
        expect(migration).toContain('v_job.session_id IS DISTINCT FROM v_run.session_id');
        expect(migration).toContain('job.status = v_job.status');
        expect(migration).toContain('finalize_staging_integration_smoke_job');
        expect(migration).not.toMatch(/DELETE FROM public[.]staging_integration_smoke_leases/i);
    });

    it('qualifies the lease expiry column against the RETURNS TABLE output name', () => {
        expect(migration).toContain('UPDATE public.staging_integration_smoke_leases AS lease');
        expect(migration).toContain('AND lease.expires_at > v_now');
        expect(migration).toContain('RETURNING lease.expires_at INTO v_expires_at');
        expect(migration).not.toContain('AND expires_at > v_now');
    });

    it('persists one stable email identity with lease and attempt fencing', () => {
        expect(migration).toContain("'staging-integration-smoke/email/' || run_id::TEXT");
        expect(migration).toContain('email_attempt_generation = email_attempt_generation + 1');
        expect(migration).toContain('AND email_attempt_generation = p_attempt_generation');
        expect(migration).toContain('IF NOT v_run.email_budget_reserved THEN');
        expect(migration).toContain("v_run.email_first_attempt_at <= v_now - INTERVAL '23 hours'");
        expect(migration).toContain('finalize_staging_integration_smoke_email');
    });
});
