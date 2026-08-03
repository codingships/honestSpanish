import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260803151112_admin_access_foundation.sql',
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
