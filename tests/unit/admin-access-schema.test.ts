import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260803151112_admin_access_foundation.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const catalogV2Migration = readFileSync(
    'supabase/migrations/20260803171044_catalog_v2_admin_drafts.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

const surfaces = [migration, schema] as const;

describe('granular administrator access schema', () => {
    it.each(surfaces)('keeps operational roles separate from academic user roles', (sql) => {
        expect(sql).toContain('CREATE TYPE public.admin_access_role AS ENUM (');
        expect(sql).toContain("'owner',");
        expect(sql).toContain("'content_editor',");
        expect(sql).toContain("'catalog_editor',");
        expect(sql).toContain("'operator',");
        expect(sql).toContain("'finance',");
        expect(sql).toContain("'viewer'");
        expect(sql).toContain('CREATE TABLE public.admin_role_assignments (');
        expect(sql).toContain('profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE');
        expect(sql).toContain('PRIMARY KEY (profile_id, access_role)');
    });

    it.each(surfaces)('migrates existing administrators to owner without trusting user metadata', (sql) => {
        expect(sql).toContain("'owner'::public.admin_access_role");
        expect(sql).toContain("WHERE profile.role = 'admin'::public.user_role");
        expect(sql).toContain('ON CONFLICT (profile_id, access_role) DO NOTHING');
    });

    it('does not derive administrator access from authentication metadata', () => {
        expect(migration).not.toMatch(/user_metadata|raw_user_meta_data/u);
    });

    it.each(surfaces)('allows authenticated callers to ask only about their own capability', (sql) => {
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.has_my_admin_capability(');
        expect(sql).toContain('private.admin_has_capability(auth.uid(), p_capability)');
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_my_admin_capabilities()');
        expect(sql).toContain('WHERE private.admin_has_capability(auth.uid(), capability)');
        expect(sql).toContain('SECURITY DEFINER');
        expect(sql).toContain("SET search_path = ''");
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.has_my_admin_capability(');
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_my_admin_capabilities()');
        expect(sql).toContain(') TO authenticated;');
    });

    it.each(surfaces)('keeps the mixed-data dashboard out of specialized roles', (sql) => {
        const specializedRoleMap = sql.slice(
            sql.indexOf("WHEN 'content_editor'::public.admin_access_role"),
            sql.indexOf('ELSE FALSE'),
        );
        expect(specializedRoleMap).not.toContain("'dashboard.read'::public.admin_capability");
    });

    it.each(surfaces)('keeps assignments server-managed and access mutations audited', (sql) => {
        expect(sql).toContain('ALTER TABLE public.admin_role_assignments ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role;');
        expect(sql).toContain('GRANT SELECT ON TABLE public.admin_role_assignments TO service_role');
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_grant_access_role(');
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_revoke_access_role(');
        expect(sql).toContain("'admin_access.grant'");
        expect(sql).toContain("'admin_access.revoke'");
        expect(sql).toContain("RAISE EXCEPTION 'admin_access_last_owner'");
        expect(sql).toContain(') TO service_role;');
    });

    it.each(surfaces)('makes the administrative audit ledger append-only', (sql) => {
        expect(sql).toContain('CREATE OR REPLACE FUNCTION private.guard_admin_audit_log_immutable()');
        expect(sql).toContain("RAISE EXCEPTION 'admin_audit_log_is_immutable'");
        expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.admin_audit_log');
        expect(sql).toContain('pg_catalog.pg_trigger_depth() > 1');
        expect(sql).toContain("pg_catalog.to_jsonb(NEW) - 'admin_id'");
    });

    it.each(surfaces)('enforces capability domains at the database policy boundary', (sql) => {
        expect(sql).toContain('DROP POLICY IF EXISTS "Admins can manage leads" ON public.leads;');
        expect(sql).toContain('CREATE POLICY "Admin operations readers can view leads"');
        expect(sql).toContain('CREATE POLICY "Admin operations writers can manage leads"');
        expect(sql).toContain('CREATE POLICY "Admin catalog readers can view packages"');
        expect(sql).toContain('CREATE POLICY "Admin catalog writers can manage packages"');
        expect(sql).toContain('CREATE POLICY "Admin finance readers can view payments"');
        expect(sql).toContain('CREATE POLICY "Admin finance writers can manage payments"');
        expect(sql).toContain('CREATE POLICY "Admin access readers can view audit log"');
        expect(sql).toContain('CREATE POLICY "Admin operations readers can read support ticket history"');
        expect(sql).toContain("'operations.read'::public.admin_capability");
        expect(sql).toContain("'operations.write'::public.admin_capability");
        expect(sql).toContain("'catalog.read'::public.admin_capability");
        expect(sql).toContain("'catalog.write'::public.admin_capability");
        expect(sql).toContain("'finance.read'::public.admin_capability");
        expect(sql).toContain("'finance.write'::public.admin_capability");
        expect(sql).toContain("'access.read'::public.admin_capability");
    });

    it('replaces direct catalog writes with server-only versioned mutations', () => {
        for (const sql of [catalogV2Migration, schema]) {
            expect(sql).toContain(
                'REVOKE INSERT, UPDATE, DELETE ON TABLE public.packages FROM authenticated;',
            );
            expect(sql).toContain(
                'DROP POLICY IF EXISTS "Admin catalog writers can manage packages" ON public.packages;',
            );
            expect(sql).toContain(
                'REVOKE ALL ON TABLE public.package_catalog_drafts\n    FROM PUBLIC, anon, authenticated, service_role;',
            );
            expect(sql).toContain(
                'GRANT SELECT ON TABLE public.package_catalog_drafts TO service_role;',
            );
            expect(sql).toContain(
                'GRANT EXECUTE ON FUNCTION public.create_package_catalog_draft(',
            );
            expect(sql).toContain(
                'GRANT EXECUTE ON FUNCTION public.publish_package_catalog_draft(',
            );
            expect(sql).toContain(
                'GRANT EXECUTE ON FUNCTION public.retire_versioned_package(UUID, UUID)',
            );
        }

        expect(
            schema.lastIndexOf(
                'DROP POLICY IF EXISTS "Admin catalog writers can manage packages" ON public.packages;',
            ),
        ).toBeGreaterThan(
            schema.lastIndexOf('CREATE POLICY "Admin catalog writers can manage packages"'),
        );
    });

    it.each(surfaces)('keeps direct profile identity changes server-only', (sql) => {
        const guardStart = sql.lastIndexOf(
            'CREATE OR REPLACE FUNCTION private.protect_profile_role()',
        );
        const nextFunction = sql.indexOf(
            'CREATE OR REPLACE FUNCTION private.guard_admin_audit_log_immutable()',
            guardStart,
        );
        const guard = sql.slice(
            guardStart,
            nextFunction === -1 ? sql.length : nextFunction,
        );
        expect(guardStart).toBeGreaterThan(-1);
        expect(guard).toContain("RAISE EXCEPTION 'Cannot modify role'");
        expect(guard).toContain("RAISE EXCEPTION 'Cannot modify profile email'");
        expect(guard).not.toContain('private.is_admin');
    });

    it('keeps generated application types aligned with the new contract', () => {
        expect(databaseTypes).toContain('admin_role_assignments: {');
        expect(databaseTypes).toContain('admin_access_role:');
        expect(databaseTypes).toContain('admin_capability:');
        expect(databaseTypes).toContain('has_my_admin_capability: {');
        expect(databaseTypes).toContain('get_my_admin_capabilities: {');
        expect(databaseTypes).toContain('admin_grant_access_role: {');
        expect(databaseTypes).toContain('admin_revoke_access_role: {');
    });
});
