import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260712115000_harden_data_api_table_grants.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');

const authenticatedCrudTables = [
    'leads',
    'crm_contacts',
    'crm_opportunities',
    'crm_tasks',
    'crm_activities',
    'crm_consents',
    'fulfillment_jobs',
    'packages',
    'payments',
    'profiles',
    'profiles_private',
    'sessions',
    'student_teachers',
    'subscriptions',
    'teacher_availability',
] as const;

const clientGrantedTables = [
    ...authenticatedCrudTables,
    'admin_audit_log',
    'processed_webhook_events',
    'support_tickets',
] as const;

describe('Data API table grant contract', () => {
    it('resets current and postgres-default client grants before regranting', () => {
        for (const sql of [migration, schema]) {
            expect(sql).toMatch(
                /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public\s+FROM PUBLIC, anon, authenticated/u,
            );
            expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public');
            expect(sql).toMatch(
                /ALTER DEFAULT PRIVILEGES FOR ROLE postgres\s+REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/u,
            );
            expect(sql).toContain(
                'REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated',
            );
        }
    });

    it('reasserts RLS on every client-granted table in the grant transaction', () => {
        expect(clientGrantedTables).toHaveLength(18);
        for (const table of clientGrantedTables) {
            expect(migration).toContain(
                `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
            );
        }
    });

    it('grants exactly the operations represented by client RLS policies', () => {
        const crudStart = migration.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE');
        const crudEnd = migration.indexOf('TO authenticated;', crudStart);
        const crudBlock = migration.slice(crudStart, crudEnd);

        expect(authenticatedCrudTables).toHaveLength(15);
        for (const table of authenticatedCrudTables) {
            expect(crudBlock).toContain(`public.${table}`);
        }
        expect((crudBlock.match(/public[.][a-z_]+/gu) ?? [])).toHaveLength(15);

        expect(migration).toContain('GRANT SELECT ON TABLE public.packages TO anon');
        expect(migration).toContain(
            'public.admin_audit_log,\n    public.processed_webhook_events\nTO authenticated',
        );
        expect(migration).toContain(
            'GRANT INSERT ON TABLE public.support_tickets TO authenticated',
        );
        expect(migration).not.toMatch(/TO (?:PUBLIC|service_role)/u);
    });

    it('leaves service-only tables without anon/authenticated grants', () => {
        for (const table of [
            'checkout_intents',
            'email_recipient_budget_usage',
            'fulfillment_effects',
            'package_prices',
            'staging_integration_smoke_leases',
            'staging_integration_smoke_runs',
        ]) {
            expect(migration).not.toContain(`public.${table}`);
        }
    });
});
