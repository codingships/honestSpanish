import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/[lang]/campus/admin/students.astro', 'utf8');

describe('admin students page query shape', () => {
    it('uses bulk student lookups instead of per-student N+1 queries', () => {
        expect(source).toContain("const studentIds = (studentsRaw || []).map((student) => student.id)");
        expect(source).toContain(".from('subscriptions')");
        expect(source).toContain(".in('student_id', studentIds)");
        expect(source).toContain(".from('student_teachers')");
        expect(source).toContain('const subscriptionByStudent = new Map<string, SubscriptionSummary>()');
        expect(source).toContain('const teacherByStudent = new Map<string, string | null>()');

        expect(source).not.toContain('Promise.all(');
        expect(source).not.toContain('map(async (student)');
        expect(source).not.toContain(".eq('student_id', student.id)");
    });
});
