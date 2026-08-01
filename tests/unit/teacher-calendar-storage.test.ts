import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('teacher calendar storage contract', () => {
    it('keeps owner-and-time indexes in both migration history and the consolidated schema', () => {
        const migration = readFileSync(
            'supabase/migrations/20260801220000_add_weekly_session_lookup_indexes.sql',
            'utf8',
        );
        const schema = readFileSync('db/schema.sql', 'utf8');

        for (const indexName of [
            'idx_sessions_teacher_scheduled_at',
            'idx_sessions_student_scheduled_at',
        ]) {
            expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
            expect(schema).toContain(`CREATE INDEX ${indexName}`);
        }

        expect(migration).toContain('ON public.sessions (teacher_id, scheduled_at)');
        expect(migration).toContain('ON public.sessions (student_id, scheduled_at)');
    });
});
