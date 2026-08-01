import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260801213000_checkout_v2_cycle_progress.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const types = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

describe('Checkout V2 cycle progress schema contract', () => {
    for (const [name, sql] of [
        ['migration', migration],
        ['canonical schema', schema],
    ] as const) {
        it(`${name} preserves quota semantics and derives consumption from session facts`, () => {
            expect(sql).toContain('CREATE VIEW public.checkout_v2_session_consumption');
            expect(sql).toContain("session.status IN ('completed', 'no_show')");
            expect(sql).toMatch(
                /session\.scheduled_at\s*< session\.cancelled_at \+ INTERVAL '24 hours'/,
            );
            expect(sql).toContain("THEN 'timely_student_cancellation'");
            expect(sql).toContain("THEN 'guarantee_refund_cancellation'");
            expect(sql).toContain('guarantee_operation.terminated_at IS NOT NULL');
            expect(sql).toContain('guarantee_operation.id IS NULL');
            if (name === 'migration') {
                expect(sql).not.toMatch(
                    /(?:UPDATE|SET)\s+(?:public\.)?subscriptions[\s\S]{0,120}sessions_used/i,
                );
            }
        });

        it(`${name} makes restoration append-only, guarded and deliberately write-internal`, () => {
            expect(sql).toContain('CREATE TABLE public.checkout_v2_session_credit_adjustments');
            expect(sql).toContain("effect TEXT NOT NULL DEFAULT 'restored' CHECK (effect = 'restored')");
            expect(sql).toContain('checkout_v2_session_credit_adjustment_binding_is_invalid');
            expect(sql).toContain('checkout_v2_session_credit_adjustment_outcome_is_ineligible');
            expect(sql).toContain('checkout_v2_session_credit_adjustment_is_immutable');
            expect(sql).toContain(
                'REVOKE ALL ON TABLE public.checkout_v2_session_credit_adjustments',
            );
            expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.(?:restore|create|record)_checkout_v2_session_credit/i);
        });

        it(`${name} exposes only service-role, security-invoker read models`, () => {
            expect(sql).toContain('CREATE VIEW public.checkout_v2_cycle_progress');
            expect(sql.match(/WITH \(security_invoker = true\)/g)?.length).toBeGreaterThanOrEqual(2);
            expect(sql).toContain('SECURITY INVOKER');
            expect(sql).toContain('SET search_path = \'\'');
            expect(sql).toContain(
                'REVOKE ALL ON FUNCTION public.get_checkout_v2_subscription_progress(UUID)',
            );
            expect(sql).toContain(
                'GRANT EXECUTE ON FUNCTION public.get_checkout_v2_subscription_progress(UUID)',
            );
            expect(sql).toContain(
                'GRANT EXECUTE ON FUNCTION public.get_checkout_v2_subscriptions_progress(UUID[])',
            );
            expect(sql).toContain(
                'GRANT SELECT ON TABLE public.sessions, public.subscriptions TO service_role',
            );
        });

        it(`${name} reserves guarantee refund provenance for the durable saga`, () => {
            expect(sql).toContain(
                'CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_refund_provenance()',
            );
            expect(sql).toContain("current_setting('app.checkout_v2_guarantee_operation_id', TRUE)");
            expect(sql).toContain('checkout_v2_guarantee_refund_provenance_is_invalid');
            expect(sql).toContain('operation.terminated_at IS NULL');
            expect(sql).toContain('operation.second_session_id');
        });

        it(`${name} distinguishes pending, ready and inconsistent materialization`, () => {
            expect(sql).toContain("THEN 'pending'");
            expect(sql).toContain("THEN 'ready'");
            expect(sql).toContain("ELSE 'inconsistent'");
            expect(sql).toContain("CASE WHEN progress_state = 'ready' THEN sessions_consumed END");
            expect(sql).toContain('ORDER BY progress.cycle_number DESC');
        });
    }

    it('keeps generated database types aligned with the new table, views and RPC', () => {
        expect(types).toContain('checkout_v2_session_credit_adjustments: {');
        expect(types).toContain('checkout_v2_session_consumption: {');
        expect(types).toContain('checkout_v2_cycle_progress: {');
        expect(types).toContain('get_checkout_v2_subscription_progress: {');
        expect(types).toContain('get_checkout_v2_subscriptions_progress: {');
        expect(types).toContain('Args: { p_subscription_ids: string[] };');
        expect(types).toContain('sessions_consumed: number | null;');
        expect(types).toContain('progress_state: string | null;');
    });

    it('runs the behavioral SQL contract in both incremental and fresh CI databases', () => {
        expect(ci.match(/tests\/sql\/checkout-v2-cycle-progress\.sql/g)).toHaveLength(2);
        expect(ci).toContain('base_max_migration_timestamp');
        expect(ci).toContain('must sort after base maximum');
        expect(ci).toContain('new_migration_timestamps');
        expect(ci).toContain('must not share timestamp');
    });

    it('provides a bounded, duplicate-safe batch latest-progress contract', () => {
        expect(migration).toContain(
            'CREATE OR REPLACE FUNCTION public.get_checkout_v2_subscriptions_progress(',
        );
        expect(migration).toContain('COALESCE(p_subscription_ids, ARRAY[]::UUID[])');
        expect(migration).toContain('SELECT DISTINCT requested.subscription_id');
        expect(migration).toContain('ORDER BY progress.cycle_number DESC');
        expect(migration).toContain('checkout_v2_progress_batch_is_too_large');
        expect(migration).toContain(') > 5000 THEN');
    });
});
