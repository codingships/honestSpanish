import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/launch/supabase-processed-at-readonly-preflight.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const finalApprovalQueue = readFileSync('scripts/launch/final-approval-queue.ts', 'utf8');
const manualRunbook = readFileSync('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'utf8');

describe('Supabase processed_at read-only preflight', () => {
    it('is wired as a pnpm launch command and final-window read-only refresh', () => {
        expect(packageJson).toContain('"launch:supabase-processed-at-readonly-preflight": "tsx scripts/launch/supabase-processed-at-readonly-preflight.ts"');
        expect(finalApprovalQueue).toContain('launch:supabase-processed-at-readonly-preflight');
        expect(manualRunbook).toContain('pnpm launch:supabase-processed-at-readonly-preflight');
        expect(manualRunbook).toContain('outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md');
    });

    it('uses psql with strict read-only and timeout guardrails', () => {
        for (const snippet of [
            "spawnSync('psql'",
            "default_transaction_read_only=on",
            "statement_timeout=15000",
            "lock_timeout=5000",
            "PGCONNECT_TIMEOUT: '10'",
            "'-X'",
            "'-w'",
            "'ON_ERROR_STOP=1'",
            "windowsHide: true",
            "timeout: 30_000",
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).not.toContain("spawnSync('supabase'");
        expect(source).not.toContain('spawnSync("supabase"');
        expect(source).not.toContain('ALTER TABLE');
        expect(source).not.toContain('UPDATE public');
        expect(source).not.toContain('DELETE FROM');
        expect(source).not.toContain('INSERT INTO');
    });

    it('stores machine-readable aggregate evidence without secret values', () => {
        for (const snippet of [
            'machine-preflight.sql',
            'migration_versions',
            "coalesce(string_agg(version, ',' order by version), '<NONE>')",
            'processed_at_default',
            "coalesce((",
            "'<NULL>'",
            'json_build_object',
            'invalid_status',
            'processing_with_processed_at',
            'normalizeJsonText',
            'parseMachineOutput',
            'production_processed_at_default',
            'staging_processed_at_default',
            'no database URL or secret values stored',
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).toContain('SUPABASE_DB_URL');
        expect(source).not.toContain('console.log(dbUrl');
        expect(source).not.toContain('writeFileSync(outputPath, dbUrl');
        expect(source).not.toContain('STRIPE_SECRET_KEY');
        expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    });
});
