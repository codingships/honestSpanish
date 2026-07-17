import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260712115000_harden_data_api_table_grants.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const runner = readFileSync(
    'scripts/launch/supabase-staging-hardening-shared.ts',
    'utf8',
).replace(/\r\n/g, '\n');

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

    it('post-verifies the complete 1/63/0 client grant matrix and postgres defaults', () => {
        expect(runner).toContain("requireFact(facts, 'data_api_anon_grants_count', '1'");
        expect(runner).toContain("requireFact(facts, 'data_api_authenticated_grants_count', '63'");
        expect(runner).toContain("requireFact(facts, 'data_api_public_grants_count', '0'");
        expect(runner).toContain("requireFact(facts, 'data_api_authenticated_crud_tables_count', '15'");
        expect(runner).toContain("requireFact(facts, 'data_api_client_granted_tables_rls_count', '18'");
        expect(runner).toContain("requireFact(facts, 'data_api_client_granted_tables_without_rls_count', '0'");
        expect(runner).toContain("requireFact(facts, 'data_api_unexpected_client_grants_count', '0'");
        expect(runner).toContain("requireFact(facts, 'data_api_postgres_default_client_grants_count', '0'");
        expect(runner).toContain('defaults.defaclnamespace = 0');
    });
});
