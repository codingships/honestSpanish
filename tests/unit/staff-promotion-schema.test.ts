import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260805085007_secure_staff_promotion.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');
const contractMarker = 'CREATE UNIQUE INDEX admin_audit_log_staff_invitation_request_key';

function staffPromotionContract(sql: string): string {
    const start = sql.lastIndexOf(contractMarker);
    if (start < 0) throw new Error('Secure staff promotion contract is missing');
    return sql.slice(start);
}

const surfaces = [staffPromotionContract(migration), staffPromotionContract(schema)] as const;

describe('secure staff promotion contract', () => {
    it.each(surfaces)('permits only explicit managed student-to-staff transitions', (sql) => {
        expect(sql).toContain("current_setting('app.teacher_profile_activation_profile_id', TRUE)");
        expect(sql).toContain("current_setting('app.admin_profile_promotion_profile_id', TRUE)");
        expect(sql).toContain("NEW.role IS DISTINCT FROM 'teacher'::public.user_role");
        expect(sql).toContain("NEW.role IS DISTINCT FROM 'admin'::public.user_role");
        expect(sql).toContain("RAISE EXCEPTION 'profile_role_requires_managed_activation'");
        expect(sql).not.toMatch(/user_metadata|raw_user_meta_data/u);
    });

    it.each(surfaces)('requires an owner-controlled verified and dependency-free profile', (sql) => {
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.promote_admin_profile(');
        expect(sql).toContain("'access.write'::public.admin_capability");
        expect(sql).toContain('FROM auth.users AS user_account');
        expect(sql).toContain('auth_email_confirmed_at IS NULL');
        expect(sql).toContain("profile_row.role IS DISTINCT FROM 'student'::public.user_role");
        expect(sql).toContain('NOT profile_row.adult_confirmed');
        for (const table of [
            'subscriptions',
            'checkout_intents',
            'payments',
            'sessions',
            'student_teachers',
            'fulfillment_jobs',
        ]) {
            expect(sql).toContain(`EXISTS (SELECT 1 FROM public.${table} WHERE student_id = p_profile_id)`);
        }
    });

    it.each(surfaces)('is idempotent, grants one initial role and records immutable audit', (sql) => {
        expect(sql).toContain('CREATE UNIQUE INDEX admin_audit_log_admin_promotion_request_key');
        expect(sql).toContain("action = 'admin_access.promote'");
        expect(sql).toContain("after ->> 'request_id' = p_request_id::TEXT");
        expect(sql).toContain('existing_audit.entity_id IS DISTINCT FROM p_profile_id::TEXT');
        expect(sql).toContain('INSERT INTO public.admin_role_assignments (');
        expect(sql).toContain("'admin_access.promote'");
        expect(sql).toContain("'access_role', p_access_role");
        expect(sql).toContain("'reason', trimmed_reason");
        expect(sql).toContain("'profile_id', profile_row.id");
        expect(sql).not.toContain('pg_catalog.to_jsonb(profile_row)');
        expect(sql).toContain('TO service_role;');
    });

    it.each(surfaces)('deduplicates invitation request audit before the email side effect', (sql) => {
        expect(sql).toContain('CREATE UNIQUE INDEX admin_audit_log_staff_invitation_request_key');
        expect(sql).toContain("WHERE action = 'staff.invitation.requested'");
        expect(sql).toContain("AND entity_type = 'staff_invitation'");
    });

    it('keeps generated application types aligned', () => {
        expect(databaseTypes).toContain('promote_admin_profile: {');
        expect(databaseTypes).toContain('p_access_role: Database["public"]["Enums"]["admin_access_role"]');
        expect(databaseTypes).toContain('p_reason: string;');
        expect(databaseTypes).toContain('p_request_id: string;');
    });
});
