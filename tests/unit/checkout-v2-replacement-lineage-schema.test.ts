import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
    'supabase/migrations/20260802034119_add_checkout_v2_replacement_lineage.sql';
const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const types = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');
const sqlContract = readFileSync(
    'tests/sql/checkout-v2-cycle-progress.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

describe('Checkout V2 replacement lineage foundation', () => {
    for (const [name, sql] of [
        ['migration', migration],
        ['canonical schema', schema],
    ] as const) {
        it(`${name} keeps four unique roots and derives one effective leaf per position`, () => {
            expect(sql).toContain('checkout_v2_replaces_session_id UUID UNIQUE');
            expect(sql).toContain('sessions_checkout_v2_replacement_shape_check');
            expect(sql).toMatch(
                /CREATE UNIQUE INDEX sessions_checkout_v2_cycle_position_unique_idx[\s\S]*checkout_v2_replaces_session_id IS NULL/,
            );
            expect(sql).toContain(
                'CREATE OR REPLACE FUNCTION private.checkout_v2_effective_cycle_sessions(',
            );
            expect(sql).toContain('WITH RECURSIVE lineage AS');
            expect(sql).toContain(
                'CROSS JOIN LATERAL private.checkout_v2_effective_cycle_sessions(cycle.id)',
            );
        });

        it(`${name} keeps lineage immutable and replacement writes disabled`, () => {
            expect(sql).toContain(
                'CREATE OR REPLACE FUNCTION private.guard_checkout_v2_session_replacement()',
            );
            expect(sql).toContain('checkout_v2_session_replacement_lineage_is_immutable');
            expect(sql).toContain('checkout_v2_session_replacement_identity_is_immutable');
            expect(sql).toContain(
                'checkout_v2_session_replacement_billing_state_is_missing',
            );
            expect(sql).toContain('source_session.created_at >= NEW.created_at');
            expect(sql).toContain('checkout_v2_session_replacement_insert_is_not_enabled');
            expect(sql).not.toMatch(
                /CREATE (?:OR REPLACE )?FUNCTION public\.(?:create|materialize|replace)_checkout_v2_(?:replacement|session_replacement)/i,
            );
        });

        it(`${name} exposes no free-form replacement note through participant-visible sessions`, () => {
            expect(sql).toContain(
                "THEN 'replacement_after_restored_no_show'",
            );
            expect(sql).toContain(
                "THEN 'replacement_after_teacher_cancellation'",
            );
            expect(sql).not.toMatch(
                /char_length\(btrim\(checkout_v2_replacement_reason\)\)/,
            );
            expect(sql).toContain(
                'Detail belongs in a future admin-only audit record',
            );
        });

        it(`${name} keeps restored incident facts across an effective replacement chain`, () => {
            expect(sql).toContain('WITH RECURSIVE ancestry AS');
            expect(sql).toContain(
                'adjustment_row.id = ancestry.checkout_v2_replacement_credit_adjustment_id',
            );
            expect(sql).toContain('LEFT JOIN public.sessions AS incident');
            expect(sql).toContain('adjustment.session_id = session.id');
        });

        it(`${name} keeps the private helper outside the public Data API`, () => {
            expect(sql).toContain(
                'REVOKE ALL ON FUNCTION private.checkout_v2_effective_cycle_sessions(UUID)',
            );
            expect(sql).toContain(
                'GRANT EXECUTE ON FUNCTION private.checkout_v2_effective_cycle_sessions(UUID)',
            );
            expect(sql).not.toContain(
                'GRANT EXECUTE ON FUNCTION private.checkout_v2_effective_cycle_sessions(UUID)\n    TO anon',
            );
        });
    }

    it('aligns generated session types with every lineage foreign key', () => {
        expect(types).toContain('checkout_v2_replaces_session_id: string | null;');
        expect(types).toContain('checkout_v2_replacement_request_id: string | null;');
        expect(types).toContain('checkout_v2_replacement_actor_id: string | null;');
        expect(types).toContain(
            'checkout_v2_replacement_credit_adjustment_id: string | null;',
        );
        expect(types).toContain(
            'sessions_checkout_v2_replaces_session_id_fkey',
        );
    });

    it('executes roots, rejection and restored-chain semantics in fresh and incremental SQL', () => {
        expect(sqlContract).toContain('root_only_effective_projection_changed');
        expect(sqlContract).toContain('direct_replacement_insert_was_allowed');
        expect(sqlContract).toContain(
            'replacement_without_billing_state_was_allowed',
        );
        expect(sqlContract).toContain(
            'replacement_identity_mutation_was_allowed',
        );
        expect(sqlContract).toContain(
            'scheduled_replacement_lost_restored_incident_semantics',
        );
        expect(sqlContract).toContain(
            'completed_replacement_did_not_consume_restored_position',
        );
        expect(ci.match(/tests\/sql\/checkout-v2-cycle-progress\.sql/g)).toHaveLength(2);
    });
});
