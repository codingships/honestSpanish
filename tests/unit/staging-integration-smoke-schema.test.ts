import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const initialMigration = readFileSync(
    'supabase/migrations/20260710150000_staging_integration_smoke_runs.sql',
    'utf8',
).replace(/\r\n/g, '\n').trim();
const hostnameMigration = readFileSync(
    'supabase/migrations/20260713161300_allow_staging_custom_hostname.sql',
    'utf8',
).replace(/\r\n/g, '\n').trim();
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const schemaBlock = schema.slice(
    schema.indexOf('CREATE TABLE public.staging_integration_smoke_runs ('),
    schema.indexOf('-- =============================================\n-- SEED DATA:'),
).trim();

function normalizeBaseHostConstraint(source: string): string {
    const constraintStart = source.indexOf('    base_host TEXT NOT NULL');
    const nextColumnStart = source.indexOf('    student_id UUID NOT NULL', constraintStart);

    if (constraintStart < 0 || nextColumnStart < 0) {
        throw new Error('staging smoke base_host constraint not found');
    }

    return `${source.slice(0, constraintStart)}    base_host TEXT NOT NULL CHECK (__BASE_HOST_POLICY__),\n${source.slice(nextColumnStart)}`;
}

describe('staging integration smoke schema', () => {
    it('keeps the official schema source synchronized with the initial migration apart from the later hostname policy', () => {
        expect(normalizeBaseHostConstraint(schemaBlock)).toBe(normalizeBaseHostConstraint(initialMigration));
    });

    it('adds only the exact custom hostname while preserving legacy Worker hosts', () => {
        const finalConstraint = [
            'ADD CONSTRAINT staging_integration_smoke_runs_base_host_check CHECK (',
            "        base_host = 'espanolhonesto-staging.alindev95.workers.dev'",
            "        OR base_host = 'staging.espanolhonesto.com'",
            "        OR base_host ~ '^[a-z0-9]+(?:-[a-z0-9]+)*-espanolhonesto-staging[.]alindev95[.]workers[.]dev$'",
            '    );',
        ].join('\n');

        expect(hostnameMigration).toContain(
            'DROP CONSTRAINT staging_integration_smoke_runs_base_host_check',
        );
        expect(hostnameMigration).toContain(finalConstraint);
        expect(schemaBlock).toContain(
            'base_host TEXT NOT NULL CONSTRAINT staging_integration_smoke_runs_base_host_check CHECK (',
        );
        expect(schemaBlock).toContain("base_host = 'staging.espanolhonesto.com'");
        expect(hostnameMigration).not.toMatch(/staging[.]espanolhonesto[.]com[%*]/);
        expect(hostnameMigration).not.toContain("base_host LIKE");
    });

    it('fences exact jobs and never makes them due to the generic processor', () => {
        expect(initialMigration).toContain("v_job.run_at IS DISTINCT FROM TIMESTAMPTZ '2099-01-01 00:00:00+00'");
        expect(initialMigration).toContain("v_job.payload->'sendEmail' IS DISTINCT FROM 'false'::JSONB");
        expect(initialMigration).toContain('v_job.session_id IS DISTINCT FROM v_run.session_id');
        expect(initialMigration).toContain('job.status = v_job.status');
        expect(initialMigration).toContain('finalize_staging_integration_smoke_job');
        expect(initialMigration).not.toMatch(/DELETE FROM public[.]staging_integration_smoke_leases/i);
    });

    it('qualifies the lease expiry column against the RETURNS TABLE output name', () => {
        expect(initialMigration).toContain('UPDATE public.staging_integration_smoke_leases AS lease');
        expect(initialMigration).toContain('AND lease.expires_at > v_now');
        expect(initialMigration).toContain('RETURNING lease.expires_at INTO v_expires_at');
        expect(initialMigration).not.toContain('AND expires_at > v_now');
    });

    it('persists one stable email identity with lease and attempt fencing', () => {
        expect(initialMigration).toContain("'staging-integration-smoke/email/' || run_id::TEXT");
        expect(initialMigration).toContain('email_attempt_generation = email_attempt_generation + 1');
        expect(initialMigration).toContain('AND email_attempt_generation = p_attempt_generation');
        expect(initialMigration).toContain('IF NOT v_run.email_budget_reserved THEN');
        expect(initialMigration).toContain("v_run.email_first_attempt_at <= v_now - INTERVAL '23 hours'");
        expect(initialMigration).toContain('finalize_staging_integration_smoke_email');
    });
});
