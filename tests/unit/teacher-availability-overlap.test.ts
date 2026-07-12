import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260712114000_harden_teacher_availability_overlap.sql',
    'utf8',
).replace(/\r\n/g, '\n');
const schema = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');

describe('teacher availability overlap invariant', () => {
    it('uses a partial GiST exclusion constraint for active ranges', () => {
        for (const sql of [migration, schema]) {
            expect(sql).toContain('teacher_availability_no_active_overlap');
            expect(sql).toContain('EXCLUDE USING gist');
            expect(sql).toContain('teacher_id WITH =');
            expect(sql).toContain('day_of_week WITH =');
            expect(sql).toContain('numrange(');
            expect(sql).toContain('WITH &&');
            expect(sql).toContain('WHERE (is_active = TRUE)');
        }
    });

    it('fails migration safely when existing active rows overlap', () => {
        expect(migration).toContain('first_slot.start_time < second_slot.end_time');
        expect(migration).toContain('second_slot.start_time < first_slot.end_time');
        expect(migration).toContain(
            'Cannot add teacher availability overlap constraint: active overlaps exist',
        );
    });

    it('drops the legacy unique constraint only after the stronger exclusion constraint', () => {
        const exclusion = migration.indexOf('ADD CONSTRAINT teacher_availability_no_active_overlap');
        const legacyDrop = migration.indexOf(
            'DROP CONSTRAINT IF EXISTS teacher_availability_teacher_id_day_of_week_start_time_key',
        );

        expect(exclusion).toBeGreaterThan(-1);
        expect(legacyDrop).toBeGreaterThan(exclusion);
    });
});
