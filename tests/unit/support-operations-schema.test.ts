import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260802044726_support_operations.sql', 'utf8');
const schema = readFileSync('db/schema.sql', 'utf8');
const supportStart = schema.lastIndexOf('-- Make support a first-class');
const schemaSupport = schema.slice(supportStart, supportStart + migration.length);
const api = readFileSync('src/pages/api/admin/support-tickets.ts', 'utf8');
const studentApi = readFileSync('src/pages/api/support/tickets.ts', 'utf8');
const campus = readFileSync('src/pages/[lang]/campus/support.astro', 'utf8');
const sqlSurfaces = [['migration', migration], ['schema', schemaSupport]] as const;

describe('support operations schema', () => {
    it.each(sqlSurfaces)('%s keeps ticket mutation atomic and exact-on-replay', (_name, sql) => {
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_mutate_support_ticket(');
        expect(sql).toContain('FOR UPDATE;');
        expect(sql).toContain('ticket_before.updated_at IS DISTINCT FROM p_expected_updated_at');
        expect(sql).toContain("RAISE EXCEPTION 'support_ticket_state_conflict'");
        expect(sql).toContain("RAISE EXCEPTION 'support_ticket_request_id_conflicts'");
        expect(sql).toContain("INSERT INTO public.support_ticket_events (");
        expect(sql).toContain("INSERT INTO public.admin_audit_log (");
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.admin_mutate_support_ticket(');
        expect(sql).toContain(') TO service_role;');
        expect(sql).not.toMatch(/TO (?:anon|authenticated);\s*\n\s*COMMENT ON FUNCTION public\.admin_mutate_support_ticket/u);
    });

    it.each(sqlSurfaces)('%s makes history immutable and student-safe', (_name, sql) => {
        expect(sql).toContain("RAISE EXCEPTION 'support_ticket_history_is_immutable'");
        expect(sql).toContain('CREATE OR REPLACE FUNCTION private.guard_support_ticket_event_history()');
        expect(sql).toContain('CREATE OR REPLACE FUNCTION private.guard_support_ticket_operation_history()');
        expect(sql).toMatch(/ticket_id UUID NOT NULL REFERENCES public\.support_tickets\(id\) ON DELETE CASCADE/gu);
        expect(sql).toContain('admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL');
        expect(sql).toContain('requested_assigned_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL');
        expect(sql).toContain("event.visibility = 'public'");
        expect(sql).toContain('ticket.user_id = caller_id');
        expect(sql).toContain('GRANT INSERT (\n    id, user_id, issue_type, issue_title, message, page_url, user_agent, context\n) ON TABLE public.support_tickets TO authenticated;');
        expect(sql).not.toContain('GRANT INSERT ON TABLE public.support_tickets TO authenticated;');
        expect(sql).not.toContain('GRANT SELECT ON TABLE public.support_tickets TO authenticated;');
        expect(sql).toContain('CREATE TRIGGER record_support_ticket_creation_trigger');
    });

    it.each(sqlSurfaces)('%s serializes roles and gives every ticket a stable event cursor', (_name, sql) => {
        expect(sql).toContain('FOR SHARE;');
        expect(sql).not.toContain('FOR KEY SHARE;');
        expect(sql).toContain('sequence BIGINT NOT NULL CHECK (sequence > 0)');
        expect(sql).toContain('ON public.support_ticket_events(ticket_id, sequence)');
        expect(sql).toContain('SELECT COALESCE(MAX(event.sequence), 0) + 1 INTO next_event_sequence');
        expect(sql).toContain("'assignment_changed',");
        expect(sql).not.toContain("'before_assigned_admin_id'");
        expect(sql).not.toContain("'after_assigned_admin_id'");
        expect(sql).not.toContain("'ticket', to_jsonb(ticket_after)");
        expect(sql).not.toContain("'event', to_jsonb(event_row)");
        expect(sql).toContain('public.get_my_support_ticket_events(\n    p_ticket_id UUID,');
        expect(sql).toContain('AND (p_before_sequence IS NULL OR event.sequence < p_before_sequence)');
        expect(sql).toContain('ORDER BY event.sequence DESC');
    });

    it.each(sqlSurfaces)('%s keeps the permanent audit snapshot free of ticket content and student PII', (_name, sql) => {
        const auditStart = sql.indexOf('INSERT INTO public.admin_audit_log (');
        const auditEnd = sql.indexOf('RETURN operation_result;', auditStart);
        const auditInsert = sql.slice(auditStart, auditEnd);
        expect(auditStart).toBeGreaterThan(-1);
        expect(auditEnd).toBeGreaterThan(auditStart);
        expect(auditInsert).toContain("'status', ticket_before.status");
        expect(auditInsert).toContain("'priority', ticket_after.priority");
        expect(auditInsert).toContain("'assigned', ticket_after.assigned_admin_id IS NOT NULL");
        expect(auditInsert).toContain("'updated_at', ticket_after.updated_at");
        expect(auditInsert).not.toContain('to_jsonb(ticket_before)');
        expect(auditInsert).not.toContain("'ticket', to_jsonb(ticket_after)");
        expect(auditInsert).not.toContain('ticket_before.message');
        expect(auditInsert).not.toContain('ticket_after.user_id');
    });

    it('keeps internal notes out of student email and campus reads', () => {
        expect(api).toContain('adminNote: result.publicMessage');
        expect(api).not.toContain('admin_notes');
        expect(api).toContain('if (!result.replayed && result.notifyStudent)');
        expect(api).not.toContain('events:support_ticket_events');
        expect(studentApi).toContain("supabase.rpc('get_my_support_ticket_events'");
        expect(campus).toContain("fetch(`/api/support/tickets?${params}`");
        expect(campus).not.toContain("supabase.rpc('get_my_support_ticket_events'");
        expect(campus).not.toContain('admin_notes');
    });

    it('paginates the student ticket list independently from each ticket history', () => {
        expect(campus).toContain('p_limit: ticketPageSize + 1');
        expect(campus).toContain('p_offset: (supportPage - 1) * ticketPageSize');
        expect(campus).toContain('.slice(0, ticketPageSize)');
        expect(campus).toContain('supportPage=${supportPage - 1}');
        expect(campus).toContain('supportPage=${supportPage + 1}');
    });

    it('keeps the consolidated schema byte-equivalent to the migration suffix', () => {
        const normalize = (value: string) => value.replaceAll('\r\n', '\n').trimEnd();
        expect(normalize(schemaSupport)).toBe(normalize(migration));
    });

    it('runs the behavioral contract against incremental and fresh databases in CI', () => {
        const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
        expect(ci.match(/tests\/sql\/support-operations\.sql/gu)).toHaveLength(2);
    });
});
