import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260710143000_cancel_scheduled_session_atomically.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');

describe('atomic session cancellation schema', () => {
    it('locks the session and subscription before changing cancellation state and quota', () => {
        for (const source of [migration, schema]) {
            expect(source).toContain('CREATE OR REPLACE FUNCTION public.cancel_scheduled_session');
            expect(source).toContain('FROM public.sessions AS session_row');
            expect(source).toContain('FOR UPDATE;');
            expect(source).toContain('FROM public.subscriptions AS subscription_row');
            expect(source).toContain('SET sessions_used = v_next_sessions_used');
            expect(source).toContain("SET status = 'cancelled'");
        }
    });

    it('keeps the RPC service-role-only and computes the 24-hour rule in the transaction', () => {
        for (const source of [migration, schema]) {
            expect(source).toContain("v_session.scheduled_at < v_cancelled_at + INTERVAL '24 hours'");
            expect(source).toContain("RAISE EXCEPTION 'session_cancellation_forbidden'");
            expect(source).toContain('SECURITY INVOKER');
            expect(source).toContain(
                'REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM authenticated;',
            );
            expect(source).toContain(
                'GRANT EXECUTE ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) TO service_role;',
            );
        }
    });
});
