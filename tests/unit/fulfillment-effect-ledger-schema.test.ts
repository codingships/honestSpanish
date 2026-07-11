import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260711192817_fulfillment_effect_ledger.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

function functionBlock(source: string, name: string, nextMarker: string): string {
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    const end = source.indexOf(nextMarker, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('fulfillment effect ledger schema', () => {
    it('defines one constrained effect identity per fulfillment job', () => {
        for (const source of [migration, schema]) {
            expect(source).toContain('CREATE TABLE ' + (source === migration ? 'public.' : '') + 'fulfillment_effects (');
            expect(source).toContain('job_id UUID NOT NULL REFERENCES ' + (source === migration ? 'public.' : '') + 'fulfillment_jobs(id) ON DELETE CASCADE');
            expect(source).toContain('CONSTRAINT fulfillment_effects_job_effect_unique UNIQUE (job_id, effect_key)');
            expect(source).toContain("payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$')");
            expect(source).toContain("status IN ('pending', 'processing', 'succeeded', 'failed', 'ambiguous', 'manual_review')");
            expect(source).toContain('attempt_generation BIGINT NOT NULL DEFAULT 0');
            expect(source).toContain('CONSTRAINT fulfillment_effects_lease_state_check');
            expect(source).toContain('CONSTRAINT fulfillment_effects_attempt_state_check');
            expect(source).toContain('CONSTRAINT fulfillment_effects_error_state_check');
            expect(source).toContain('CONSTRAINT fulfillment_effects_completion_state_check');
        }

        expect(migration).not.toMatch(/CREATE\s+SEQUENCE\s+.*fulfillment_effects/i);
    });

    it('indexes only claimable or leased rows and keeps the table service-role-only', () => {
        for (const source of [migration, schema]) {
            expect(source).toContain('fulfillment_effects_claimable_lease_idx');
            expect(source).toContain("WHERE status IN ('pending', 'failed', 'processing')");
            expect(source).toContain('ALTER TABLE ' + (source === migration ? 'public.' : '') + 'fulfillment_effects ENABLE ROW LEVEL SECURITY');
            expect(source).toContain('REVOKE ALL ON TABLE ' + (source === migration ? 'public.' : '') + 'fulfillment_effects FROM PUBLIC, anon, authenticated');
            expect(source).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ' + (source === migration ? 'public.' : '') + 'fulfillment_effects TO service_role');
        }
    });

    it('claims with an atomic row lock, immutable identity and attempt fencing', () => {
        const claim = functionBlock(
            migration,
            'claim_fulfillment_effect',
            'CREATE OR REPLACE FUNCTION public.finalize_fulfillment_effect',
        );

        for (const snippet of [
            'SECURITY DEFINER',
            "SET search_path = ''",
            'ON CONFLICT (job_id, effect_key) DO NOTHING',
            'FOR UPDATE',
            'v_effect.effect_type IS DISTINCT FROM p_effect_type',
            'v_effect.payload_sha256 IS DISTINCT FROM p_payload_sha256',
            "v_effect.status IN ('succeeded', 'ambiguous', 'manual_review')",
            "SET status = 'ambiguous'",
            "'code', 'lease_expired_before_finalization'",
            "v_effect.status NOT IN ('pending', 'failed')",
            'attempt_generation = v_effect.attempt_generation + 1',
            'lease_owner = p_lease_owner',
            'pg_catalog.make_interval(secs => p_lease_seconds)',
            'effect.attempt_generation = v_effect.attempt_generation',
        ]) {
            expect(claim).toContain(snippet);
        }

        expect(claim).not.toMatch(/\b(fetch|resend|google|calendar|drive)\b/i);
    });

    it('finalizes only the exact live lease owner and generation', () => {
        const finalize = functionBlock(
            migration,
            'finalize_fulfillment_effect',
            'REVOKE ALL ON FUNCTION public.claim_fulfillment_effect',
        );

        for (const snippet of [
            'SECURITY DEFINER',
            "SET search_path = ''",
            "p_outcome NOT IN ('succeeded', 'failed', 'ambiguous', 'manual_review')",
            "effect.status = 'processing'",
            'effect.lease_owner = p_lease_owner',
            'effect.attempt_generation = p_attempt_generation',
            'effect.lease_expires_at > v_now',
            'GET DIAGNOSTICS v_updated_count = ROW_COUNT',
            'RETURN v_updated_count = 1',
        ]) {
            expect(finalize).toContain(snippet);
        }
    });

    it('revokes both RPCs from public roles and grants only service_role execution', () => {
        for (const signature of [
            'public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)',
            'public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB)',
        ]) {
            expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
            expect(migration).toContain('FROM PUBLIC, anon, authenticated;');
            expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`);
            expect(migration).not.toContain(`GRANT EXECUTE ON FUNCTION ${signature}\n    TO authenticated`);
        }
    });

    it('keeps the canonical schema and generated-shape TypeScript contract aligned', () => {
        for (const snippet of [
            'CREATE OR REPLACE FUNCTION public.claim_fulfillment_effect',
            'CREATE OR REPLACE FUNCTION public.finalize_fulfillment_effect',
            'CREATE TRIGGER update_fulfillment_effects_updated_at',
            "SET status = 'ambiguous'",
            'effect.lease_expires_at > v_now',
        ]) {
            expect(schema).toContain(snippet);
        }

        for (const snippet of [
            'fulfillment_effects: {',
            'attempt_generation: number',
            'effect_key: string',
            'effect_type: string',
            'error: Json | null',
            'payload_sha256: string',
            'result: Json | null',
            'foreignKeyName: "fulfillment_effects_job_id_fkey"',
            'claim_fulfillment_effect: {',
            'finalize_fulfillment_effect: {',
            'p_lease_seconds?: number',
            'p_attempt_generation: number',
        ]) {
            expect(databaseTypes).toContain(snippet);
        }
    });
});
