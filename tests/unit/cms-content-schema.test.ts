import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260803182652_cms_home_content_workflow.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
const databaseTypes = readFileSync('src/types/database.types.ts', 'utf8').replace(/\r\n/g, '\n');

function canonicalLatestSqlFunction(source: string, qualifiedName: string): string {
    const start = source.lastIndexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}`);
    if (start < 0) throw new Error(`Missing SQL function: ${qualifiedName}`);
    const end = source.indexOf('\n$$;', start);
    if (end < 0) throw new Error(`Unterminated SQL function: ${qualifiedName}`);
    return source.slice(start, end + '\n$$;'.length).replace(/\s+/g, ' ').trim();
}

describe('managed public content schema', () => {
    it('keeps the consolidated schema aligned with the migration', () => {
        for (const functionName of [
            'private.guard_cms_content_versions_immutable()',
            'public.create_cms_content_draft(',
            'public.update_cms_content_draft(',
            'public.discard_cms_content_draft(',
            'public.publish_cms_content_draft(',
            'public.rollback_cms_content_document(',
        ]) {
            expect(canonicalLatestSqlFunction(schema, functionName)).toBe(
                canonicalLatestSqlFunction(migration, functionName),
            );
        }
    });

    it('keeps content server-only, versioned and capability protected', () => {
        for (const sql of [migration, schema]) {
            expect(sql).toContain('ALTER TABLE public.cms_documents ENABLE ROW LEVEL SECURITY;');
            expect(sql).toContain('ALTER TABLE public.cms_content_drafts ENABLE ROW LEVEL SECURITY;');
            expect(sql).toContain('ALTER TABLE public.cms_content_versions ENABLE ROW LEVEL SECURITY;');
            expect(sql).toContain(
                'REVOKE ALL ON TABLE public.cms_documents\n    FROM PUBLIC, anon, authenticated, service_role;',
            );
            expect(sql).toContain('GRANT SELECT ON TABLE public.cms_documents TO service_role;');
            expect(sql).toContain("'content.write'::public.admin_capability");
            expect(sql).toContain('cms_content_versions_are_immutable');
            expect(sql).toContain('cms_content_open_draft_blocks_rollback');
            expect(sql).toContain('cms_content_stale_revision');
        }
    });

    it('exposes the managed tables and RPCs in the checked-in database types', () => {
        for (const marker of [
            'cms_content_drafts: {',
            'cms_content_versions: {',
            'cms_documents: {',
            'create_cms_content_draft: {',
            'publish_cms_content_draft: {',
            'rollback_cms_content_document: {',
            'cms_content_locale: "es" | "en" | "ru";',
        ]) {
            expect(databaseTypes).toContain(marker);
        }
    });
});
